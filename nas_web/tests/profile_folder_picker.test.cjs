'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('nas_web/app/index.html','utf8');
const js=fs.readFileSync('nas_web/app/app.js','utf8');

for(const id of ['profilePicker','profilePickShare','profilePickTrail','profilePickFolders','profilePickConfirm','profileBindFolder']){
  assert.match(html,new RegExp('id="'+id+'"'),id+' missing in HTML');
}
assert.match(js, /el\('profileBindFolder'\)\.onclick=openProfilePicker/);
assert.doesNotMatch(js, /profileBindFolder'\)\.disabled=!allPhotosMode/);

const start=js.indexOf('let profilePickShare=');
const end=js.indexOf('function closeProfile(){',start);
assert.ok(start>=0&&end>start,'picker source exists');
const code=js.slice(start,end);

class Node {
  constructor(tag='node'){
    this.tag=tag;
    this.children=[];
    const flags=new Set(['hidden']);
    this.classList={
      add:x=>flags.add(x),
      remove:x=>flags.delete(x),
      contains:x=>flags.has(x),
    };
    this.value='';this.disabled=false;
  }
  append(...nodes){this.children.push(...nodes)}
  replaceChildren(...nodes){this.children=[...nodes]}
  scrollIntoView(){}
}
const nodes=new Map();
const el=id=>{
  if(!nodes.has(id))nodes.set(id,new Node(id));
  return nodes.get(id);
};
const requests=[],bindings=[],notices=[];
const fixture=new Function('el','document','shares','selected','dir','allPhotosMode','api',
  'qs','profileNotice','collectionPost','renderProfile','profileData',
  code+'\nreturn {openProfilePicker,profileBrowseFolder,closeProfilePicker};');
const picker=fixture(el,{createElement:tag=>new Node(tag)},['Photo'],
  'Photo','AlreadyOpen',true,
  async url=>{
    requests.push(url);
    return {items:[
      {directory:true,name:'Family'},
      {directory:true,name:'.recycle'},
      {directory:false,name:'file.jpg'}
    ]};
  },
  data=>new URLSearchParams(data).toString(),
  msg=>notices.push(msg),
  async (url,payload)=>{bindings.push({url,payload});return{username:'alice',folders:[]};},
  ()=>{},null);

async function drain(){await new Promise(resolve=>setImmediate(resolve))}
(async()=>{
  picker.openProfilePicker();
  await drain();
  // Opening from the global gallery must show the share root, not disable binding.
  assert.equal(requests[0],'/api/list?share=Photo&path=');
  assert.equal(el('profilePickConfirm').disabled,true,'share root cannot be claimed');
  assert.equal(el('profilePickFolders').children.length,1,'file and recycle excluded');
  el('profilePickFolders').children[0].onclick();
  await drain();
  assert.equal(requests[1],'/api/list?share=Photo&path=Family');
  assert.equal(el('profilePickConfirm').disabled,false,'nested folder is bindable');
  await el('profilePickConfirm').onclick();
  assert.deepEqual(bindings,[{url:'/api/profile/folders',payload:{share:'Photo',path:'Family'}}]);
  assert.equal(el('profilePicker').classList.contains('hidden'),true);
  console.log('Profile folder picker: accessible from gallery, SMB directory traversal and binding OK');
})().catch(error=>{console.error(error);process.exitCode=1});
