'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const client=fs.readFileSync('nas_web/app/app.js','utf8');
const html=fs.readFileSync('nas_web/app/index.html','utf8');
const api=fs.readFileSync('nas_web/app/main.py','utf8');
const index=fs.readFileSync('nas_web/app/gallery_index.py','utf8');
const store=fs.readFileSync('nas_web/app/trash_store.py','utf8');

assert.match(client,/api\('\/api\/delete\/batch'/,'bulk selection must use the batch endpoint');
assert.match(client,/files:chunk\.map\(f=>\(\{name:f\.name,directory:!!f\.directory\}\)\)/,
  'batch deletion must use direct sibling filenames and directory types');
const deleteSection=client.slice(client.indexOf("el('selectionDelete').onclick="),
                                  client.indexOf("el('galleryZoomOut').onclick=",client.indexOf("el('selectionDelete').onclick=")));
assert.match(deleteSection,/if\(!inTrash\)/);
assert.match(deleteSection,/\/api\/trash\/permanent-delete/,
  'permanent deletion must remain restricted to the existing trash path');

assert.match(api,/@app\.post\("\/api\/delete\/batch"\)/);
assert.match(api,/with trash_store\.OP_LOCK, smb\(u\) as conn:/);
assert.match(api,/trash_batch\.move_many\(conn, share, folder, files\)/);
assert.match(api,/trash_store\.record_moves\(u, share, moved\)/);
assert.match(store,/def record_moves\(user, share, moves\):/);

assert.match(client,/function openGalleryPhotoMenu\(f,anchor,fromViewer=false\)/);
assert.match(client,/function deleteGalleryPhoto\(f\)/);
assert.match(client,/function shareGalleryPhoto\(f\)/);
assert.match(client,/navigator\.canShare\(\{files:\[file\]\}\)/);
assert.match(client,/openGalleryPhotoMenu\(f,actions\)/);
assert.match(html,/id="previewPhotoMenu"/);
assert.doesNotMatch(html,/id="previewInfo"/,
  'file details moved into contextual photo menu');
assert.match(html,/\.photoTileMore/);
assert.match(html,/#fileMenu\.photoPreviewMenu\{z-index:65\}/);
assert.match(index,/migration = "exclude_recycle_from_gallery_02237"/);
assert.match(index,/if path == "\.recycle" or path\.startswith\("\.recycle\/"\)/);
assert.match(index,/def forget_moved_to_recycle\(share, paths\)/);
console.log('Bulk recycle, gallery trash exclusion and shared photo context menus are wired');
