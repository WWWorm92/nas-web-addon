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
        # Do not traverse SMB symlink/junction directories in permanent-delete.
        attributes = file.get_attributes() if hasattr(file, "get_attributes") else 0
        self.isReparsePoint = bool(attributes & 0x400)

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

    def file_size(self, share, path):
        import ntpath
        remote = path.replace("/", "\\")
        parent, basename = ntpath.split(remote)
        if not basename or any(x in basename for x in "*?"):
            raise FileNotFoundError(path)
        matches = self.conn.listPath(share, (parent.rstrip("\\") + "\\" if parent else "\\") + basename)
        for item in matches:
            if item.get_longname() == basename and not item.is_directory():
                return item.get_filesize()
        raise FileNotFoundError(path)

    def iter_range(self, share, path, start, length):
        # The generator's finally clause closes the SMB file and tree even
        # when the HTTP browser cancels the response.
        remote = path.replace("/", "\\")
        tid = self.conn.connectTree(share)
        fid = None
        try:
            # Impacket's default requests FILE_READ_DATA | FILE_WRITE_DATA.
            # EXIF extraction and HTTP range streaming only need read access:
            # requesting write rejects read-only SMB shares with ACCESS_DENIED.
            fid = self.conn.openFile(tid, remote, desiredAccess=0x00000001,
                                     shareMode=0x00000007)
            remaining = length
            offset = start
            while remaining > 0:
                block = self.conn.readFile(tid, fid, offset, min(512 * 1024, remaining))
                if not block:
                    break
                yield block
                offset += len(block)
                remaining -= len(block)
        finally:
            try:
                if fid is not None:
                    self.conn.closeFile(tid, fid)
            finally:
                self.conn.disconnectTree(tid)

    def can_read(self, share, path):
        """Ask SMB to open this exact file for reading, without fetching contents."""
        remote = path.replace("/", "\\")
        tid = self.conn.connectTree(share)
        fid = None
        try:
            fid = self.conn.openFile(tid, remote, desiredAccess=0x00000001, shareMode=0x00000007)
            return True
        finally:
            try:
                if fid is not None:
                    self.conn.closeFile(tid, fid)
            finally:
                self.conn.disconnectTree(tid)
