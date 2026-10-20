# NAS Web — Home Assistant add-on

Experimental SMB web file manager for **Simple NAS** running on Home Assistant OS.

> **Security status: LAN TESTING ONLY. DO NOT PUBLISH TO KEENDNS OR THE PUBLIC INTERNET YET.**
> This prototype has not been security-reviewed and currently lacks login throttling, durable secure session storage and thorough adversarial testing.

## Add to Home Assistant

1. Settings → Add-ons → Add-on Store → ⋮ → Repositories.
2. Add `https://github.com/WWWorm92/nas-web-addon`.
3. Refresh the store; select **NAS Web** and install.
4. Set `smb_host` to your Simple NAS address (default `192.168.1.35`).
5. Start the add-on; open `http://192.168.1.35:8085` **on your trusted LAN only**.
6. Sign in using a **Simple NAS SMB account** (not the separate Simple NAS Sharing account).

## Features (prototype)

- Discovers accessible SMB shares using current SMB credentials.
- Browse directories; photo, supported video and PDF viewing.
- Upload, download, create directories, rename and delete where Samba permits.
- No direct access to Simple NAS internal configuration or HA administrator account.
- Uses existing Samba permissions; does not copy files between systems.

## Known limitations

- No rate limiting on sign-in: never expose to the internet in this version.
- Sessions are in memory and disappear on restart; SMB credentials are held in process memory during each session.
- Files are staged in temporary storage for downloads/uploads, requiring free disk space.
- Deletions are permanent and uploads may overwrite existing files.
- Large image directories fetch full pictures instead of optimized thumbnails.
- HTTPS reverse proxy configuration and secure-cookies behavior are **not production-ready**.
- SMB permissions, share discovery, login and operations need testing against your Simple NAS configuration.

This repository is an early prototype, **not a production-ready cloud drive**.


## Version 0.4.0 security and optimization
- Login attempts limited to 10 failures per 10 minutes per account and direct peer IP (in-process).
- Sessions live 4 hours, at most 64 concurrent sessions; restart invalidates them.
- Origin checks for login, logout, upload, delete, rename and folder creation.
- Cookies remain HttpOnly and SameSite=Strict; `https_only` controls the Secure flag.
- Photo tiles use bounded server-side 320x240 WebP thumbnails, while opening a photo still fetches the original.
- File type icons use a restrained monochrome/blue palette; mobile layout remains responsive.

**NOT YET VERIFIED FOR PUBLIC EXPOSURE.** Keep `https_only: false` during local HTTP tests. When HTTPS proxy support is verified, `https_only: true` will prevent sending session cookies over plain HTTP; note this makes the HTTP LAN URL unable to maintain a logged-in session. Login limits are local to the add-on process and are not a substitute for IP-level reverse proxy controls. Credentials remain in application RAM for active sessions. The browser UI and SMB behavior still need testing on the actual hardware.


## Performance improvements in 0.4.1

- Miniatures are generated once per login session and cached under `/tmp/nasweb-thumbs`, instead of fetching the original photograph from SMB for every page view.
- The thumbnail cache is limited to about 128 MiB and entries expire after 4 hours; it is discarded when the add-on container restarts.
- On a cache miss the app downloads a source photograph through SMB, verifies that Samba allows reading it and builds a 256×192 WebP thumbnail; subsequent requests use its cached copy.
- JPEG decoding uses Pillow draft mode when possible; WebP encoding uses the faster method 0.
- Thumbnail generation is limited to two concurrent workers to reduce Raspberry Pi load. First opening a large photo folder still requires processing its originals.
- Cached thumbnails remain visible to that same authenticated session until expiry even if source SMB rights change meanwhile. Revoke the NAS Web session or restart the add-on if permissions need to take effect immediately for cached thumbnails.
- This is still **LAN testing only**; do not expose via KeenDNS yet.


## 0.5.0 — mobile media improvements

- Touch-swipe left/right in the photo viewer on phones; arrows remain available.
- Full-screen photo preview uses a cached 1600x1200 WebP instead of fetching the original photo. Download still returns the original.
- HTML5 video/audio playback is now provided by `/api/video` with standard HTTP byte-range requests (`206 Partial Content`), backed by SMB random reads. It no longer stages the entire media file in a temporary download before playing.
- Supported container/extension recognition: MP4, WebM, M4V, MOV, MP3 and OGG. Actual playback also depends on browser video/audio codec support. In particular, browsers may not play every MOV/HEVC recording.
- These changes are not yet tested against real smartphone browsers or the user's NAS. **LAN-only testing remains mandatory; do not publish through KeenDNS yet.**
