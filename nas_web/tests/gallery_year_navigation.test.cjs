'use strict';
// Full gallery date-strip interaction: no native select, mobile/desktop chips,
// reverse navigation, safe page offsets and selected date persistence.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('nas_web/app/app.js','utf8');
const html=fs.readFileSync('nas_web/app/index.html','utf8');
assert.ok(html.includes('id="galleryYearReset"'));
assert.ok(html.includes('id="galleryDateStrip"'));
assert.ok(html.includes('id="galleryDatePrev"'));
assert.ok(html.includes('id="galleryDateNext"'));
assert.ok(!html.includes('id="galleryMonthJump"'),
  'native month dropdown should be fully removed');
assert.match(html,/#app \.galleryDateNav/);
assert.match(html,/#app \.galleryDateStrip/);
assert.match(source,/el\('galleryDateStrip'\)\.addEventListener\('wheel'/);
assert.match(source,/el\('galleryDateStrip'\)\.addEventListener\('keydown'/);
assert.match(source,/el\('galleryYearReset'\)\.onclick=returnToAllPhotos/);

class Elem{
  constructor(tag){
    this.tag=tag;this.children=[];this.dataset={};this.value='';
    this.textContent='';this.disabled=false;
    this.scrollLeft=0;this.scrollWidth=1000;this.clientWidth=250;
    this.offsetLeft=0;this.offsetWidth=200;this.clientWidth=250;
    const classes=new Set(['hidden']);
    this.classList={
      add:s=>classes.add(s),remove:s=>classes.delete(s),
      toggle:(s,on)=>{if(on)classes.add(s);else classes.delete(s)},
      contains:s=>classes.has(s)
    };
    this.attributes={};
  }
  setAttribute(k,v){this.attributes[k]=v}
  append(...kids){this.children.push(...kids)}
  replaceChildren(...children){
    this.children=children.length===1&&children[0].tag==='fragment'
      ?children[0].children:children;
  }
  get options(){return this.children}
}
const byId=new Map();
const el=id=>{if(!byId.has(id))byId.set(id,new Elem(id));return byId.get(id)};
el('entries').querySelectorAll=()=>[];
const months=[
  {month:'2026-10',offset:0,count:10},
  {month:'2025-12',offset:90,count:80},
  {month:'2025-11',offset:170,count:45},
  {month:'2024-06',offset:240,count:120}
];
const calls=[];
const block=source.slice(source.indexOf('function galleryJumpTo('),
  source.indexOf('let gallery=[],',source.indexOf('function galleryJumpTo(')));
const ui=new Function('el','document','requestAnimationFrame','jumpToGlobalMonth',
  'returnToAllPhotos','galleryVirtualScrollTo','allPhotoTimeline',
  'const allPhotosMode=true,allPhotoSubsetMode=false,view="gallery";\n'+
  "let gallerySelectedYear='',gallerySelectedMonth='',galleryDateRenderSignature='';\n"+
  block+'\nreturn {renderGalleryYears,setDate:(year,month)=>{gallerySelectedYear=year;gallerySelectedMonth=month;},' +
  'currentSignature:()=>galleryDateRenderSignature};')(
  el,{createElement:type=>new Elem(type),createDocumentFragment:()=>new Elem('fragment')},
  cb=>cb(),month=>calls.push(['month',month]),()=>calls.push(['all']),
  ()=>false,months
);
ui.renderGalleryYears([]);
let years=el('galleryYears').children;
assert.deepEqual(years.map(x=>x.textContent),['Все фото','2026','2025','2024']);
assert.equal(years[0].classList.contains('galleryYearCurrent'),true);
assert.ok(el('galleryYearReset').classList.contains('hidden'));
assert.equal(el('galleryDateYear').textContent,'2026');
assert.deepEqual(el('galleryDateStrip').children.map(x=>x.dataset.month),['2026-10']);
assert.ok(!el('galleryDateNav').classList.contains('hidden'));
years[2].onclick();
assert.deepEqual(calls.pop(),['month','2025-12']);
ui.setDate('2025','2025-12');
ui.renderGalleryYears([]);
years=el('galleryYears').children;
assert.equal(years[2].classList.contains('galleryYearCurrent'),true);
assert.equal(years[2].attributes['aria-pressed'],'true');
assert.equal(el('galleryDateYear').textContent,'2025');
assert.deepEqual(el('galleryDateStrip').children.map(x=>x.dataset.month),
  ['2025-12','2025-11']);
const chips=el('galleryDateStrip').children;
assert.equal(chips[0].attributes['aria-pressed'],'true');
assert.equal(chips[1].attributes['aria-pressed'],'false');
chips[1].onclick();
assert.deepEqual(calls.pop(),['month','2025-11']);
assert.ok(!el('galleryYearReset').classList.contains('hidden'));
const previousChips=el('galleryDateStrip').children;
el('galleryDateStrip').scrollLeft=40;
el('galleryYears').scrollLeft=155;
ui.renderGalleryYears([]);
assert.equal(el('galleryYears').scrollLeft,155,'years remain scrolled to selected history');
assert.equal(el('galleryDateStrip').children[0],previousChips[0],
  'virtual photo updates must not recreate month pills');
assert.equal(el('galleryDateStrip').scrollLeft,40,
  'gallery refresh must preserve horizontal month scroll');
years[2].onclick();
assert.deepEqual(calls.pop(),['all']);
years[0].onclick();
assert.deepEqual(calls.pop(),['all']);

let resets=0,renders=0,pages=[],scans=[],scroll=[];
let navigatorState=()=>({});
const navCode=source.slice(source.indexOf('async function jumpToGlobalOffset('),
  source.indexOf('async function loadGlobalPage(',source.indexOf('async function jumpToGlobalOffset(')));
const navigation=new Function('el','window','requestAnimationFrame','resetGalleryVirtual',
  'render','loadGlobalPage','scanAllPhotos','allPhotoTimeline',
  'let allPhotosMode=true,allPhotoSubsetMode=false,allPhotoScanToken=3;\n'+
  "let allPhotoStartOffset=0,allPhotoNextOffset=0,allPhotos=[],allPhotoTotal=10,allPhotoStatus={},galleryRenderSignature='cached',allPhotoPageBusy=false,gallerySelectedYear='',gallerySelectedMonth='';\n"+
  navCode+'\nreturn {jumpToGlobalMonth,returnToAllPhotos,read:()=>({allPhotoStartOffset,allPhotoNextOffset,allPhotoScanToken,gallerySelectedYear,gallerySelectedMonth})};')(
  el,{scrollTo:obj=>scroll.push(obj)},cb=>{cb();return 0},
  ()=>{resets++},()=>{renders++},
  async reset=>{pages.push({reset,offset:navigatorState().allPhotoStartOffset})},
  token=>{scans.push(token)},months
);
navigatorState=navigation.read;
el('entries').querySelector=()=>({scrollIntoView:()=>scroll.push('month-heading')});
(async()=>{
  await navigation.jumpToGlobalMonth('2025-12');
  assert.equal(navigatorState().gallerySelectedYear,'2025');
  assert.equal(navigatorState().gallerySelectedMonth,'2025-12');
  assert.equal(navigatorState().allPhotoStartOffset,90);
  assert.equal(navigatorState().allPhotoNextOffset,90);
  assert.equal(navigatorState().allPhotoScanToken,4);
  await navigation.returnToAllPhotos();
  assert.equal(navigatorState().gallerySelectedYear,'');
  assert.equal(navigatorState().gallerySelectedMonth,'');
  assert.equal(navigatorState().allPhotoStartOffset,0);
  assert.equal(navigatorState().allPhotoNextOffset,0);
  assert.equal(navigatorState().allPhotoScanToken,5);
  assert.deepEqual(pages,[{reset:true,offset:90},{reset:true,offset:0}]);
  assert.deepEqual(scans,[4,5]);
  assert.equal(resets,2);
  assert.equal(renders,2);
  assert.ok(scroll.some(x=>x==='month-heading'));
  assert.ok(scroll.some(x=>x.top===0));
  console.log('Gallery date-strip scroll, month/year selection and All Photos reset OK');
})().catch(err=>{console.error(err);process.exitCode=1});
