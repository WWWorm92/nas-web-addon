'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const js=fs.readFileSync('nas_web/app/app.js','utf8');
const html=fs.readFileSync('nas_web/app/index.html','utf8');

const overlayStart=html.indexOf('id="galleryMemories"');
const appStart=html.indexOf('id="app"');
const profileStart=html.indexOf('id="profileOverlay"');
assert.ok(overlayStart>appStart&&overlayStart<profileStart,'memories must live in gallery workspace');
assert.ok(html.includes('id="galleryMemoryStories"'),'story strip missing');
assert.ok(!js.includes("label:'Воспоминания',run:()=>openMemories()"),
  'legacy More action must be removed');
assert.ok(!js.includes('async function openMemories()'),'legacy subset navigation must be removed');
assert.ok(js.includes('loadGalleryMemories();\n  startGalleryWatch();'),
  'memories must load when entering the full gallery');
assert.ok(js.includes('function renderAllGallery(){\n  renderGalleryMemories();'),
  'gallery state updates memories visibility');
assert.ok(js.includes('galleryMemoriesRenderedSignature'),
  'story cards should survive virtual gallery redraws');

const start=js.indexOf('let galleryMemoryGroups=');
const end=js.indexOf('async function openNasStats()',start);
assert.ok(start>=0&&end>start,'memory functions found in JS');

class Node{
  constructor(tag='div'){
    this.tag=tag;this.children=[];this.style={};this.scrollLeft=0;
    this.className='';this.attributes={};this.textContent='';
    const classes=new Set(['hidden']);
    this.classList={
      add:n=>classes.add(n),remove:n=>classes.delete(n),
      toggle:(n,yes)=>{
        if(yes===undefined)yes=!classes.has(n);
        if(yes)classes.add(n);else classes.delete(n);
      },
      contains:n=>classes.has(n)
    };
  }
  append(...children){this.children.push(...children)}
  replaceChildren(...children){
    this.children=children.length===1&&children[0].tag==='fragment'
      ?children[0].children:children;
  }
  setAttribute(k,v){this.attributes[k]=v}
}
const nodes=new Map();
const el=id=>{
  if(!nodes.has(id))nodes.set(id,new Node(id));
  return nodes.get(id);
};
const todayYear=new Date().getFullYear();
const photo=(year,path)=>({taken:year+'-10-21T10:00:00',
  share:'Photo',folder:'family',path:'family/'+path,name:path,modified:100,size:55});
const pictures=[
  photo(todayYear-4,'four.jpg'),
  photo(todayYear-1,'one.jpg'),
  photo(todayYear-4,'four-second.jpg'),
  photo(todayYear-3,'three.jpg'),
  photo(todayYear,'current.jpg'),
  {...photo(todayYear-1,'hidden.pdf'),name:'hidden.pdf'},
  {...photo(todayYear-9,'undated.jpg'),taken:null},
];
let serverItems=pictures;
let fullGallery=true,subset=false;
let shown=0;
const scope=new Function('el','document','api','imageURL','isPhoto',
  'getFull','getSubset','filmNodes','showPreview',
  // inject full gallery state access to ensure viewer uses only story files
  'const allPhotosMode=getFull(),allPhotoSubsetMode=getSubset();\n'+
  "const allPhotos=[{name:'unrelated.jpg'}];\n"+
  "let gallery=[],previewIndex=-1,shownShare='',shownDir='';\n"+
  js.slice(start,end)+
  '\nreturn {groupGalleryMemories,loadGalleryMemories,renderGalleryMemories,openMemoryStory,'+
  'setSubset:v=>{},state:()=>({gallery,previewIndex,shownShare,shownDir})};');
const filmNodes={clear(){}};
const vm=scope(el,{
  createElement:type=>new Node(type),
  createDocumentFragment:()=>new Node('fragment'),
  body:{style:{}}
},async()=>({items:serverItems}),
 (p,large,folder,share)=>'/api/thumb?'+share+'/'+folder+'/'+p.name,
 p=>/\.(jpg|jpeg|png|webp|gif)$/i.test(p.name),
 ()=>fullGallery,()=>subset,
 filmNodes,()=>shown++);
const groups=vm.groupGalleryMemories(pictures,new Date(todayYear,9,21));
assert.deepEqual(groups.map(x=>x.yearsAgo),[1,3,4]);
assert.equal(groups[0].title,'Год назад');
assert.equal(groups[1].title,'3 года назад');
assert.equal(groups[2].title,'4 года назад');
assert.equal(groups[2].items.length,2);
(async()=>{
  await vm.loadGalleryMemories();
  const strip=el('galleryMemoryStories');
  assert.equal(el('galleryMemories').classList.contains('hidden'),false);
  assert.equal(strip.children.length,3);
  assert.equal(strip.children[0].attributes['aria-label'],'Год назад — 1 фото');
  assert.match(strip.children[0].children[0].src,/one.jpg/);
  strip.scrollLeft=91;
  vm.renderGalleryMemories();
  assert.equal(strip.scrollLeft,91,'gallery rerenders should preserve story scroll');
  const card=strip.children[2];
  card.onclick();
  assert.equal(shown,1,'card opens the existing photo viewer');
  const state=vm.state();
  assert.equal(state.gallery.length,2,'viewer only shows memories for one year');
  assert.equal(state.gallery[0].name,'four.jpg');
  assert.equal(state.previewIndex,0);
  assert.equal(el('preview').style.display,'flex');
  serverItems=[];
  await vm.loadGalleryMemories();
  assert.ok(el('galleryMemories').classList.contains('hidden'),'no empty story shelf');
  console.log('Gallery memories: stories grouped by year; viewer retains full gallery; no menu entry; empty state hidden');
})().catch(e=>{console.error(e);process.exitCode=1});
