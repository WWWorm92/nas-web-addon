## 0.22.47

- Fix oversized mobile bottom navigation labels introduced by the unified SVG icon update. Use semantic `small` labels inside the five mobile navigation buttons, instead of styling them as generic `span` elements inherited from the 22px icon-sized buttons.
- Ensure captions are 10px, centered, single-line and clipped within their own grid columns; preserve accessible button names and touch targets.
- Restore the blue accent background exclusively to the Add (+) icon rather than accidentally giving that background to its text label.
- Correct the sort icon to a conventional up/down arrow pictogram.
- Add regression checks for compact mobile nav labels and isolation of the Add label from legacy `.mobileAdd span` rules.

## 0.22.46

- Protect existing NAS files during photo/file uploads: upload into a random, create-only temporary `.nasweb-upload-<128-bit-token>.part` file inside the destination SMB folder, check the remote stored byte count against the locally received file, then publish with a single same-directory SMB2/3 rename (ReplaceIfExists).
- Never stream directly into an existing target, pre-delete the original, or attempt an unsafe backup-and-restore fallback. If upload/verification/rename fails before commit, the original stays untouched and a best-effort cleanup removes the temporary file.
- When a remote file is shorter than the received upload, return HTTP 502 rather than exposing a partial photo under its final name. Preserve the existing gallery indexing only after a successful commit.
- Use Impacket create disposition FILE_CREATE for staging to prevent temporary-name collisions from overwriting other writers.
- Add outage, size mismatch, name collision, rename-denied, empty-file and original preservation tests, plus backend/adapter safety integration contracts.
- Note: process termination or SMB disconnection may leave an orphan `.part` file, and disconnection precisely after the atomic rename can leave an ambiguous client-visible result. Original bytes are never proactively deleted by the upload handler.

## 0.22.45

- Completed a source-level code review covering FastAPI, SMB operations, credentials and administrator, indexing/EXIF/HEIC, imports, recycle bin, browser app and CI. Findings and open data-integrity risks are in CODE_REVIEW_2026-10-23.md.
- Replaced system-dependent Unicode/emoji controls and inconsistent inline artwork with a cohesive self-hosted SVG outline set, unified in the file manager, image/video viewer, all-photo gallery, mobile navigation, uploads, album actions, profile, Google Photo import and administrator.
- Centralized icon definitions in app/nas-icons.js with a proper static route, consistent strokes, colors, touch sizes and accessible labels. No external icon font or CDN. Keep native file-input elements and event handlers intact.
- Updated NAS Web SVG favicon and Home Assistant/PWA PNG icon generator to the same outlined NAS drive language; see ICONS.md for the icon license.
- Preserve genuine upload failure causes: route SMB errors through smb_action_error rather than responding HTTP 403 for all backend exceptions.
- Add automated tests for common icon rendering, asset routing, accessibility and file-input preservation, while retaining the previous video, mobile and gallery regressions.

## 0.22.44

- Add native HEIC/HEIF support for iPhone photos in NAS Web on aarch64 Raspberry Pi and amd64. Install pinned pillow-heif for Pillow 11.3.0; keep originals untouched on SMB.
- Show HEIC photos in the file manager, fullscreen viewer, filmstrip and all-photo gallery. Decode once on the server to browser-compatible cached WebP thumbnails/previews; large iPhone images up to 55 megapixels are accepted.
- Include HEIC/HEIF in incremental gallery indexing, background EXIF-date checks, gallery date progress, photo statistics and immediately indexed uploads/Google Photos imports. Existing folders are discovered on the normal incremental refresh without clearing the photo database.
- Read HEIC/HEIF capture dates via bounded SMB reads (max 25 MiB), falling back to existing file modification date for oversized or undated files. Limit HEIC decode concurrency to one task for Raspberry Pi resource safety.
- Add regression tests encoding real HEIF photos for decoder, EXIF, bounded SMB read, gallery SQL and WebP previews as well as frontend/backend integration checks.

## 0.22.43

- Keep the mobile file-manager Back button and SMB breadcrumb path permanently attached to the Files header while scrolling. Previously the header was sticky but the separate path row scrolled underneath it and disappeared.
- Wrap title/actions and path in one sticky mobile block with a solid theme-aware background. Preserve the existing path buttons, folder navigation and horizontal path scrolling.
- Ensure this header is hidden on desktop and in the global Photos gallery, with the selection toolbar pinned below it on phones.
- Add a regression test for the navigation wrapper and sticky CSS.

## 0.22.42

- Fix full-screen photo viewer displaying folder photos in seemingly random order compared to the file manager. The viewer previously used the raw SMB listing while the folder UI applied name/date/size sorting.
- Share the same visible folder item order between the regular grid/list and its full-screen photo filmstrip, including active folder search filters; preserve the separate date sort used by folder gallery mode.
- Keep the All Photos gallery and single-video playback behavior unchanged, and add a regression for folder list sorting and fullscreen navigation.

## 0.22.41

- Fix intermittent missing destination dialog when selecting photos, especially large iPhone/iCloud batches: choose the SMB share/folder **before** opening the native file picker. The iOS picker is opened synchronously from the confirm button gesture.
- Show clear messages when upload cannot start because no SMB shares are available or another batch is still active, instead of silently discarding files.
- Keep the existing drag-and-drop flow (files first, destination second) and reset the file input only before a new selection; preserve the selected File objects while iOS materializes them.
- Add a regression test for mobile/desktop destination-first flow and native picker activation.

