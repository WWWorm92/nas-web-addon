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
