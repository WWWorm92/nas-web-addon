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
