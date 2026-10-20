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
