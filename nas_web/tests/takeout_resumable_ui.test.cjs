'use strict';
// Simulate Takeout chunk ACK loss and browser-side automatic recovery.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('nas_web/app/app.js','utf8');
const start=source.indexOf('// A Takeout ZIP is never sent as one long HTTP request:');
const end=source.indexOf('async function waitImportJob(id){',start);
assert.ok(start>=0&&end>start,'resumable frontend functions present');
let stored=0,parts=[],lostOnce=true,finalized=false;
const elements=new Map();
function el(id){
  if(!elements.has(id))elements.set(id,{
    classList:{add(){},remove(){}},textContent:'',value:0
  });
  return elements.get(id);
}
class XHR{
  constructor(){
    this.status=0;this.responseText='';
    this.upload={};this.timeout=0;
  }
  open(method,url){
    this.method=method;this.url=url;
  }
  setRequestHeader(){}
  send(blob){
    assert.equal(this.method,'PUT');
    assert.equal(blob.size,4,'file is sliced into bounded pieces');
    const query=new URLSearchParams(this.url.split('?')[1]);
    const offset=Number(query.get('offset'));
    parts.push(offset);
    if(offset===0){
      stored=4;this.status=200;
      this.responseText=JSON.stringify({offset:4,size:8});
      this.onload();
    }else if(offset===4&&lostOnce){
      lostOnce=false;stored=8;
      this.onerror(); // Bytes reached server but its ACK was lost.
    }else{
      assert.fail('Unexpected retransmit at '+offset);
    }
  }
}
const env={
  XMLHttpRequest:XHR,
  el,csrf:'token',
  qs:values=>new URLSearchParams(values).toString(),
  size:n=>n+' bytes',
  collectionPost:async (route,body)=>{
    if(route.includes('/start'))return{upload_id:'id_123',chunk_size:4,offset:0};
    assert.equal(route,'/api/import/google/takeout/finish');
    assert.equal(stored,8,'server has the complete archive before finish');
    finalized=true;return{job_id:'job_id'};
  },
  api:async route=>{
    assert.match(route,/takeout\/status/);
    return {upload_id:'id_123',offset:stored,size:8};
  },
  setTimeout:fn=>{fn();return 1}
};
const get=new Function(...Object.keys(env),source.slice(start,end)+
  '\nreturn {sendTakeoutChunk,submitTakeoutArchive};');
const {submitTakeoutArchive}=get(...Object.values(env));
const file={name:'photos.zip',size:8,lastModified:123,
  slice:(start,end)=>({size:end-start,start,end})};
(async()=>{
  const response=await submitTakeoutArchive(file,{share:'Photo',path:'Photos'});
  assert.equal(response.job_id,'job_id');
  assert.deepEqual(parts,[0,4],'lost ACK resumes from server, does not resend ZIP');
  assert.equal(finalized,true);
  assert.match(el('profileImportUploadText').textContent,/проверяем архив/);
  console.log('Takeout chunks recover after a lost response without reuploading the ZIP');
})().catch(error=>{console.error(error);process.exitCode=1});
