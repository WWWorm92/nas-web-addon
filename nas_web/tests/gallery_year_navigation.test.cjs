'use strict';
// Regression: a year/month jump is reversible without leaving the gallery,
// including when the full photo library has paginated from an offset.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('nas_web/app/app.js','utf8');
const html=fs.readFileSync('nas_web/app/index.html','utf8');
assert.ok(html.includes('id="galleryYearReset"'),'visible reset button exists');
assert.match(html,/#app \.galleryJumpGroup \.galleryYearReset/);
assert.match(source,/el\('galleryYearReset'\)\.onclick=returnToAllPhotos/);
assert.match(source,/if\(allPhotosMode&&!allPhotoSubsetMode\)jumpToGlobalMonth\(key\)/,
  'empty month value must also reach reset');

class Elem{
  constructor(tag){
    this.tag=tag;this.children=[];this.value='';this.textContent='';this.disabled=false;
    const names=new Set(['hidden']);
    this.classList={
      add:s=>names.add(s),remove:s=>names.delete(s),
      toggle:(s,on)=>{if(on)names.add(s);else names.delete(s)},
      contains:s=>names.has(s)
    };
    this.attributes={};
  }
  setAttribute(k,v){this.attributes[k]=v}
  append(child){this.children.push(child)}
  replaceChildren(...children){this.children=children;this.value=''}
  get options(){return this.children}
}
const byId=new Map();
const el=name=>{if(!byId.has(name))byId.set(name,new Elem(name));return byId.get(name)};
el('entries').querySelectorAll=()=>[];
const months=[
  {month:'2026-10',offset:0,count:10},
  {month:'2025-12',offset:90,count:80},
  {month:'2025-11',offset:170,count:45},
  {month:'2024-06',offset:240,count:120}
];
const calls=[];
const draw=source.slice(source.indexOf('function galleryJumpTo('),source.indexOf('let gallery=[],',source.indexOf('function galleryJumpTo(')));
const years=new Function('el','document','getSelected','setSelected','jumpToGlobalMonth',
  'returnToAllPhotos','galleryVirtualScrollTo','allPhotoTimeline',
  'const allPhotosMode=true,allPhotoSubsetMode=false,view="gallery";\n'+
  'let gallerySelectedYear=getSelected();\n'+
  draw+'\nreturn {renderGalleryYears,setYear:year=>{gallerySelectedYear=year}};')(
  el,{createElement:tag=>new Elem(tag)},()=>'',()=>{},
  month=>calls.push(['month',month]),()=>calls.push(['all']),
  ()=>false,months
);
years.renderGalleryYears([]);
let buttons=el('galleryYears').children;
assert.deepEqual(buttons.map(x=>x.textContent),['Все фото','2026','2025','2024']);
assert.equal(buttons[0].classList.contains('galleryYearCurrent'),true);
assert.ok(el('galleryYearReset').classList.contains('hidden'));
buttons[2].onclick();
assert.deepEqual(calls.pop(),['month','2025-12']);
years.setYear('2025');
years.renderGalleryYears([]);
buttons=el('galleryYears').children;
assert.equal(buttons[2].classList.contains('galleryYearCurrent'),true,
  'year remains selected when tiles rerender');
assert.equal(buttons[2].attributes['aria-pressed'],'true');
assert.ok(!el('galleryYearReset').classList.contains('hidden'));
buttons[2].onclick();
assert.deepEqual(calls.pop(),['all'],'second click toggles back to full library');
buttons[0].onclick();
assert.deepEqual(calls.pop(),['all'],'All photos chip is always available');

let resetCount=0,rendered=0,scroll=[],pages=[],scans=[];
const body=source.slice(source.indexOf('async function jumpToGlobalOffset('),
  source.indexOf('async function loadGlobalPage(',source.indexOf('async function jumpToGlobalOffset(')));
const navigation=new Function('el','window','requestAnimationFrame','resetGalleryVirtual',
  'render','loadGlobalPage','scanAllPhotos','allPhotoTimeline',
  'let allPhotosMode=true,allPhotoSubsetMode=false,allPhotoScanToken=3;\n'+
  "let allPhotoStartOffset=0,allPhotoNextOffset=0,allPhotos=[],allPhotoTotal=10,allPhotoStatus={},galleryRenderSignature='cached',allPhotoPageBusy=false,gallerySelectedYear='';\n"+
  body+'\nreturn {jumpToGlobalMonth,returnToAllPhotos,read:()=>({allPhotoStartOffset,allPhotoNextOffset,allPhotoScanToken,gallerySelectedYear})};')(
  el,{scrollTo:obj=>scroll.push(obj),scrollY:550},
  cb=>{cb();return 0},
  ()=>{resetCount++},()=>{rendered++},
  async reset=>{pages.push({reset,offset:navState().allPhotoStartOffset});},
  token=>{scans.push(token)},months
);
function navState(){return navigation.read()}
el('entries').querySelector=()=>({scrollIntoView:()=>scroll.push('month-heading')});
(async()=>{
  await navigation.jumpToGlobalMonth('2025-12');
  assert.equal(navState().gallerySelectedYear,'2025');
  assert.equal(navState().allPhotoStartOffset,90);
  assert.equal(navState().allPhotoNextOffset,90);
  assert.equal(navState().allPhotoScanToken,4);
  await navigation.returnToAllPhotos();
  assert.equal(navState().gallerySelectedYear,'');
  assert.equal(navState().allPhotoStartOffset,0);
  assert.equal(navState().allPhotoNextOffset,0);
  assert.equal(navState().allPhotoScanToken,5);
  assert.equal(el('galleryMonthJump').value,'');
  assert.deepEqual(pages,[{reset:true,offset:90},{reset:true,offset:0}]);
  assert.deepEqual(scans,[4,5]);
  assert.equal(resetCount,2);
  assert.equal(rendered,2);
  assert.ok(scroll.some(x=>x==='month-heading'));
  assert.ok(scroll.some(x=>x.top===0));
  console.log('Gallery year jump and All photos reset preserve safe pagination and active year UI');
})().catch(e=>{console.error(e);process.exitCode=1});