## 0.22.40

- Fix **All photos** infinite scrolling stalling after a few pages: the old gallery relied on a single IntersectionObserver threshold crossing at the Show More sentinel. A persistent intersection no longer stops new pages.
- Independently recheck near-bottom pagination on scroll, window resize, and **after every completed page**; avoid duplicate concurrent fetches and stop at the actual database total.
- Make the next-page action available as soon as there are more indexed photos, even while the SMB tree/background EXIF scan is running. Do not discard already loaded pages on scan completion when someone has scrolled down.
- Handle failed or unexpectedly empty pages without hammering the NAS in a request loop. Show an explicit **Retry loading** button using the same offset and keep existing photos on screen.
- Add Node regression covering 1,305 photos / 15 pages with a perpetually visible sentinel, scroll-to-load behavior, failed page retry and an unexpectedly empty page.

## 0.22.39

- Remove the native **"Перейти к месяцу"** dropdown from the gallery. Replace it with a compact, horizontally scrollable **month timeline**: drag/swipe on mobile, mouse wheel, arrow buttons or keyboard on desktop. Each date chip shows the month and number of photos.
- Retain the year shortcuts and the **Все фото** reset, with the month strip scoped to the selected year (or the newest year when none is selected) so large galleries spanning decades stay navigable.
- Expose year and month date scrolling directly on the mobile gallery rather than burying navigation inside Settings. Keep zoom and indexing preferences in the existing Settings menu.
- Highlight the active month and year, automatically center the selected month, and preserve the strip's horizontal position across photo-grid redraws.
- Preserve existing month offsets, safe token-based pagination, SMB access controls, EXIF scanning and index state. Add interactive JS regressions for date navigation, active state, scrolling continuity and returning to all photos.

## 0.22.38

- Fix gallery year navigation trapping users in paginated year/month mode. Add an always-visible **Все фото** chip before the year shortcuts and a contextual **← Все фото** button next to the month picker after jumping.
- Clicking the selected year again also returns to the full chronological gallery; clearing the month dropdown does the same.
- Restore the starting page at photo offset 0 without leaving the gallery or rebuilding the underlying photo index. Invalidate obsolete in-flight pagination requests so older year responses cannot overwrite the restored gallery.
- Preserve active year highlighting through virtual-grid renders and return to the top of the unified photo library on reset. Add dedicated Node UI regressions for chips, selected state, jump offset, reset and request tokens.

## 0.22.37

- Speed up multi-select Move to Trash: send up to 500 selected siblings per request, reuse one authorized SMB session, list the source and trash folders once per batch, use atomic SMB renames, and record all successful recycle moves in one SQLite transaction. Return honest partial-success counts and retain separate permanent deletion rules inside .recycle.
- Exclude the .recycle subtree from gallery discovery and EXIF scanning; one-time migration removes previously indexed trash photos/folders from the SQLite gallery index **without deleting SMB files**.
- Remove successfully trashed photo paths, including whole folder subtrees, from all affected users' gallery indices immediately. Leave failed paths intact for retry.
- Introduce small photo ⋯ menus in the global gallery grid and fullscreen preview. Provide **Share** (native file sharing on supported HTTPS browsers), **Info**, **Favorites and albums**, **Download original**, and **Move to Trash** with confirmation.
- Keep native share private: no unauthenticated public URLs are generated; browsers without file-sharing support offer download instead. Photo actions remain scoped to authenticated SMB permissions.
- Add regression coverage for batch listing count, trash collisions, old recycle index migration, immediate gallery invalidation and photo menu wiring.

## 0.22.36

- Keep background EXIF indexing active when photo folders are hidden from the unified gallery. The worker now checks the actual unfinished EXIF queue (including hidden folders) rather than the visibility-filtered count.
- Preserve privacy: gallery photo counts, month navigation and the visible "EXIF: to check" indicator still exclude hidden folders. No hidden items or their metadata leak into the gallery.
- The change does not reset the shared photo index or trigger a new full scan. Tests cover hidden-folder metadata being processed and retaining its correct capture date when shown again.

## 0.22.35

- Исправлен поиск JSON-метаданных Google Takeout для длинных и обрезанных имён файлов, включая распространённые варианты имён копий.
- Повторная загрузка того же архива в ту же SMB-папку восстанавливает даты уже перенесённых фотографий без создания дублей; совпадение проверяется по SHA-256.
- Даты сохраняются в индекс галереи по мере обработки архива, а не только в самом конце.
- При временном разрыве SMB-соединения импорт пытается восстановить подключение и повторить неудачную запись.
- Для новых импортов сохраняются причины ошибок и имена файлов. В профиле можно посмотреть категории ошибок и скачать отчёт JSON.
- Старые журналы импорта не содержат имён неудачных файлов, поэтому для повторной диагностики требуется исходный архив.

## 0.22.34

