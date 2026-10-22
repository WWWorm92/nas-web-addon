"""Source-level contract for atomic upload route and Impacket mode."""
import ast
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
APP = ROOT / "app"


def function_source(tree, name):
    node = next(n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                and n.name == name)
    return ast.get_source_segment(tree._source, node)


class RouteContracts(unittest.TestCase):
    def test_upload_never_directly_writes_final_filename(self):
        source = (APP / "main.py").read_text()
        tree = ast.parse(source)
        tree._source = source
        upload = function_source(tree, "upload")
        self.assertIn("atomic_upload.publish(conn, share, folder, filename, tmp, size)", upload)
        self.assertNotIn("conn.storeFile(", upload)
        self.assertIn("atomic_upload.UploadSizeMismatch", upload)
        self.assertIn("check_share(conn, share)", upload)
        self.assertIn("gallery_index.record_upload(", upload)
        self.assertLess(upload.index("atomic_upload.publish("),
                        upload.index("gallery_index.record_upload("))

    def test_smb_staging_file_is_create_only(self):
        adapter = (APP / "smb_compat.py").read_text()
        tree = ast.parse(adapter)
        conn = next(node for node in tree.body if isinstance(node, ast.ClassDef)
                    and node.name == "SMBConnection")
        method = next(node for node in conn.body if isinstance(node, ast.FunctionDef)
                      and node.name == "storeFileNew")
        segment = ast.get_source_segment(adapter, method)
        self.assertIn("mode=FILE_CREATE", segment)
        self.assertIn("from impacket.smb3structs import FILE_CREATE", adapter)
        self.assertNotIn("deleteFiles", segment)

    def test_existing_rename_and_gallery_are_not_reimplemented(self):
        source = (APP / "atomic_upload.py").read_text()
        tree = ast.parse(source)
        tree._source = source
        publish = function_source(tree, "publish")
        self.assertIn("conn.rename(", publish)
        self.assertNotIn("conn.storeFile(", publish)
        self.assertNotIn("deleteFiles(share, \"/\" + target)", publish)
        self.assertNotIn("conn.retrieveFile(", publish)


if __name__ == "__main__":
    unittest.main()
