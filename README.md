# NAS Web

**SMB web file manager and photo gallery for Home Assistant OS.**

Browse your Simple NAS shares from a desktop or phone, manage files and view photos, videos and documents using your existing SMB account.

[Installation](#installation) · [Google Photos import](docs/GOOGLE_PHOTOS.md) · [Changelog](nas_web/CHANGELOG.md) · [Report an issue](https://github.com/WWWorm92/nas-web-addon/issues)

> **Experimental — trusted LAN testing only.** Public internet and KeenDNS deployment have not been cleared by a security review. Test against your own NAS and keep backups before changing files.

## Features

- Discover and browse shares allowed by your SMB account.
- Upload, download, create folders, rename, copy and move supported items.
- Recycle-bin operations and permanent deletion where Samba permissions allow.
- Photo gallery with date navigation, albums, favorites and memories.
- Cached thumbnails, HEIC/HEIF photo previews and supported video/audio playback.
- PDF viewing and ZIP download of selected files.
- Google Takeout ZIP imports and user-selected Google Photos Picker imports.
- Responsive interface for desktop and mobile.

Media playback and previews depend on the file format, browser and installed codecs. File operations remain subject to Samba permissions and operation limits.

## Requirements

- Home Assistant OS on a supported `aarch64` or `amd64` host.
- A reachable Simple NAS SMB server and a valid SMB account.
- Free Home Assistant host storage for caches and temporary imports.

## Installation

1. Open **Settings → Add-ons → Add-on Store → ⋮ → Repositories**.
2. Add `https://github.com/WWWorm92/nas-web-addon`.
3. Refresh the store, select **NAS Web** and install.
4. Set `smb_host` to your NAS address and check the other options.
5. Start the add-on and open `http://<HOME_ASSISTANT_IP>:8085` on your trusted LAN.
6. Sign in with your **Simple NAS SMB account**, not a separate Simple NAS Sharing account.

Use the Home Assistant host address for the web interface; `smb_host` is the address of the SMB server and may be a different device.

## Configuration

| Option | Purpose | Default for new installs |
| --- | --- | --- |
| `smb_host` | SMB server address | `192.168.1.35` — replace with yours |
| `smb_port` | SMB port | `445` |
| `smb_server_name` | SMB server name | `NAS` |
| `max_upload_mb` | Upload size setting, in MiB | `1024` |
| `https_only` | Require secure session cookies | `false` |
| `admin_setup_key` | Optional administrator setup key | Empty |
| `max_import_mb` | Takeout archive size limit, in MiB | `8192` |
| `google_client_id`, `google_client_secret`, `google_redirect_uri` | Optional Google Photos Picker OAuth settings | Empty |

Existing option values are preserved across add-on upgrades. Keep `https_only: false` for local HTTP testing; secure cookies are not sent over plain HTTP. This option alone does not make public deployment safe.

## Photos and imports

Open **Profile → Import from Google Photos** and choose a writable SMB destination.

- **Google Takeout:** import a full export as ZIP parts, with resumable uploads and JSON capture-date metadata.
- **Google Photos Picker:** import only the media explicitly selected in Google; it is not full-library synchronization.

Takeout archives are staged temporarily on the Home Assistant host before media is transferred to SMB. Check available host space before importing large archives.

See the [Google Photos import guide](docs/GOOGLE_PHOTOS.md) for setup, storage requirements, resuming uploads and date repair.

## Access and limitations

- Login throttling and request/session checks are implemented; they do not replace a security review.
- Samba decides which shares and files the account can read or change.
- Active SMB credentials are required while the application accesses the NAS.
- Caches, indexes and import state use add-on storage. Do not clear add-on data when resuming an import.
- Large first-time photo scans can be slow on a Raspberry Pi, HDD or wireless connection.
- Copy, move, archive and conversion operations have limits; test the workflow with non-critical files first.
- Public HTTPS deployment and adversarial testing remain outside the verified LAN-testing scope.

## Documentation

- [Current changelog](nas_web/CHANGELOG.md)
- [Early release history](docs/HISTORY.md)
- [Google Photos import](docs/GOOGLE_PHOTOS.md)
- [Repository issues](https://github.com/WWWorm92/nas-web-addon/issues)

When reporting a problem, include the add-on version, browser, operation and relevant log lines. Remove passwords, tokens and personal filenames before posting.
