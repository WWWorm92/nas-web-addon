'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('nas_web/app/index.html','utf8');
const js=fs.readFileSync('nas_web/app/app.js','utf8');

// Native iOS/Android Photos picker must not be opened until the destination is chosen.
assert.match(html, /id="uploadStart"[^>]*type="button"/);
assert.match(js, /el\('mobileAdd'\)\.onclick=[\s\S]*?run:startFileUpload/);
assert.match(js, /el\('uploadStart'\)\.onclick=startFileUpload/);
assert.match(js, /target=initialTarget\|\|await chooseUploadDestination\(files\)/);
assert.match(js, /uploadFiles\(files,target\)/);

const chooserStart=js.indexOf('function chooseUploadDestination(files,onConfirmed=null){');
const chooserEnd=js.indexOf('const uploadQueue=[];',chooserStart);
const start=js.indexOf('let pendingUploadTarget=null;');
const end=js.indexOf('async function uploadFiles(files,initialTarget=null){',start);
assert.ok(chooserStart>0&&chooserEnd>chooserStart&&start>chooserEnd&&end>start);

class Node {
  constructor(tag='div'){
    this.tag=tag;
    this.children=[];
    this.style={cssText:''};
    this.value='';
    this.textContent='';
    this.disabled=false;
    this.removed=false;
  }
  append(...nodes){this.children.push(...nodes)}
  replaceChildren(...nodes){this.children=[...nodes]}
  remove(){this.removed=true}
  click(){this.clickCount=(this.clickCount||0)+1}
}
const body=new Node('body');
const document={
  body,
  createElement:tag=>new Node(tag),
  querySelector:selector=>selector==='.nasUploadDestination'?
    body.children.find(node=>node.className==='nasUploadDestination'&&!node.removed)||null:null,
};
const input=new Node('input');
input.value='previous selection';
const notices=[];
const flow=new Function('shares','selected','dir','document','api','qs','el',
  'message','uploadBatchBusy','showUploadCenter',
  js.slice(chooserStart,chooserEnd)+js.slice(start,end)+
  '\nreturn {startFileUpload,chooseUploadDestination,getPending:()=>pendingUploadTarget};')(
    ['Photo'],'Photo','iPhone',document,
    async()=>({items:[{name:'Albums',directory:true},{name:'x.jpg',directory:false}]}),
    data=>new URLSearchParams(data).toString(),
    id=>id==='upload'?input:null,
    text=>notices.push(text),false,()=>{throw Error('Unexpected busy upload')}
  );
function dialog(){
  const overlay=document.querySelector('.nasUploadDestination');
  assert.ok(overlay,'The destination dialog must be visible');
  const panel=overlay.children[0];
  const actions=panel.children.at(-1);
  return {overlay,panel,cancel:actions.children[0],confirm:actions.children[1]};
}
(async()=>{
  flow.startFileUpload();
  let d=dialog();
  assert.match(d.panel.children[0].textContent,/Выберите папку/);
  assert.equal(input.clickCount||0,0,'The native picker must wait for a destination');
  await Promise.resolve();
  assert.equal(d.confirm.disabled,false,'The destination must be accessible');
  assert.equal(d.confirm.textContent,'Выбрать файлы');
  d.confirm.onclick();
  assert.equal(d.overlay.removed,true);
  assert.equal(input.clickCount,1,'Native picker opens synchronously from Confirm');
  assert.equal(input.value,'','The old selection is reset before opening iOS Photos');
  assert.deepEqual(flow.getPending(),{share:'Photo',path:'iPhone'});

  flow.startFileUpload();
  d=dialog();
  await Promise.resolve();
  d.cancel.onclick();
  assert.equal(input.clickCount,1,'Cancel never opens the native picker');
  assert.equal(flow.getPending(),null);

  const dragPromise=flow.chooseUploadDestination([{name:'image.jpg'}]);
  d=dialog();
  await Promise.resolve();
  assert.match(d.panel.children[0].textContent,/1 файл/);
  assert.equal(d.confirm.textContent,'Загрузить сюда');
  d.confirm.onclick();
  assert.deepEqual(await dragPromise,{share:'Photo',path:'iPhone'});
  assert.equal(input.clickCount,1,'Drag-and-drop still uses destination-after-files');
  console.log('Upload destination-first on phone/desktop and drag-drop fallback: OK');
})().catch(err=>{console.error(err);process.exitCode=1});