- Redesign the mobile **More** menu as a compact, minimal sheet with a profile shortcut, muted grey-blue outline icons, subtle grouped rows, and a separated sign-out action. Remove the oversized stack of rectangular buttons; reduce sheet height and visual clutter.
- Keep just **Profile**, **Favorites & albums**, **Photo statistics**, **Appearance**, and **Sign out**, organized as account, phototheque, app settings and exit. Show current account name and avatar color and the active appearance theme.
- Remove redundant **Select files** and **Refresh list** actions from More; file selection and refreshing remain available in the contextual Files ⋮ menu, and the gallery still has its own refresh.
- Simplify the Files ⋮ menu to file-related actions only (grid/list, select files, create folder, refresh); avoid duplicate account/theme/logout entries.
- Scope the new styles and DOM to the More sheet so photo details, album menus, file action sheets and other reusable bottom sheets are not affected. Add Node UI regression coverage.

## 0.22.33

- Allow **large Google Takeout ZIP files** up to 32 GiB per archive (configurable `max_import_mb: int(1,32768)`); new add-on installs default to 8192 MiB (8 GiB), enough for a 6.5 GB Takeout ZIP.
- Before creating or resuming a ZIP upload, check actual free space on the add-on's **/data** volume, leaving 512 MiB headroom. If insufficient, return an actionable message instead of filling the Raspberry Pi storage. This is distinct from available SMB share space.
- Display the current configured ZIP limit and usable temporary storage capacity inside **Profile → Google Takeout**; prevalidate oversized files before starting a transfer.
- Distinguish invalid ZIP metadata from the configured size cap and disk space errors. Give users the specific `max_import_mb` setting and recommended values.
- Preserve the resumable 1 MiB chunk mechanism and automatic temporary-file cleanup from 0.22.32. Add 6.5 GiB acceptance and low-space regression tests.
- **Existing installations:** Home Assistant retains the previously saved `max_import_mb` option (often 2048), even after upgrading. Change this option to `8192` or `10240` in the NAS Web add-on configuration and restart before retrying large archives.

## 0.22.32

- Fix Google Takeout ZIP uploads failing with `starlette.requests.ClientDisconnect` when browsers, proxies or mobile networks interrupt a large one-request transfer.
- Replace monolithic upload with 1 MiB authenticated and owner-scoped chunks. Each chunk has an explicit byte offset, can be safely replayed, and is stored in a private SQLite-backed resumable staging session. The browser retries transient connection failures and first checks the saved offset so an ACK lost after a successful chunk cannot create duplicate bytes.
- Closing/reloading the page does not discard the incomplete ZIP: select the **same** archive again in Profile to resume from the verified server-side offset. Resumable partial ZIPs survive add-on restarts and expire after 36 hours if inactive.
- Verify the full file size and ZIP header before launching the existing background importer. On completion, the worker deletes the temporary archive as before. Authenticated users cannot read or append to each other's staged ZIPs.
- Handle incomplete client chunks explicitly without unhandled ASGI exception-group tracebacks. The original all-in-one upload endpoint now responds with a clear upgrade message.
- Improve Takeout UI transfer progress and recovery guidance; add Python and Node regression tests for chunk retransmission, reconnects, owner isolation, startup cleanup and frontend lost-ACK recovery.

## 0.22.31

- Move **Memories** out of the mobile "More" menu and into the top of the unified gallery on desktop and mobile, styled as a horizontally scrollable Google Photos-like Stories strip.
- Group available "On this day" photos into story cards by number of years ago, with cover thumbnails, captions and photo counts. Respect existing user-specific SMB gallery visibility and EXIF capture dates.
- Opening a memory card uses the existing full-screen photo viewer, filmstrip and swipe navigation without replacing the complete gallery or losing its timeline, filters, or scroll position.
- Hide the shelf when there are no memories or when a virtual album/favorites subset is open; update it on full-gallery entry and relevant library changes.
- Preserve the carousel's position and avoid unnecessary thumbnail reloads when virtual gallery rows redraw. Add dedicated regression tests.

## 0.22.30

- Add **Google Photos imports inside each SMB user's Profile**: no new main-navigation icon or screen.
- Import one or more Google Takeout ZIP parts using a raw streaming upload to a private, size-limited temporary archive; process media entry-by-entry, validate paths and expansion limits, and never overwrite existing SMB files.
- Pair Takeout media with matching Google `photoTakenTime.timestamp` JSON sidecars, preserve the capture date in the shared gallery metadata index, and reuse the existing incremental gallery refresh. The original JPEG/video bytes are never edited.
- Add per-profile OAuth 2.0 connect/disconnect and Google Photos Picker session flow: explicitly select photos/videos in Google, poll readiness, import only the selected items and clean up the session.
- Encrypt Google refresh tokens on disk with a private Fernet key; bind OAuth callbacks to one-time state and the initiating SMB user, filter download hosts, reject redirects, and enforce SMB ACLs and CSRF on all import actions.
- Maintain persistent import progress and content-hash duplicate tracking. Following add-on restart, unfinished jobs become interrupted; re-importing the same archives skips copies already recorded.
- Add an independent SMB destination folder picker in Profile, import status and upload progress, new Google Cloud options and regression tests.
- Known limitations: Google OAuth configuration is required for Picker; Takeout import is per-ZIP-part, with temporary local disk space needed. For EXIF-free photos, capture dates are stored in NAS Web's gallery database, not inserted into the original files. Non-gallery media types stay available in the file manager.

## 0.22.29

