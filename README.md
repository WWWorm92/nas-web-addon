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


## 0.5.1 — folder actions and sign-in

- Replaced native JavaScript prompt/confirm with accessible, touch-friendly dialogs for creating, renaming and deleting files/folders.
- Redesigned sign-in page with responsive layout, password visibility toggle and loading state.
- Backend now interprets common SMB errors (access denied, file exists, folder not empty, path missing), returning actionable messages and writing the SMB error to add-on logs.
- **Note:** backend code has not yet been tested against Simple NAS for folder creation/deletion. Successful browsing or uploading does not imply permission to delete or create directories. If actions still fail, send the specific UI error and corresponding NAS Web log line.
- Keep this add-on LAN-only while external HTTPS deployment and security testing are pending.


## Version 0.6.0 — mobile photo viewer and performance

- Full-screen viewer with **photo index/total** at the top (e.g. 2 / 234).
- Bottom **thumbnail carousel** replaces the previous arrow buttons, with the selected photo centered.
- Native touch **horizontal swipes**, **pinch zoom** (1–5×), dragging when zoomed and **double-tap to zoom/reset**.
- Smooth image transition and adjacent photo prefetch.
- On opening a photo, the small cached thumbnail is displayed first while a higher-resolution preview loads.
- Folder grids now fetch thumbnails **only when visible or near the viewport** with IntersectionObserver.
- Thumbnail cache is shared between a user's separate browser sessions and devices (same SMB username), stored under /tmp/nasweb-thumbs, capped around 192 MiB and expires after 24 hours. The cache is lost on add-on restart.
- Before cached bytes are sent, NAS Web authenticates the user and checks file-read access via Samba. The original files are not copied or modified.
- This is an unverified upgrade: please test on both the Pi 4 and a physical phone. First-time processing of uncached photos still has to download the original from the HDD and may be slow.
- Continue **LAN-only**; do not expose the app via KeenDNS yet.


## 0.6.1 Performance pass (experimental)

- **SMB round trips:** stop listing every share before each directory read, upload, download or file operation. The sign-in share allowlist still gates requests, and Samba performs the actual filesystem permission checks.
- **Photos:** each uncached original is read once and produces both small (256×192) and viewer (1600×1200) WebP renditions. Viewer opens no longer require another complete read of the same source after thumbnail generation.
- **Cache:** thumbnails and previews use the add-on's writable `/data/nasweb-thumbs` volume where available (falls back to `/tmp`); bounded at 384 MiB and aged out after seven days. Never cache originals.
- **User separation:** cache keys include the SMB username, share, path, and client-supplied modification metadata; every cache hit checks current SMB file-read rights. Passwords are not written to cache.
- **Mobile:** limit gallery thumbnail HTTP requests to three concurrent in-flight images, and only schedule images near the viewport.
- **Diagnostics:** requests exceeding 1.5 seconds on `/api/thumb`, `/api/list`, or `/api/video` generate `Slow request` log lines with elapsed milliseconds. Responses include `Server-Timing`.
- This code has **not** been benchmarked on a real Raspberry Pi / Simple NAS. The first read of an unseen photo still downloads the source over SMB; HDD throughput, CPU, Wi-Fi and browser behavior remain hardware-dependent.
- Test LAN-only; external KeenDNS publication is not cleared for this build.


## NAS Web 0.7.0

- Faster cold photo thumbnails: small previews are generated without full-resolution preview encoding. Opening a photo requests the larger preview on demand.
- Entire file rows and cards are clickable. Double folder navigation is fixed.
- Uniform blue-gray SVG icons for folders, images, video and documents.
- MOV: native playback is tried first, with a manual FFmpeg MP4 conversion fallback. Only MOV up to 300 MB, one conversion at a time and 5-minute processing limit; long or unsupported files remain downloadable.
- GitHub Actions checks Python and JS syntax and HTML/JS element references. Raspberry Pi hardware testing is still required; keep access LAN-only.

- Large downloads and PDFs now stream directly from SMB with byte-range support, instead of waiting for a complete temporary copy on the Raspberry Pi.


## 0.7.1 — cache persistence check

- The thumbnail cache **only** uses `/data/nasweb-thumbs`. Silent fallback to `/tmp` has been removed.
- At startup the add-on checks that it can create a test file and logs `NAS Web cache: path=/data/nasweb-thumbs writable=yes files=N size_mb=M`.
- If the directory is unwritable the add-on fails explicitly instead of discarding thumbnails on the next update.
- The first launch may have an empty cache because a previous version could have used ephemeral storage. After warming a photo folder, the next add-on upgrade should log a nonzero cache file count.
- Existing SMB data is unaffected. Only NAS Web's own preview files are stored in `/data`.


