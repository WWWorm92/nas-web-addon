'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('nas_web/app/nas-icons.js','utf8');
const html=fs.readFileSync('nas_web/app/index.html','utf8');
const admin=fs.readFileSync('nas_web/app/admin.html','utf8');
const backend=fs.readFileSync('nas_web/app/main.py','utf8');
class Node{
  constructor(tag){
    this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.content='';
    const flags=new Set();
    this.classList={add:x=>flags.add(x),contains:x=>flags.has(x)};
  }
  append(...nodes){this.children.push(...nodes)}
  replaceChildren(...nodes){this.children=[...nodes]}
  setAttribute(k,v){this.attributes[k]=v}
  set textContent(v){this.content=String(v)}
  get textContent(){return this.content}
  set innerHTML(v){this.content=String(v)}
  querySelector(selector){return selector==='input'?this.children.find(n=>n.tagName==='input')||null:null}
}
const items=new Map();
const get=id=>{if(!items.has(id))items.set(id,new Node('button'));return items.get(id)};
const input=new Node('input');
const uploader=new Node('label');uploader.append(input);
const logos=[new Node('span'),new Node('span')];
const doc={
 createElement:tag=>new Node(tag),
 createElementNS:(_ns,tag)=>new Node(tag),
 getElementById:id=>get(id),
 querySelectorAll:query=>query==='.logo'?logos:[],
 querySelector:query=>query==='.profileImportUpload'?uploader:null,
};
const context={window:{},document:doc};
vm.runInNewContext(source,context,{filename:'nas-icons.js'});
const icons=context.window.NASIcons;
assert.ok(icons);
assert.ok(Object.keys(icons.paths).length>=50,'At least 50 reusable outlined symbols');
for(const name of ['folder','image','video','trash-2','upload','download','settings','search',
  'layout-grid','list','check-square','more-horizontal','more-vertical','hard-drive']){
 const icon=icons.create(name);
 assert.equal(icon.attributes['aria-hidden'],'true');
 assert.equal(icon.attributes.fill,'none');
 assert.equal(icon.attributes.stroke,'currentColor');
 assert.ok(icon.content,'SVG has known trusted vector path');
}
icons.applyStatic();
for(const id of ['mobileHome','mobilePhotos','mobileMore','gallerySearchToggle','gallerySettingsToggle',
  'filesSearchToggle','filesSortToggle','filesSettingsToggle','previewPhotoMenu','previewDownload',
  'closePreview','uploadStart','folder','refresh','gridView','listView','galleryView',
  'togglePassword','profileBindFolder','galleryYearReset']){
 assert.ok(get(id).children[0]?.tagName==='svg',id+' has an SVG button icon');
}
assert.deepEqual(uploader.children.map(n=>n.tagName),['svg','span','input'],
 'The Google Takeout file selector input survives decoration');
assert.equal(get('previewPhotoMenu').children.length,1,'Icon-only control has no decorative text');
assert.equal(get('filesSettingsToggle').attributes['aria-hidden'],undefined,
  'Accessiblity name stays on the button, icon remains hidden');
const action=new Node('button');icons.decorateLabel(action,'✎ Переименовать');
assert.equal(action.children[0].tagName,'svg');
assert.equal(action.children[1].textContent,'Переименовать');
assert.equal(action.dataset.nasIcon,'pencil');
icons.applyAdmin();
assert.equal(get('cacheClean').dataset.nasIcon,'trash-2');
assert.equal(get('adminBackToFiles').dataset.nasIcon,'arrow-left');
assert.match(html,/<script src="\/static\/nas-icons\.js" defer><\/script><script src="\/static\/app\.js" defer><\/script>/);
assert.match(admin,/<script src="\/static\/nas-icons\.js" defer><\/script><script src="\/static\/admin\.js" defer><\/script>/);
assert.match(backend,/@app\.get\("\/static\/nas-icons\.js"\)/);
assert.ok(!source.includes('cdn.jsdelivr')&&!source.includes('unpkg.com'),'No external icon CDN');
// XML namespace in a single literal URL is expected.
console.log('Common offline SVG icons, 66-button coverage, admin UI, upload input and route: OK');