- Fix the profile folder binding button being disabled in the global gallery, at the root of a share, or without a current file-manager folder.
- Add an independent folder chooser inside the profile, with SMB share selection, breadcrumb navigation and a folders-only list. The add action stays available without leaving the gallery or changing the active directory.
- Disable confirmation only for the SMB share root (which cannot be bound) or while validating a selected directory. Keep live SMB access checks, owner conflict prevention and gallery visibility unchanged.
- Add a browser regression test for binding a folder from gallery mode and excluding recycle-bin/file entries from the picker.

## 0.22.28

- Add editable SMB-linked personal profiles with display names and avatar colors. Profile names are cosmetic; Simple NAS remains the only SMB login and ACL authority.
- Let signed-in users bind readable non-root folders from the file manager to their own profiles. Prevent duplicate and overlapping folder ownership across accounts.
- Allow the owning user to hide or reveal a bound folder in the unified photo gallery for every authenticated SMB account, without changing any SMB permissions or deleting the file, photo index, thumbnail cache or EXIF metadata.
- Apply shared visibility to gallery pagination, totals, full-index month navigation, albums, favorites, memories and gallery statistics; notify already-open galleries using index revisions.
- Add mobile and desktop profile UI, folder bindings with remove and show/hide controls, and regression tests for ownership and multiple SMB users.

## 0.22.27

- Improve the existing streamed SMB video viewer on desktop and mobile. Remember MP4/M4V/MOV/WebM playback position locally in the current browser, scoped to the logged-in SMB username, share, file path, file size and modification time. Automatically seek to that position after metadata loads, without forcing autoplay. Clear positions when viewing is finished; retain at most 150 recent positions for 60 days.
- Add small 10-second backward/forward and fullscreen controls beneath the native video player; Left/Right keys seek through video rather than invoking photo navigation while a video is open.
- Display video frame thumbnails in the regular file manager using the existing visibility-aware image queue. Extract just the first reduced frame from up to 8 MiB of the authenticated SMB file prefix using a 12-second, one-worker FFmpeg limit. Cache WebP posters separately for each SMB account and file version; use the standard video icon if a video cannot provide a frame without full download.
- Perform live SMB can-read and share authorization checks even on cache hits, and keep FFmpeg processing separate from the SMB connection. Do not auto-transcode videos or alter originals, gallery EXIF indexes, storage, trash or HTTPS.
- Preserve explicit, bounded MOV-to-MP4 compatibility fallback and display clearer codec-related playback failures for other formats.
- Add regression tests for user/version-isolated resume, playback controls, bounded FFmpeg extraction, negative cache and SMB ACL checks.

## 0.22.26

- Virtualize folders containing more than 160 files in the file manager (grid and list layouts). Render only nearby rows while retaining the complete folder metadata for selection, sorting, file actions and navigation. Reuse mounted tile nodes and re-observe lazy thumbnails after a scroll update.
- Measure the browser's actual file row height and responsive columns to preserve scroll range. Update the virtual viewport on scroll and on window/container resize. Keep the independent full-photo gallery virtualizer intact.
- Speed up returning to recently opened folders using a bounded 12-entry, 15-second browser-memory cache of folder metadata. Every open still issues a fresh authenticated SMB list request, and revoked/inaccessible folders are cleared on error. Cache and pending requests are invalidated across sign-in and sign-out.
- Prevent stale responses from an earlier folder request from replacing the current directory. Restore saved scroll positions immediately for a cached parent folder and after authoritative SMB refresh.
- Add regression tests for 10,000-file folders, virtual spacer height, grid/mobile layouts, bounded cache, cross-share isolation and live SMB revalidation.
- No changes to SMB backend, ACLs, photo indexing, recycle bin, login sessions, HTTPS, or stored files.

## 0.22.25

- Automatically refresh the unified gallery while it is open: check the existing photo index every 45 seconds, and refresh its first page and full month timeline when file names or EXIF dates have changed.
- Reconcile external SMB additions, deletions, renames and changed file metadata by re-listing folders every 10 minutes while the gallery is active. This is incremental metadata scanning, not a reset of the photo index and not a full read of image contents.
- Defer automatic UI changes while browsing older photos or viewing an image so the user does not lose their scroll position; apply the pending change on returning to the top of the gallery.
- Track a persistent revision per account, migrating existing SQLite databases in place. Unchanged listings do not trigger UI refreshes. Own browser uploads refresh the gallery immediately when the viewer is at the top.
- Prevent accidental index deletion on temporary SMB errors, and recognize successful empty folder listings as genuine deletions. Preserve SMB authorization checks and per-account separation.
- Add tests covering SQLite migration, EXIF preservation, external SMB changes, empty folders, failed SMB reads and safe browser auto-refresh. No changes to existing photo files or thumbnail caches.

## 0.22.24

- Show the unified photo gallery in one newest-first chronological order: capture date (EXIF) when present, otherwise the file modification time. Undated PNG/JPEG/WebP/GIF photos now appear alongside dated photos instead of being sent to the end of the gallery.
- Compute full-library month navigation and pagination offsets with the same mixed chronology and the browser's timezone offset. Remove the artificial 'no capture date' month.
- Remove the gallery's EXIF-vs-modified sorting selector; leave file-manager sorting unchanged. Preserve dates, shared EXIF metadata, the index database, user SMB ACLs, cached thumbnails and background scanning.
- Add regression tests for new PNG without EXIF, mixed chronology, month offsets, timezone, and user access separation; update gallery virtualization and calendar tests.

