'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('nas_web/app/app.js','utf8');
const start=source.indexOf('const uploadQueue=[];');
const end=source.indexOf('async function uploadFiles(files){',start);
assert.ok(start>0&&end>start,'Upload helpers exist');
const sent=[];
class XHR{
 constructor(){this.upload={};this.status=0;this.responseText='';sent.push(this)}
 open(method,url){assert.equal(method,'POST');assert.equal(url,'/api/upload')}
 setRequestHeader(name,v){assert.equal(name,'X-CSRF-Token');assert.equal(v,'csrf')}
 send(form){this.form=form}
 abort(){this.onabort()}
 done(status){this.status=status;this.onload()}
}
const mock={XMLHttpRequest:XHR,FormData:class{set(){}},DOMException:class extends Error{constructor(s,n){super(s);this.name=n}},
 csrf:'csrf',performance:{now:()=>1000},Event:class{},document:{dispatchEvent(){}},
 el:id=>({app:{classList:{toggle(){}}},uploadCenterButton:{},progressFill:{style:{}}})[id],
 size:n=>Math.floor(n)+'B'};
const f=new Function(...Object.keys(mock),source.slice(start,end)+
 '\nreturn {uploadQueue,uploadTick,uploadEta,uploadDescription,uploadOne,cancelUploadJob,setUploadStage};')(...Object.values(mock));
const make=()=>({name:'big.bin',bytes:1000000,stage:'queued',progress:0,sent:0,speed:0,
 remaining:null,sampleAt:0,sampleBytes:0,xhr:null,error:''});
const m=make();
f.uploadTick(m,250000,1000000,1000);
f.uploadTick(m,500000,1000000,1500);
assert.equal(m.progress,50);assert.ok(m.speed>0&&m.remaining>0);
f.uploadTick(m,1000000,1000000,2000);
assert.equal(m.progress,99,'Upload body is not committed to SMB yet');
assert.equal(f.uploadEta(65),'1 мин 5 с');
assert.equal(f.uploadEta(3660),'1 ч 1 мин');
const waiting=make();assert.equal(f.cancelUploadJob(waiting),true);
assert.equal(waiting.stage,'canceled');
async function run(){
 const active=make();
 const canceled=f.uploadOne({name:'a.bin'},{share:'Public',path:''},active);
 assert.equal(active.stage,'sending');
 assert.equal(f.cancelUploadJob(active),true);
 await assert.rejects(canceled,{name:'AbortError'});
 assert.equal(active.stage,'canceled');
 const saving=make();
 const result=f.uploadOne({name:'b.bin'},{share:'Public',path:''},saving);
 const xhr=sent.at(-1);
 xhr.upload.onload();
 assert.equal(saving.stage,'saving');
 assert.equal(saving.progress,99);
 assert.equal(f.cancelUploadJob(saving),false,'Do not abort SMB save');
 xhr.done(200);await result;
 f.setUploadStage(saving,'done',100);
 assert.equal(saving.progress,100);
 const bad=make();const fail=f.uploadOne({name:'c.bin'},{share:'Public',path:''},bad);
 sent.at(-1).done(409);await assert.rejects(fail,/HTTP 409/);
 console.log('Upload progress, rate, ETA, cancellation, SMB saving stage: OK');
}
run().catch(err=>{console.error(err);process.exitCode=1});
