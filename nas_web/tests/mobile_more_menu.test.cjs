'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('nas_web/app/app.js','utf8');
const html=fs.readFileSync('nas_web/app/index.html','utf8');
const start=source.indexOf('const moreMenuIconPaths=');
const end=source.indexOf("el('mobileMore').onclick=openMoreMenu;",start);
assert.ok(start>0&&end>start,'standalone More drawer exists');
const code=source.slice(start,end)+"el('mobileMore').onclick=openMoreMenu;";
assert.ok(!code.includes("selectionModeButton"),'selection is not a More action');
assert.ok(!code.includes("globalGalleryRescan"),'refresh is not duplicated in More');
assert.match(source,/label:'☑ Выбрать файлы',run:\(\)=>el\('selectionModeButton'\)\.click\(\)/,
  'file selection is still available in the correct Files actions menu');
assert.match(html,/\.mobileSheet\.moreMenuSheet\{/,'dedicated compact drawer style');
assert.match(html,/\.moreMenuSheet \.moreMenuRow/,'rows scoped to More instead of all sheets');

class Node{
  constructor(tag){
    this.tag=tag;this.children=[];this.className='';
    this.textContent='';this.innerHTML='';this.dataset={};this.style={};
    this.attributes={};
    const set=new Set();
    this.classList={add:x=>set.add(x),remove:x=>set.delete(x),contains:x=>set.has(x)};
  }
  append(...parts){this.children.push(...parts)}
  replaceChildren(...parts){this.children=parts}
  setAttribute(key,value){this.attributes[key]=value}
}
const nodes=new Map();
const sheet=new Node('section');
const el=id=>{
  if(!nodes.has(id))nodes.set(id,new Node(id));
  return nodes.get(id);
};
el('mobileSheetOverlay').querySelector=name=>name==='.mobileSheet'?sheet:null;
let opened=[],closed=0,runs=[];
const doc={
  createElement:type=>new Node(type),createElementNS:(uri,type)=>new Node(type),
  documentElement:{dataset:{theme:'dark'}}
};
const make=new Function('document','el','openMobileSheet','closeMobileSheet','profileData',
  'openProfile','openCollections','openNasStats',code+
  '\nreturn {openMoreMenu};');
const app=make(doc,el,
  (title,actions)=>{opened.push([title,actions.length]);el('mobileSheetActions').replaceChildren()},
  ()=>{closed++;sheet.classList.remove('moreMenuSheet')},
  {display_name:'Пользователь',avatar_color:'#536f93'},
  ()=>runs.push('profile'),()=>runs.push('albums'),()=>runs.push('stats')
);
el('theme').click=()=>runs.push('theme');
el('logout').click=()=>runs.push('logout');

function allActions(){
  const result=[];
  function visit(node){
    if(node?.dataset?.moreAction)result.push(node);
    for(const child of node.children||[])visit(child);
  }
  visit(el('mobileSheetActions'));
  return result;
}
const expected=['profile','albums','statistics','appearance','logout'];
assert.equal(el('mobileMore').onclick,app.openMoreMenu);
app.openMoreMenu();
assert.deepEqual(opened,[['Ещё',0]]);
assert.ok(sheet.classList.contains('moreMenuSheet'));
assert.ok(el('mobileSheetActions').classList.contains('moreMenuContent'));
assert.deepEqual(allActions().map(node=>node.dataset.moreAction),expected);
assert.equal(allActions()[0].children[1].children[1].textContent,'Пользователь');
assert.equal(allActions()[3].children[2].textContent,'Тёмная');
for(let i=0;i<expected.length;i++){
  app.openMoreMenu();
  const action=allActions()[i];
  action.onclick();
}
assert.deepEqual(runs,['profile','albums','stats','theme','logout']);
assert.equal(closed,5);
assert.equal(allActions().length,5);
console.log('More is a compact five-action drawer; file-only actions stay in Files');