## 0.22.23

- Fix Firefox showing a blocked-frame page when opening PDFs in the NAS Web viewer through KeenDNS.
- Permit same-origin embedding only for successful inline PDF streams from /api/file (HTTP 200 and 206): X-Frame-Options SAMEORIGIN and CSP frame-ancestors 'self'.
- Preserve DENY / frame-ancestors 'none' for all other endpoints, file downloads, errors and non-PDF content.
- Preserve SMB ACL checks, credentials, no-store caching, file streaming, range support and other CSP protections.
- Add PDF frame-policy security regression tests to GitHub Actions.

## 0.22.22

- Improve the upload center with transfer speed, estimated remaining time and bytes sent, plus a separate server-side SMB saving state. Do not show completion until /api/upload responds successfully.
- Allow canceling queued files and in-flight browser upload requests, with per-file and cancel-all controls. No deceptive cancellation after the upload body was fully sent, when SMB write may already be running.
- Make the upload center accessible in both file browser and gallery on desktop/mobile while files are being uploaded. Throttle progress UI refresh and prevent competing upload batches.
- Keep existing SMB permissions, server upload endpoint, photo/EXIF index, gallery and on-disk files untouched.
- Add tests for upload progress, cancellation safety and successful/error responses.

## 0.22.21

- Improve desktop file manager without changing its layout: Ctrl+A selects visible files, Ctrl+C and Ctrl+X copy/cut selected files into an in-app buffer, and Ctrl+V copies or moves them into the open folder. The buffer is kept only for the current authenticated page session; the system clipboard is untouched.
- Add F2 rename, Delete (using the existing confirmation and recycle-bin behavior), Escape selection clearing, and Ctrl/Cmd-click selection. Shortcuts do not activate inside input fields, dialogs, or the photo viewer.
- Allow dragging files or selected groups into a folder tile or a breadcrumb parent folder on desktop. Only same-share moves are permitted by drag-and-drop; moving folders into themselves or into recycle is disabled. Uses the existing authenticated transfer endpoint and SMB permission checks.
- Keep ordinary computer-to-NAS file drag-and-drop upload separate from in-app moves. Mobile long-press, swipe, and menus remain unchanged.
- Restore previous scroll position when returning to a parent folder via breadcrumbs, Up or the mobile breadcrumb, without resetting the photo gallery index.
- Add file manager keyboard, transfer destination and drag/drop regression tests in GitHub Actions. No SMB backend, EXIF index, HTTP/HTTPS or file storage changes.

## 0.22.20

- Render only the currently visible and nearby rows of the shared photo timeline instead of mounting every loaded photo tile in the browser DOM. Invisible rows become fixed-height spacers; no files, database rows or cache entries are deleted.
- Preserve day headings, EXIF/modified sorting, selection, context menus, fullscreen preview, swipe navigation, and lazy pagination (90 images per server page).
- Include the active date heading during scrolling and keep month/year jumps based on the complete SQLite month index rather than just rendered images.
- Recalculate gallery row sizes on desktop/mobile width changes and when the gallery density is changed. Retain the scroll location when pages append or the viewer closes.
- Add regression tests for 10,500 photos, varying date groups, visible range, spacer height conservation and column count changes.
- No backend or SMB ACL changes. Gallery index, original photos, server thumbnail cache, trash and HTTPS remain untouched.

## 0.22.19

- Prioritize visible gallery and file-manager thumbnails; defer offscreen images that moved away while queued and resume them when they scroll back into view. Keep the three-request client concurrency cap.
- Avoid repeated layout measurements during thumbnail queue sorting, and continue giving fullscreen image downloads priority over queued thumbnails.
- Bound background original-photo prefetch to images up to 12 MiB, available 48 MiB in-memory cache capacity, and respect browser data-saver mode. Do not evict recently viewed originals solely for speculative prefetch.
- Discard responses from aborted photo fetches before adding browser-memory cache entries.
- Add Node.js regression tests for thumbnail priority, scroll-away/return, viewer pause, and cancellation; execute them in GitHub Actions.
- No changes to SMB permissions, server-side thumbnail cache, HTTPS settings, SQLite photo index, or stored files.

## 0.22.17

- Keep already downloaded gallery thumbnail images when the photo list grows or refreshes; avoid repeated image downloads and avoid stalled loading slots after cancelled requests.
- Increase foreground thumbnail concurrency modestly from two to three, without increasing the NAS Web SMB thumbnail render worker limit.
- Stop EXIF-only status polling from unnecessarily recreating gallery photo cards.
- Prioritize thumbnail requests and fullscreen originals over background EXIF scanning to reduce SMB contention.
- Reuse the per-session SMB share tree when verifying cached-thumbnail access, while still opening EACH file and enforcing its current SMB read permission; no authentication or ACL bypass.
- Add CI regression checks for repeated thumbnail ACL reads, stale tree invalidation, browser queue reuse, and EXIF priority.
- Preserve gallery index, photo dates, existing photo files, trash retention, and SMB permissions.

## 0.22.16

