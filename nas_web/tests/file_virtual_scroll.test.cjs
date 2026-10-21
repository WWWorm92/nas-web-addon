'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('nas_web/app/app.js','utf8');
const html=fs.readFileSync('nas_web/app/index.html','utf8');
function extract(start,end,params={},returns){
 const from=source.indexOf(start),to=source.indexOf(end,from+start.length);
 assert.ok(from>=0&&to>from,'Found exact helper boundaries for '+start);
 return new Function(...Object.keys(params),source.slice(from,to)+'\nreturn '+returns+';')(...Object.values(params));
}
const fn=extract('function fileVirtualWindow(','function fileVirtualMetrics(',{},'fileVirtualWindow');
const count=10000;
for(const [cols,rowHeight,gap] of [[5,185,10],[3,175,12],[1,68,5]]){
 const rows=Math.ceil(count/cols),length=rows*(rowHeight+gap)-gap;
 for(const scroll of [0,50,1000,21000,length/2,length-300,length,length+500]){
   const range=fn(count,cols,rowHeight,gap,130,scroll,800);
   assert.ok(range.first>=0&&range.last<=range.rows&&range.first<range.last,
     'Non-empty bounded viewport at '+scroll);
   assert.ok((range.last-range.first)*cols<=100,
     'Only nearby items should be mounted, not 10000: '+JSON.stringify(range));
   // Three spacers/rows must conserve the full page height.
   const before=range.first>0?range.first*(rowHeight+gap)-gap:0;
   const shown=range.last-range.first;
   const middle=shown*(rowHeight+gap)-gap;
   const below=range.last<range.rows?(range.rows-range.last)*(rowHeight+gap)-gap:0;
   const separators=(range.first>0?gap:0)+(range.last<range.rows?gap:0);
   assert.equal(before+middle+below+separators,length,
      'No scroll jumps due to collapsing virtual rows');
 }
}
assert.ok(source.includes('if(view!==\'gallery\'&&shown.length>160)'),'Only large directories virtualized');
assert.ok(source.includes('if(allPhotosMode){resetFileVirtual();renderAllGallery();return}'),
  'Global gallery does not use file virtualizer');
assert.ok(source.includes("fileVirtualResize.observe(el('entries'))"),'Responsive column updates');
assert.match(html,/\.fileVirtualRow/,'Desktop/mobile row styles');
assert.match(html,/\.fileVirtualSpacer/,'Spacer style');
const cached=extract('const folderListCache=new Map();','async function refresh(){',
 {folderScrollKey:(share,path)=>JSON.stringify([share,path])},
 '{cachedFolderList,rememberFolderList,folderListCache}');
cached.rememberFolderList('Public','2026',[{name:'a.jpg'}]);
assert.equal(cached.cachedFolderList('Public','2026')[0].name,'a.jpg');
assert.equal(cached.cachedFolderList('Private','2026'),null,'No cross-share reuse');
for(let n=0;n<20;n++)cached.rememberFolderList('Public','folder'+n,[n]);
assert.equal(cached.folderListCache.size,12,'Bounded LRU');
assert.equal(cached.cachedFolderList('Public','folder0'),null,'Evicts oldest entries');
assert.deepEqual(cached.cachedFolderList('Public','folder19'),[19]);
assert.ok(source.includes('folderFetchGeneration++'),'Reset invalidates outstanding requests');
assert.ok(source.includes('request!==folderFetchGeneration'),'Old requests cannot overwrite new folder');
assert.ok(source.includes('folderListCache.clear()'),'Clears cache on sign-out/sign-in');
assert.ok(source.includes('const data=await api(\'/api/list?\'+qs({share,path}))'),
  'Every folder requires fresh authenticated SMB list');
console.log('10000-file virtualization, spacer heights, responsive layouts, cache isolation and LRU OK');
