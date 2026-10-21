'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('nas_web/app/app.js','utf8');
const positionsStart=source.indexOf("const VIDEO_PROGRESS_KEY='nasweb-video-positions-v1';");
const setupStart=source.indexOf("function setupVideoPlayback(video,f){",positionsStart);
const showStart=source.indexOf("function showPreview(direction=0)",setupStart);
assert.ok(positionsStart>0&&setupStart>positionsStart&&showStart>setupStart);
const backing=new Map(),storage={
 getItem:k=>backing.get(k)||null,
 setItem:(k,v)=>backing.set(k,v)
};
let user='one';
let fns=new Function('localStorage','videoUser','ext',source.slice(positionsStart,setupStart)+
 '\nreturn {videoIsTrackable,videoPositionKey,videoStoredPosition,videoWritePosition,videoSavedPositions,videoTime};')(
 storage,user,n=>(n.split('.').pop()||'').toLowerCase());
const file={name:'clip.mp4',size:888,modified:123};
const key=fns.videoPositionKey(file,'Public','Videos');
assert.equal(fns.videoIsTrackable(file),true);
assert.equal(fns.videoIsTrackable({...file,name:'sound.mp3'}),false);
assert.equal(fns.videoStoredPosition(key),0);
fns.videoWritePosition(key,132,300);
assert.equal(fns.videoStoredPosition(key),132);
assert.equal(fns.videoTime(132),'2:12');
assert.equal(fns.videoTime(3672),'1:01:12');
const other=fns.videoPositionKey({...file,modified:124},'Public','Videos');
assert.equal(fns.videoStoredPosition(other),0,'File replacement does not inherit old position');
const privateShare=fns.videoPositionKey(file,'Private','Videos');
assert.equal(fns.videoStoredPosition(privateShare),0,'No cross-share progress');
const otherUser=new Function('localStorage','videoUser','ext',source.slice(positionsStart,setupStart)+
 '\nreturn {videoPositionKey};')(storage,'two',()=> 'mp4');
assert.notEqual(otherUser.videoPositionKey(file,'Public','Videos'),key,
  'Session usernames isolate saved progress');
fns.videoWritePosition(key,299,300);
assert.equal(fns.videoStoredPosition(key),0,'Near completion clears saved progress');
fns.videoWritePosition(key,70,300);
fns.videoWritePosition(key,70,300,true);
assert.equal(fns.videoStoredPosition(key),0,'Ended media clears progress');
backing.set('nasweb-video-positions-v1','{INVALID');
assert.deepEqual(fns.videoSavedPositions(),{});
for(let n=0;n<200;n++)fns.videoWritePosition('file'+n,60,500);
assert.ok(Object.keys(fns.videoSavedPositions()).length<=150,'Bounded browser storage');

// Exercise the actual control wiring with a tiny fake DOM.
class Element{
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.className='';this.attributes={};
 this.classList={add:()=>{},remove:()=>{}};this.events={};this.style={};}
 append(...kids){this.children.push(...kids)}
 replaceChildren(...kids){this.children=kids}
 setAttribute(k,v){this.attributes[k]=v}
 addEventListener(k,fn){this.events[k]=fn}
 click(){this.onclick?.()}
}
const document={createElement:t=>new Element(t)};
const setup=new Function('document','videoPositionKey','videoStoredPosition','videoWritePosition','videoTime',
 'shownShare','shownDir','ext',source.slice(setupStart,showStart)+'\nreturn setupVideoPlayback;')(
 document,fns.videoPositionKey,fns.videoStoredPosition,fns.videoWritePosition,fns.videoTime,
 'Public','Videos',n=>n.split('.').at(-1));
const video=new Element('video');
video.duration=360;video.currentTime=0;video.ended=false;
video.requestFullscreen=()=>Promise.resolve();
const identity=fns.videoPositionKey(file,'Public','Videos');
fns.videoWritePosition(identity,90,360);
const wrapper=setup(video,file);
assert.equal(wrapper.className,'videoPlayback');
video.events.loadedmetadata();
assert.equal(video.currentTime,90,'Video resumes after metadata loads');
const controls=wrapper.children.at(-1);
assert.equal(controls.children.length,3);
controls.children[0].click();assert.equal(video.currentTime,80);
controls.children[1].click();assert.equal(video.currentTime,90);
assert.equal(typeof video._nasSavePosition,'function');
video.currentTime=100;
video._nasSavePosition();
assert.equal(fns.videoStoredPosition(identity),100);
video.events.ended();assert.equal(fns.videoStoredPosition(identity),0);
assert.ok(source.includes("'/api/video-poster?'"),'Lazy poster endpoint is used');
assert.ok(source.includes("photoObserver.observe(img);thumb.append(img)"),'Poster uses existing scroll observer');
assert.ok(source.includes("box.querySelector('video')?.pause()"),'Video is stopped on preview change');
assert.match(source,/video\.currentTime\+\(e\.key==='ArrowRight'\?10:-10\)/);
console.log('Video resume positions, account isolation, end reset, seek and fullscreen wiring OK');