- Distinct neutral trash-can icon for the `Корзина` (`.recycle`) folder, instead of a regular blue folder.
- Add **Restore** action to the trash item context menu (desktop and mobile); new deletions return to their saved original path. Existing legacy trash items without location metadata return to the root of their SMB share. Never overwrite existing paths.
- Automatically permanently remove recycle-bin entries after 14 days; a background worker checks hourly, even when nobody is logged in. To enable unattended cleanup, the deleting user's SMB credentials are stored encrypted using NAS Web's existing protected secret key and discarded when their last trash item is gone.
- Pre-existing trash items without a recorded deletion time receive a new 14-day window on their first authenticated view after upgrading, preventing immediate accidental expiry.
- Remove extra typed `УДАЛИТЬ` confirmation and artificial 5,000-object / 64-level deletion caps. Standard confirmation remains for explicit permanent deletion.
- Keep Simple NAS SMB ACL enforcement, ordinary move-to-trash behavior, protected authorization, gallery index and EXIF dates unchanged.

## 0.22.15

- Fix contradictory deletion dialog: ordinary files and nonempty folders are moved intact to their share's recycle folder; they do not require empty directories and are not permanently removed.
- Add a separate, explicit **permanent** deletion for items already within `.recycle/`. Directories can be removed together with their children; the confirmation requires manually typing УДАЛИТЬ. Selected files and multi-selection also receive an irreversible action warning.
- Enforce SMB user/share authorization, origin and CSRF checks, selected filename matching, recycle-only containment and ancestor reparse-point checks on the server.
- Preflight the full selected subtree with a bounded 5,000-entry / 64-level limit before deleting anything; refuse SMB directory links, invalid paths and oversized trees.
- Never delete the share recycle root or normal live files via the permanent-delete endpoint. If deletion encounters a write/permission failure mid-process, a subset may already have been removed.
- No changes to photo gallery index, known EXIF dates, SMB ACLs, or home screen layout.

## 0.22.14

- Remove duplicated desktop sidebar section links ('My files' / 'All photos'); navigation lives only in the top Files/Photos tabs.
- Keep the SMB shares listed in the left sidebar, visible gallery return control, and all file actions.
- Mobile layout, photos, index, EXIF dates and SMB access permissions are unchanged.

## 0.22.13

- Remove only the redundant desktop 'NAS WEB · МОЁ ОБЛАКО' overview card and its repeated quick action buttons.
- Preserve desktop Files/Photos tabs, sidebar, existing file search/toolbar, gallery return navigation, and mobile layout.
- No changes to SMB permissions, authentication, media files, photo index, or EXIF metadata.

## 0.22.12

- Fix desktop gallery navigation: Files/Photos tabs remain visible in the top bar; persistent 'Back to files' button works even when indexing details are collapsed.
- Add the same navigation to the desktop sidebar with active-section indication; keep SMB share navigation unchanged.
- Refresh desktop NAS Web home: a compact welcome panel for each share root, quick access to the unified photo gallery, upload, and creating a folder using existing permission-checked operations.
- Keep mobile navigation/layout unchanged; compact desktop and tablet widths retain a visible gallery return.
- Add CI checks for the navigation and desktop quick-action DOM contracts.
- No changes to SMB authorization, photo files, index, gallery dates or EXIF processing.

## 0.22.11

- Fix **gallery month/year picker only listing months from already-loaded photo tiles** (e.g., 360 of 10,402). New ACL-scoped `/api/gallery/months` returns all months from the persisted SQLite index with exact absolute positions in current sort order.
- Selecting a month or year fetches the relevant photo page even when its thumbnails have never been loaded. Lazy loading continues from that offset.
- Include historical years and 'no capture date' in EXIF mode. File-modification month options respect browser time zone.
- Refresh month navigation during ongoing EXIF discovery without rebuilding the photo index.
- Preserve current EXIF and modified-date values, photo files, gallery ACLs, and user collections.
- Add regression CI tests for unloaded historical months, gallery offsets, user isolation and time-zone boundaries.

## 0.22.10

- Explain that the admin EXIF queue is aggregated across all indexed SMB users; show a separate per-user breakdown, with currently logged-in SMB user highlighted.
- Distinguish per-user pending, dated, checked-without-date, and blocked EXIF records. Aggregation and read-only diagnostics do not modify photo rows or saved dates.
- Fix gallery sort switching so selecting 'file modification date' restores the old file-date chronology without terminating background EXIF scanning or leaving the gallery blank when a request is still in progress.
- Keep 'EXIF capture date' as a deliberate user-selected display mode; do not rewrite or reset either date source.
- Add automated tests for per-user counts, date preservation and gallery index scoping.

## 0.22.9

- Fix `STATUS_ACCESS_DENIED` during EXIF extraction and ranged media streaming on read-only SMB files: Impacket `openFile()` defaults to requesting both READ and WRITE; range reads now explicitly request READ only with read/write/delete sharing.
- Expire old false-positive EXIF SMB access-denied cooldowns one time, allowing the repaired reader to retry immediately; new genuine denial cooldowns are still respected.
- Do not change file access permissions, user credentials, photo index entries, gallery sorting or saved EXIF dates.
- Add CI regression tests for exact SMB open access flags and one-time denied-file cooldown migration.

## 0.22.8

