'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('nas_web/app/index.html', 'utf8');
const js = fs.readFileSync('nas_web/app/app.js', 'utf8');

// Header controls and the Back/path breadcrumb must share the SAME sticky parent.
const start=html.indexOf('<div id="mobileFilesTop" class="mobileFilesTop">');
const end=html.indexOf('<div class="controls">',start);
assert.ok(start>=0&&end>start,'Mobile file top navigation wrapper exists');
const group=html.slice(start,end);
assert.match(group,/id="mobileFilesHeader"/);
assert.match(group,/id="mobileFilesBreadcrumb"/);
assert.match(group,/filesSearchToggle/);
assert.match(group,/filesSortToggle/);
assert.match(group,/filesSettingsToggle/);
assert.match(group,/<\/div><div id="mobileFilesBreadcrumb" class="mobileFilesBreadcrumb"><\/div><\/div>\s*$/,
  'Both header and breadcrumb are direct children of the sticky wrapper');

const css=html.slice(0,html.indexOf('</head>'));
assert.match(css,/\.mobileFilesTop\{display:none\}/,'No desktop header duplicates');
assert.match(css,/#app:not\(\.globalGalleryOpen\) \.mobileFilesTop\s*\{[^}]*display:block;[^}]*position:sticky;[^}]*top:0;[^}]*z-index:21;[^}]*background:var\(--bg\)/s,
  'Mobile wrapper is pinned with an opaque themed background');
assert.match(css,/#app:not\(\.globalGalleryOpen\) \.mobileFilesTop \.mobileFilesHeader\s*\{[^}]*position:static;/s,
  'No competing inner sticky header');
assert.match(css,/#app:not\(\.globalGalleryOpen\) \.mobileFilesTop \.mobileFilesBreadcrumb\s*\{[^}]*min-width:0;/s,
  'Breadcrumb can shrink instead of overflowing into actions');
assert.match(css,/#app:not\(\.globalGalleryOpen\) \.selectionBar\s*\{[^}]*top:120px;/s,
  'Selection toolbar remains beneath sticky navigation');
assert.match(js,/function updateMobileFilesBreadcrumb\(\)\s*\{/, 'Back and breadcrumb JS is preserved');
assert.match(js,/back\.onclick=\(\)=>\{if\(dir\)mobileNavigateTo\(/,
  'Back button navigation remains wired');
console.log('Mobile Files title, Back/path row, sticky wrapper and gallery isolation: OK');
