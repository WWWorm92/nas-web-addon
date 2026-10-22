'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const js=fs.readFileSync('nas_web/app/app.js','utf8');

function extract(start,end){
  const at=js.indexOf(start);
  assert.ok(at>=0,'Cannot find '+start);
  const to=js.indexOf(end,at+start.length);
  assert.ok(to>at,'Cannot find end '+end);
  return js.slice(at,to);
}
const utilities=[
  extract('const photoDate=', 'function photoDay('),
  extract('function sortedFiltered(){','// Limit simultaneous thumbnail requests'),
  extract('function openPreview(f){','function closePreview(){')
].join('\n');

assert.match(js,/const shown=visibleFolderItems\(\);/,'Folder list uses the shared order');
assert.match(js,/allPhotosMode\?allPhotos:visibleFolderItems\(\)\.filter\(isPhoto\)/,
  'Full-screen folder viewer uses the same order and filters out non-photo files');
const files=[
  {name:'z.jpeg',directory:false,size:500,modified:90,taken:'2020-05-01'},
  {name:'clip.mov',directory:false,size:2000,modified:120},
  {name:'a.jpeg',directory:false,size:900,modified:100,taken:'2022-01-01'},
  {name:'folder',directory:true,size:0,modified:150},
  {name:'m.jpg',directory:false,size:100,modified:110,taken:'2021-01-01'},
  {name:'document.pdf',directory:false,size:300,modified:130},
];

function fixture(sort='name',view='list',search='',allPhotosMode=false){
  const elems={
    search:{value:search},sort:{value:sort},
    preview:{classList:{remove(){}},style:{}}
  };
  const output=new Function('items','el','imageExt','videoExt','ext','view','selected','dir','allPhotosMode','allPhotos',
    'filmNodes','canPreview','document','showPreview','enterFolder','download',
    "let gallery=[],previewIndex=-1,shownShare='',shownDir='';"+
    "const isPhoto=f=>!f.directory&&imageExt.includes(ext(f.name));"+
    utilities+
    '\nreturn {visibleFolderItems,openPreview,state:()=>({gallery,previewIndex})};')(
      files,id=>elems[id],
      ['jpg','jpeg','png','gif','webp'],['mov','mp4','webm'],
      name=>name.split('.').pop().toLowerCase(),view,'Photo','Folder',allPhotosMode,
      [files[4],files[2],files[0]],{clear(){}},
      f=>!f.directory,
      {body:{style:{}}},()=>{},()=>{},()=>{}
    );
  return output;
}
function names(objects){return objects.map(x=>x.name)}
function expectGallery(sort,expected,clicked='m.jpg',view='list',search=''){
  const model=fixture(sort,view,search);
  const shown=model.visibleFolderItems();
  model.openPreview(files.find(f=>f.name===clicked));
  const state=model.state();
  assert.deepEqual(names(state.gallery),expected,'Full-screen order: '+sort+' '+view);
  assert.deepEqual(names(state.gallery),names(shown.filter(f=>['jpg','jpeg','png','gif','webp'].includes(f.name.split('.').pop()))),
    'Viewer order must match the visible photo subset in the file list');
  assert.equal(state.gallery[state.previewIndex].name,clicked,'Clicking a photo opens that exact photo');
}
expectGallery('name',['a.jpeg','m.jpg','z.jpeg']);
expectGallery('new',['m.jpg','a.jpeg','z.jpeg']);
expectGallery('size',['a.jpeg','z.jpeg','m.jpg']);
expectGallery('name',['a.jpeg','m.jpg','z.jpeg'],'m.jpg','grid');
expectGallery('name',['m.jpg'],'m.jpg','list','m.');
expectGallery('name',['a.jpeg','m.jpg','z.jpeg'],'m.jpg','gallery');
const gallery=fixture('name','gallery');
gallery.openPreview(files[2]);
assert.deepEqual(names(gallery.state().gallery),['a.jpeg','m.jpg','z.jpeg'],
  'Per-folder gallery view always uses date-descending order');
const movie=fixture();
movie.openPreview(files[1]);
assert.deepEqual(names(movie.state().gallery),['clip.mov'],
  'Single-video preview unchanged');
const global=fixture('name','list','',true);
global.openPreview(files[2]);
assert.deepEqual(names(global.state().gallery),['m.jpg','a.jpeg','z.jpeg'],
  'All Photos order must remain unchanged');
console.log('Folder photo viewer ordering follows file list sort/filter and folder gallery dates: OK');