- Fix inflated EXIF pending count after admin "retry": safe resume does not reset already-checked photos with no capture date or delete cached negative metadata.
- Honor persisted positive **and negative** metadata cache to recover work queued by earlier versions without repeatedly opening the same files.
- Remember SMB STATUS_ACCESS_DENIED per user/file/version with 24-hour cooldown, without changing gallery dates, photo rows, file contents, or SMB ACLs. Allow retry after cooldown or file modification.
- Stop worker and UI polling when no actionable EXIF work remains; distinguish actively pending files from temporarily inaccessible ones.
- Show per-user index records versus unique files, checked-without-EXIF, SMB-denied and actionable EXIF counts in admin.
- Add regression CI for the EXIF queue and ACL retry, plus admin JS and entrypoint syntax checks.

## 0.22.5

- Fix admin first-run setup failing with permission_denied: startup copies Supervisor-owned /data/options.json into private /data/nasweb-auth/options.json owned by the non-root app user.
- Application reads the private copy after privilege drop. Supervisor configuration file ownership and mode are unchanged.
- Existing photo index, SMB ACLs and user data remain untouched.

## 0.22.2

- Move manual EXIF retry to admin-only maintenance. Requires both independent admin authorization and a current SMB user session, preserving SMB access boundaries.
- Replace user-facing refresh behavior with a safe reload and incremental scan; no full index reset.
- Disable legacy destructive /api/gallery/reindex endpoint to protect existing photo index and capture dates.
- Keep normal user incremental photo discovery working.

## 0.22.1

- Finish standalone /admin dashboard: photo-index progress, EXIF queue, cache usage, /data free space and safe maintenance events.
- Cache maintenance removes expired/over-limit thumbnail files without touching photo index or SMB files.
- Admin password change revokes other admin sessions.
- Move admin JavaScript to a same-origin static asset compatible with Content-Security-Policy (no inline scripts).
- Never show raw SMB log messages or credentials in the admin event feed.
- SMB users, photo dates and existing gallery index are unchanged.

## 0.22.0

- Separate NAS Web service administrator with its own PBKDF2 password and revocable 4-hour session; no SMB identity or access to user files.
- First-run setup protected by admin_setup_key (24+ characters) configured in add-on options.
- /admin dashboard shows indexed photo counts, scan jobs, and persistent thumbnail cache statistics.
- Hide EXIF retry maintenance control from the standard user interface (API behavior retained).
- Existing SMB accounts, photo index, gallery dates and file ACLs remain unchanged.

## 0.21.0 (initial feature integration)

- Private virtual favorites and albums, stored separately from the photo index and SMB files.
- On-this-day memories from existing EXIF dates and indexed photo storage statistics.
- Mobile More menu and photo long-press actions for collections, memories and statistics.
- Existing range-streaming video player, MOV fallback and persistent thumbnail cache retained; no full-gallery video indexing or new cache tuning in this release.
- No photo index reset, SMB write, permission changes or date display changes.

## 0.20.1

- Compact mobile file rows and remove redundant folder-type subtitles.
- Reduce the size and number of actions in the mobile More sheet.
- Use consistent vector navigation icons and remove duplicate gallery-header search control (bottom Search remains).
- Preserve gallery date display and sorting exactly as before; no database, EXIF, SMB or ACL changes.

## 0.20.0

- Refine mobile navigation, headers, gallery cards, settings panel, search field and tap feedback.
- Improve safe-area spacing and reduce visual noise with consistent radii and typography.
- Respect reduced-motion accessibility preferences.
- Presentation-only update: no changes to SMB permissions, photo index, metadata extraction or file operations.

## 0.19.0

- Expand photo capture-date parsing to JPEG, PNG and WebP metadata, including textual date fields; read at most 1 MiB per file.
- Add a separate overnight 'Повторно проверить даты' operation for photos without recognized capture dates; keep all known EXIF dates and existing folder/photo index.
- Skip stale no-date cache entries during retries and keep background scan bounded to eight hours.
- Preserve original files, SMB ACLs, thumbnails and photo index; the existing 'Обновить фототеку' action is separate.

## 0.18.7

- Make the bottom mobile Search tab toggle a visible, focusable search input in files and gallery.
- Remove the duplicate date sorting selector from mobile gallery settings while retaining desktop sorting.
- Preserve all photos, EXIF dates, index and SMB permissions; no automatic deletion or filtering.

## 0.18.6

- Fix JavaScript startup ReferenceError: initialize globalGalleryOrder before binding the gallery sorting controls.
- Restore execution of login form handlers on page load.
- Preserve photo index, EXIF metadata and SMB permissions.

## 0.18.5

- Fix mobile login password field blocked by the full-width password visibility button due to conflicting CSS rules.
- Put password visibility toggle beside the input, with independently sized controls.
- Keep all session logic, photo index and SMB permissions unchanged.

## 0.18.4

- Restore valid JavaScript API function declaration, fixing an initialization failure that disabled login form interactions.
- Retain startup session race protection and preserve photo index and SMB permissions.

## 0.18.3

- Prevent an outdated initial /api/me session check from replacing a successful login with the login screen.
- Keep 401 handling on protected API calls; do not reset the photo index or SMB access rules.

## 0.18.2

- Fix GitHub Actions UI DOM contract: declare galleryOrderSelect in HTML rather than creating it dynamically.
- Keep existing EXIF ordering, index, SMB access controls and cached data unchanged.

