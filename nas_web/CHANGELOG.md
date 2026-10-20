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