## 0.7.2 — Home Assistant OS /data permission fix

Fixes the crash on import of thumb_cache.py: `PermissionError: [Errno 13] Permission denied: '/data/nasweb-thumbs'` after upgrading to 0.7.1. At container start, a small entrypoint runs as root to create/chown only `/data/nasweb-thumbs` and `/data/nasweb-video` to uid 10001 with mode 0700, then execs Uvicorn through `gosu nasweb` (non-root). Do not recursively chown `/data` or touch Simple NAS SMB contents. Cache data is retained across add-on upgrades. Startup log reports cache path, writability, files and MiB. The Docker image must be rebuilt when installing this update.


## 0.7.3 — faster cold gallery SMB access

- Timings from Raspberry Pi: new photo thumbnails spend roughly 0.75–1.17s in SMB (connection plus file read), 0.17–0.37s decoding, and sometimes more than 1s waiting for the two image workers.
- Authenticated requests now reuse short-lived idle SMB connections within the **same signed-in session**, never across accounts or concurrently. Pool is capped at three idle connections per session and 12 globally, with 35-second idle expiration. Connections are dropped after an operation error, after logout, and on application shutdown.
- Login credentials are still verified with a fresh SMB connection. Samba enforces normal file/share permissions. No change to files or thumbnails.
- Slow thumbnail logs now additionally show `connect=...ms read=...ms reused=true|false` to separate authentication/transport overhead from HDD transfer. Check new lines after upgrade to confirm whether pooling improved first-load times. Hardware benchmarks have not yet been run.


## 0.7.9 — original photo caching and swipe prefetch

- Original photo blobs are cached in browser memory using a 48 MiB LRU limit (not persistent browser storage).
- Reopening already cached photos skips another SMB transfer; cached entries are scoped to the current signed-in session, SMB share, folder, filename, modification timestamp and file size.
- After the current photo is fully loaded, the viewer prefetches the next photo, reuses an in-progress request when swiping, and cancels irrelevant transfers.
- While the photo viewer is open, it pauses starting new gallery-thumbnail requests. Existing requests can finish.
- Browser photo memory and object URLs are cleared on login changes, logout, share changes and folder changes. Closing the viewer keeps the bounded cache available for re-opening photos.
- Server-side photo-stream priority from 0.7.8 remains in place.
- On-demand performance depends on SMB/HDD throughput. Images not yet prefetched still require a full original transfer. Browser JS syntax checked; real device testing pending.


## 0.8.5 — copy, move and ZIP

- Select files with the **Выбрать** button or a long press. Use **Копировать** or **Переместить**, then browse the folder chooser (including other SMB shares).
- Files can be copied/moved between shares. Directories can be moved **within the same share** but recursive directory copying or cross-share directory moves are not supported yet.
- File names are never intentionally overwritten: if an item with the same name exists in the destination, the operation returns a conflict.
- Cross-share moves copy first and delete the original only after a successful transfer. Interrupted transfers can leave a partial destination copy; verify the destination if interrupted.
- Transfers are limited to 512 MiB per file to bound local spool usage. ZIP download supports up to 100 selected **files**, total uncompressed size at most 512 MiB; folders are excluded. ZIP uses temporary storage and the browser downloads the result.
- Each operation uses existing session authentication, CSRF and the Simple NAS SMB ACLs.
- Real Raspberry Pi device testing is pending.


## NAS Web 0.9.5 — общая фотогалерея

- Нижняя кнопка **Фото** вместо **Выбрать** открывает общую ленту фотографий из всех SMB-шар и вложенных папок, доступных пользователю.
- В файловом менеджере выделение по-прежнему доступно долгим нажатием или через **Ещё → Выбрать файлы**.
- Лента группирует снимки по месяцам, поддерживает переход по годам, ленивую загрузку миниатюр и подгрузку фотографий по 90 штук.
- NAS Web постепенно обходит папки (не более трёх за запрос) и затем считывает EXIF даты небольшими партиями; прогресс виден в интерфейсе. SQLite-индекс сохраняется в `/data/nasweb-auth/gallery.sqlite3` при обновлениях и перезапусках.
- **Обновить фототеку** полностью перестраивает индекс после изменений на NAS. Просмотр фотографий не изменяет исходные файлы.
- Защитные лимиты индексатора: до 100 000 фотографий и 20 000 папок на пользователя. Фотографии показываются только из шар текущей сессии; доступ к каждому оригиналу и превью дополнительно проверяется SMB.
- Первое сканирование больших хранилищ может занять продолжительное время. Папки, в которые SMB не позволяет войти, пропускаются.
