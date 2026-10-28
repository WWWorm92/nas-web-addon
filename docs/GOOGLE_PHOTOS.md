# Google Photos import

Open **NAS Web → Profile → Import from Google Photos**. No separate navigation
button is used. Choose a **writable SMB folder** as the destination.

## Full library: Google Takeout

1. Export **Google Photos** from [Google Takeout](https://takeout.google.com/),
   choose ZIP format and split your archive into parts of at most `max_import_mb`
   (default 8192 MiB for new installs; maximum configurable is 32768 MiB). On a Pi with
   limited free HA `/data` space, choose **1 GB** archive parts. Large single archives are supported up to
   **32 GiB** by setting `max_import_mb` in the NAS Web add-on options;
   for a **6.5 GB** archive choose `8192` or `10240` (MiB). The add-on
   stages the entire compressed ZIP temporarily under `/data/nasweb-import`,
   **not** on the selected SMB share: allow at least the archive size plus
   512 MiB free space on the Home Assistant host volume. NAS Web displays
   this capacity in Profile and checks it before starting. Home Assistant
   **preserves existing `max_import_mb` values** (e.g. `2048`) across upgrades;
   change the existing value manually and restart the add-on.
2. In the Profile import section select all ZIP parts. NAS Web sends each ZIP
   as **1 MiB chunks**, then streams individual media entries directly to the
   SMB folder; it does not extract the full archive to the Pi. A private local
   ZIP spool is still required while processing that part. Network interruptions
   are retried automatically. After a tab close or restart, choose the **same**
   ZIP (same name, size and modification timestamp) to continue from the last
   saved byte. Incomplete staged uploads expire after 36 hours. Do not clear
   add-on data if you want to resume.
3. The accompanying JSON `photoTakenTime.timestamp` is saved in NAS Web's
   gallery date index. Imported photo bytes remain unchanged. Photos without
   matching JSON metadata fall back to EXIF or SMB file modification time.
4. Previously imported *identical content* in this user's destination folder
   is skipped using SHA-256. Existing files are never overwritten. Progress is
   stored in SQLite; after restarting NAS Web, the active job is marked
   interrupted and the user can re-upload the ZIP to skip already imported
   photos. If a sidecar is stored in a different ZIP part, its date may not
   be available on the first import.

## Selected media: Google Photos Picker

The Picker API only provides media explicitly selected by the user. It **cannot
enumerate or continuously synchronize a whole existing Google Photos library**.

1. In [Google Cloud Console](https://console.cloud.google.com/), create/select a
   project, enable the **Google Photos Picker API**, configure the OAuth consent
   screen and its testing users (where applicable), and create an **OAuth Client
   ID → Web application**.
2. Add this **exact** authorized redirect URI to the OAuth client:
   `https://YOUR-PUBLIC-NAS-DOMAIN/api/import/google/oauth/callback`.
   Google requires public HTTPS for non-localhost web redirects.
3. Configure the NAS Web add-on options (not the public repository):
   `google_client_id`, `google_client_secret`, and `google_redirect_uri`
   with that **same** full callback URL. Keep the client secret private.
4. Restart the add-on. In **Profile → Import from Google Photos → Connect
   Google**, consent to the **photospicker.mediaitems.readonly** scope.
5. Choose a writable SMB destination, click **Choose photos in Google**, open
   the provided Google Photos link, select photos/videos and confirm. Once
   Google reports selection complete, click **Import selected**.

Google refresh tokens are encrypted on the NAS Web host and stored per SMB
profile. **Disconnect** removes the locally stored tokens and Picker session,
not the already imported SMB files. Google Picker image downloads use `=d`
(which, according to Google's documentation, excludes location EXIF metadata);
video downloads use Google's `=dv` high-quality transcoded version. Takeout
is preferred when original file fidelity and full metadata are priorities.

## Repair dates and diagnose incomplete Takeout imports

If the Takeout ZIP was processed by NAS Web 0.22.34 or earlier and photos
were placed under the ZIP import date, upgrade to **0.22.35**, then select
the **same original Takeout ZIP** and the **same SMB destination folder**
in **Profile → Import from Google Photos**. You do not need to clear or
rebuild the gallery. SHA-256 checks identify previously imported media so
they are not copied again; corrected JSON-sidecar lookup can supply their
original capture dates to the existing gallery index. Gallery EXIF scanning
is separate and will continue automatically for media that needs it.

For imports completed after the upgrade, **Show errors** on the import job
lists failed filenames and error categories; the full report can be saved
as JSON. Prior job logs only contain a count and the temporary ZIPs were
already deleted, so an old report cannot reconstruct its individual failures.
Retrying the original archive will reattempt files that did not transfer.

## Import limitations

- Only users with existing Simple NAS SMB write permission can import; no
  administrative bypass or new SMB users are created.
- JPEG, PNG, WebP, GIF and supported HEIC/HEIF photos appear in the unified
  gallery. NAS Web 0.22.44 and later provide server-side HEIC/HEIF previews;
  keep the add-on image up to date. Imported videos remain accessible through
  the SMB file manager, with playback dependent on browser codec support.
- Google Takeout JSON capture dates are persisted in the NAS Web gallery index,
  **not embedded back into EXIF**. Edits to filenames outside NAS Web, or
  reusing the originals in other apps, may require preserving the sidecar JSON.
- Photo imports do not delete, update or modify anything in Google Photos.