## 0.18.1

- Fix SQL concatenation error in EXIF-date gallery pagination discovered by GitHub Actions.
- Preserve existing photo index, SMB permissions and all gallery metadata.

## 0.18.0

- Sort the unified photo gallery by actual EXIF capture date by default.
- Put photos without an EXIF capture date after dated photos, under "Дата съёмки неизвестна", instead of presenting the NAS copy date as capture date.
- Add a switch to sort by SMB file modification date when desired, on both desktop and mobile.
- Apply the selected ordering on the server before pagination, so the first page shows real dated photos.
- Preserve the entire photo index, shared EXIF metadata, SMB ACLs, thumbnails and indexing progress. No database reset or migration.

## 0.17.1

- Do not mark JPEG EXIF extraction as completed after SMB read failures; failed items can be retried on later scans.
- Gallery status API now reports dated (valid EXIF dates) and checked_no_date (checked but no EXIF date) counts for diagnostics.
- Existing photo index and shared metadata are preserved; this release does not automatically reprocess previously checked photos.

## 0.17.0

- Deleting a file or nonempty directory moves the entire object into the share-root .recycle folder using SMB rename, preserving its contents.
- The recycle bin now stores the deleted object directly instead of reconstructing its source path. Name collisions receive a unique suffix.
- Display .recycle as "Корзина" in file lists and breadcrumbs without renaming the actual SMB directory.
- No permanent-delete fallback: if the move fails, the original object is not intentionally deleted.
- Deleting objects inside .recycle is disabled until an explicit permanent-delete flow is implemented.
- No changes to the photo index, EXIF, existing file contents or SMB access controls.

## 0.16.2

- Prevent login from silently succeeding with zero readable SMB shares.
- On session restoration, report SMB share discovery failures instead of opening an empty file manager and gallery.
- Keep the session's original authorized-share allowlist; do not expand permissions during refresh.
- Preserve the existing gallery database, EXIF metadata, indexing progress, and stored files.

## 0.16.1

- Restore one-tap navigation to parent folders on mobile with a visible back arrow.
- Make every breadcrumb segment clickable to jump directly to its folder.
- Tap the SMB share name in the breadcrumb to switch between authorized shares.
- Compact file rows and preserve accessible 40–44px touch targets.
- No change to photo indexing, EXIF metadata, SMB permissions, authentication or file operations.

## 0.16.0

- Extend the content-first redesign from photos to the file manager on mobile and desktop.
- Mobile files: compact "Файлы" header, on-demand search, sorting menu, actions sheet, and path breadcrumb.
- Mobile file rows: clearer icons, filenames, metadata and contextual actions without a permanent toolbar.
- Desktop: refined sidebar, denser file grid and list, smaller headings and consistent spacing.
- Existing file actions, SMB permissions, gallery index, EXIF processing, and authentication remain unchanged. No database migration or index reset.

## 0.15.0

- Mobile unified gallery redesigned around the photos: compact sticky "Фото" header with search and settings actions.
- Move month navigation, grid-density controls, index/EXIF status, and year shortcuts into a collapsible gallery settings panel.
- Hide redundant global-gallery title, file-manager toolbar, persistent status, and upload-center button on mobile; preserve their underlying actions.
- Restore original controls when settings close so the desktop layout remains intact.
- No changes to SMB authentication, per-user permissions, existing gallery database, EXIF, thumbnail cache, or background indexing.

## 0.14.1

- Fix background photo/EXIF indexing stopping immediately for sessions restored by the Remember me login option.
- Continue indexing with the existing photo database and previously extracted EXIF; no reset or migration required.
- Background worker remains bounded and is restarted by gallery polling as needed.

## 0.14.0

- Refreshed responsive gallery styling: tighter photo spacing, smaller date headings, and removed per-tile folder captions. Photo source remains available in the information panel.
- Collapsible indexing status in the gallery to reduce visual clutter.
- File manager: clearer folder/file visual treatment and refined list appearance on desktop.
- Right-click opens the existing file context menu; mobile long-press opens the existing action sheet instead of immediately selecting.
- Refined mobile navigation active state and subtle transitions, respecting reduced-motion settings.
- Preserved SMB authorization, file operations, photo database, EXIF metadata, and thumbnail cache. No database migration or index reset.

## 0.13.0

- Gallery: browser-native offscreen rendering optimization to reduce rendering work on long photo lists.
- Gallery: adjustable mobile grid density (2–5 photos per row), saved on this device.
- Gallery: quick month/year jump for currently loaded photographs.
- Gallery: long-press selection and batch ZIP download grouped by SMB share and folder.
- Thumbnail cache: increase persistent cache to 512 MiB and extend TTL to 14 days.
- Indexing: skip expensive shared-EXIF synchronization when the user's photos have no unchecked metadata.
- Existing photo index, extracted EXIF, user-specific SMB access, and original file contents are preserved.

## 0.12.1

- Faster gallery rendering: preserve already loaded thumbnails when the photo list has not changed.
- Prioritize thumbnails currently visible on screen.
- Preserve photo index, EXIF metadata, SMB permissions, and existing gallery functions.

## 0.12.0

- Background photo and EXIF indexing during an active session.
- Photo information panel.

## 0.11.1

- Shared EXIF metadata and progress improvements.
