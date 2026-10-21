'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('nas_web/app/app.js','utf8');
const start=source.indexOf('// Poll lightweight gallery metadata while it is open.');
const end=source.indexOf("let galleryRenderSignature='';",start);
assert.ok(start>0&&end>start,'Watcher code exists');
let revision=1,reloads=0,timelines=0,progress=0,memoryUpdates=0;
const events={};
const browser={scrollY:1800,addEventListener:(type,fn)=>{events[type]=fn}};
const page={hidden:false,addEventListener:(type,fn)=>{events[type]=fn}};
let watcher;
const env={
 window:browser,document:page,allPhotosMode:true,allPhotoSubsetMode:false,
 previewIndex:-1,allPhotoPageBusy:false,allPhotoScanToken:0,
 allPhotoStatus:null,allPhotoTotal:0,
 setInterval:fn=>{events.timer=fn;return 41},
 clearInterval:id=>assert.equal(id,41),
 api:async(url,opts)=>{
   assert.equal(url,'/api/gallery/scan');assert.equal(opts.method,'POST');
   return {revision,total:3,complete:true,scanned:2,pending:0}
 },
 loadGlobalPage:async reset=>{
   assert.equal(reset,true);reloads++;
   watcher.setSeen(revision);
 },
 loadGlobalTimeline:async()=>{timelines++},
 loadGalleryMemories:async()=>{memoryUpdates++},
 renderGlobalProgress:()=>{progress++}
};
const f=new Function(...Object.keys(env),source.slice(start,end)+
 '\nreturn {startGalleryWatch,stopGalleryWatch,watchGalleryChanges,applyGalleryChange,'+
 'getPending:()=>galleryPendingRevision,getSeen:()=>gallerySeenRevision,'+
 'setSeen:v=>{gallerySeenRevision=v},getTimer:()=>galleryWatchTimer};');
watcher=f(...Object.values(env));
async function run(){
 watcher.startGalleryWatch();
 assert.equal(watcher.getTimer(),41);
 await watcher.watchGalleryChanges();
 assert.equal(watcher.getSeen(),1);
 assert.equal(reloads,0);
 revision=2;await watcher.watchGalleryChanges();
 assert.equal(watcher.getPending(),2);
 assert.equal(reloads,0,'Deep scroll must never jump');
 browser.scrollY=0;
 events.scroll();
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(reloads,1);
 assert.equal(timelines,1);
 assert.equal(memoryUpdates,1,'Refresh memory stories when photo index changes');
 assert.equal(watcher.getPending(),null);
 assert.equal(watcher.getSeen(),2);
 watcher.stopGalleryWatch();
 assert.equal(watcher.getTimer(),null);
 assert.equal(watcher.getPending(),null);
 assert.equal(watcher.getSeen(),null);
 assert.ok(progress>=1);
 assert.match(source,/document\.addEventListener\('visibilitychange'/);
 console.log('Gallery auto-sync, scroll deferral and timer lifecycle OK');
}
run().catch(e=>{console.error(e);process.exitCode=1});
