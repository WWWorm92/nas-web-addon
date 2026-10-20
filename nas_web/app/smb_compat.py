"""Adapter exposing NAS Web's existing methods using SMB2/3-capable Impacket."""
from impacket.smbconnection import SMBConnection as ImpacketConnection

class Share:
    def __init__(self, name):
        self.name = name
        self.isSpecial = False

class Entry:
    def __init__(self, file):
        self.filename = file.get_longname()
        self.isDirectory = bool(file.is_directory())
        self.file_size = file.get_filesize()
        self.last_write_time = file.get_mtime_epoch()

class SMBConnection:
    def __init__(self, username, password, client_name, server_name, **kwargs):
        self.username = username
        self.password = password
        self.server_name = server_name
        self.conn = None

    def connect(self, host, port=445, timeout=12):
        self.conn = ImpacketConnection(self.server_name, host, sess_port=port, timeout=timeout)
        self.conn.login(self.username, self.password)
        return True

    def close(self):
        if self.conn is not None:
            try:
                self.conn.logoff()
            finally:
                self.conn.close()
                self.conn = None

    def listShares(self, **kwargs):
        shares = []
        for record in self.conn.listShares():
            raw = record["shi1_netname"]
            name = str(raw).rstrip("\x00")
            shares.append(Share(name))
        return shares

    def listPath(self, share, path, **kwargs):
        directory = path.replace("/", "\\").rstrip("\\")
        if not directory:
            directory = "\\"
        pattern = directory + ("*" if directory.endswith("\\") else "\\*")
        return [Entry(file) for file in self.conn.listPath(share, pattern)]

    def retrieveFile(self, share, path, handle, **kwargs):
        self.conn.getFile(share, path.replace("/", "\\"), handle.write)

    def storeFile(self, share, path, handle, **kwargs):
        self.conn.putFile(share, path.replace("/", "\\"), handle.read)

    def createDirectory(self, share, path):
        return self.conn.createDirectory(share, path.replace("/", "\\"))

    def rename(self, share, old_path, new_path):
        return self.conn.rename(share, old_path.replace("/", "\\"), new_path.replace("/", "\\"))

    def deleteDirectory(self, share, path):
        return self.conn.deleteDirectory(share, path.replace("/", "\\"))

    def deleteFiles(self, share, path):
        return self.conn.deleteFile(share, path.replace("/", "\\"))
