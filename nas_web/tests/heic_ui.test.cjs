'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const js=fs.readFileSync('nas_web/app/app.js','utf8');
const main=fs.readFileSync('nas_web/app/main.py','utf8');
const gallery=fs.readFileSync('nas_web/app/gallery_index.py','utf8');
const photoDates=fs.readFileSync('nas_web/app/photo_dates.py','utf8');
assert.match(js,/const imageExt=\[[^\]]*'heic'\s*,\s*'heif'\]/,
  'HEIC/HEIF must count as images in folder and gallery UI');
assert.match(js,/function photoSource\(f\)[\s\S]*?:imageURL\(f,true/,
  'HEIC browser previews use server-converted WebP, not unsupported original HEIC bytes');
assert.match(main,/"heic", "heif"/,'Backend thumb endpoint allows HEIC/HEIF');
assert.match(main,/thumb_cache\.HEIF_WORKERS/,'HEIC decoding is CPU bounded');
assert.match(main,/photo_dates\.from_photo_file/,'Backend EXIF scanner accepts HEIC metadata');
assert.match(photoDates,/MAX_HEIF_EXIF_BYTES\s*=\s*25 \* 1024 \* 1024/);
assert.match(gallery,/IMAGE_EXTS = \([^\n]*"\.heic", "\.heif"/);
assert.match(gallery,/lower\(p\.name\) LIKE '%\.heic'/,'HEIC must be counted as pending EXIF');
assert.match(gallery,/lower\(name\) LIKE '%\.heif'/,'HEIF must be counted as pending EXIF');
console.log('HEIC/HEIF file manager, gallery, API and metadata wiring: OK');
