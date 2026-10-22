'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const icons=fs.readFileSync('nas_web/app/nas-icons.js','utf8');
const page=fs.readFileSync('nas_web/app/index.html','utf8');
const ids=['mobileHome','mobileSearch','mobileAdd','mobilePhotos','mobileMore'];

class Node {
  constructor(tag,id=null){this.tagName=tag;this.id=id;this.attributes={};this.children=[];this.dataset={};
    const flags=new Set();this.classList={add:c=>flags.add(c),contains:c=>flags.has(c)};}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  setAttribute(k,v){this.attributes[k]=v;}
  set textContent(value){this._text=value;}
  get textContent(){return this._text;}
  set innerHTML(value){this._html=value;}
  get innerHTML(){return this._html;}
  closest(selector){return selector==='#mobileNav'&&ids.includes(this.id)?{id:'mobileNav'}:null;}
}
const nodes=new Map();
const doc={
  createElement:tag=>new Node(tag),
  createElementNS:(_,tag)=>new Node(tag),
  getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Node('button',id));return nodes.get(id);},
  querySelectorAll:()=>[],
  querySelector:()=>null,
};
const window={};
vm.runInNewContext(icons,{window,document:doc},{filename:'nas-icons.js'});
window.NASIcons.applyStatic();
for(const id of ids){
  const button=nodes.get(id);
  assert.equal(button.children[0].tagName,'svg',id+' SVG icon');
  assert.equal(button.children[1].tagName,'small',id+' must have compact small caption');
  assert.ok(button.children[1].textContent, id+' caption not empty');
  assert.equal(button.children[1].className,'nasIconLabel');
}
assert.equal(nodes.get('folder').children[1].tagName,'span',
  'Desktop text buttons must keep normal inline label elements');
// index.html uses more than one style block; inspect the final appended icon CSS.
const style=page.slice(0,page.lastIndexOf('</style>'));
const bottomRule=style.match(/#app #mobileNav\.mobileNav button\.hasNasIcon \.nasIconLabel\s*\{([^}]+)\}/);
assert.ok(bottomRule,'Scoped nav label rule exists');
const decl=bottomRule[1];
for(const expression of [/font-size:\s*10px/,/font-weight:\s*650/,/line-height:\s*1\.2/,/width:\s*100%/,/max-width:\s*100%/,/text-overflow:\s*ellipsis/,/background:\s*transparent/])
 assert.match(decl,expression,'Compact caption declaration '+expression);
assert.doesNotMatch(style,/#app \.mobileNav button\.hasNasIcon \.nasIconLabel\s*\{\s*font-size:\s*inherit/,
  'Old inherited 22px font must not override captions');
const plus=style.match(/#app #mobileNav\.mobileNav button\.mobileAdd\.hasNasIcon > \.nasIcon\s*\{([^}]+)\}/);
assert.ok(plus,'Background accent is applied to the + icon');
assert.match(plus[1],/background:\s*var\(--accentbg\)/);
assert.doesNotMatch(plus[1],/font-size/);
console.log('Mobile bottom nav: five compact captions, safe add accent, no 22px regression: OK');
