'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const code=fs.readFileSync('nas_web/app/app.js','utf8');
const start=code.indexOf('function galleryHasNextPage(){');
const end=code.indexOf('async function scanAllPhotos(token){',start);
assert.ok(start>0&&end>start);
const pagination=code.slice(start,end);
assert.doesNotMatch(code.slice(code.indexOf('const galleryNextObserver='),
  code.indexOf('galleryNextObserver.observe')),/allPhotoStatus\?\.complete/);
assert.match(code,/window\.addEventListener\('scroll',gallerySchedulePageCheck/);
assert.match(code,/window\.addEventListener\('resize',gallerySchedulePageCheck/);

function harness(total=1030){
  const requests=[],frames=[],messages=[];
  let failAt=-1,emptyAt=-1,footerTop=120;
  const footer={
    classList:{hidden:false,toggle(name,on){if(name==='hidden')this.hidden=on},
      contains(name){return name==='hidden'&&this.hidden}},
    getBoundingClientRect(){return {top:footerTop,bottom:footerTop+80}}
  },more={textContent:''};
  const el=id=>id==='galleryPageFooter'?footer:more;
  let view=null;
  const state={
    allPhotosMode:true,allPhotoSubsetMode:false,allPhotoPageBusy:false,
    allPhotoScanToken:3,allPhotoStartOffset:0,allPhotoNextOffset:0,
    allPhotoTotal:0,allPhotoStatus:null,allPhotos:[],galleryPagingError:'',
    galleryPageCheckFrame:0,gallerySeenRevision:null
  };
  const deps={
    el,document:{hidden:false},
    requestAnimationFrame:cb=>{frames.push(cb);return frames.length},
    api:async url=>{
      const offset=Number(new URLSearchParams(url.split('?')[1]).get('offset'));
      requests.push(offset);
      if(offset===failAt)throw Error('Transient 502');
      const length=offset===emptyAt?0:Math.min(90,total-offset);
      return {complete:false,total,items:Array.from({length},(_,i)=>({
        share:'Photo',path:'image'+(offset+i)+'.jpg',name:'image'+(offset+i)+'.jpg'
      })),revision:1};
    },
    qs:obj=>new URLSearchParams(obj).toString(),
    render:()=>view.galleryUpdatePageFooter(),
    message:x=>messages.push(x),
    innerHeight:800
  };
  const head=Object.entries(state).map(([k,v])=>'let '+k+'='+JSON.stringify(v)+';').join('\n');
  view=new Function(...Object.keys(deps),head+pagination+
    '\nreturn {loadGlobalPage,gallerySchedulePageCheck,galleryMaybeLoadMore,galleryUpdatePageFooter,'+
    'read:()=>({total:allPhotoTotal,loaded:allPhotos.length,offset:allPhotoNextOffset,'+
    'error:galleryPagingError,busy:allPhotoPageBusy})};'
  )(...Object.values(deps));
  return {
    view,requests,messages,footer,more,
    failAt:n=>{failAt=n},emptyAt:n=>{emptyAt=n},footerTop:n=>{footerTop=n},
    async tick(){
      const copy=frames.splice(0);
      for(const frame of copy)frame();
      await new Promise(resolve=>setImmediate(resolve));
    }
  };
}
(async()=>{
  // The bottom sentinel never leaves the viewport. Loading still completes.
  const h=harness(1305);
  await h.view.loadGlobalPage(true);
  for(let i=0;i<30&&h.view.read().loaded<1305;i++)await h.tick();
  assert.equal(h.view.read().loaded,1305);
  assert.equal(h.view.read().offset,1305);
  assert.deepEqual(h.requests,Array.from({length:15},(_,i)=>90*i));
  assert.equal(h.footer.classList.hidden,true);

  // When the sentinel is far below the viewport, wait for scroll proximity.
  const distant=harness(270);
  distant.footerTop(5000);
  await distant.view.loadGlobalPage(true);
  await distant.tick();
  assert.equal(distant.view.read().loaded,90);
  distant.footerTop(120);
  distant.view.gallerySchedulePageCheck();
  for(let i=0;i<5;i++)await distant.tick();
  assert.equal(distant.view.read().loaded,270);

  // Network errors pause auto-retry but allow retry using the same page offset.
  const flaky=harness(360);
  flaky.failAt(90);
  await flaky.view.loadGlobalPage(true);
  for(let i=0;i<4;i++)await flaky.tick();
  assert.equal(flaky.view.read().loaded,90);
  assert.match(flaky.view.read().error,/502/);
  assert.equal(flaky.more.textContent,'Повторить загрузку');
  const before=flaky.requests.length;
  for(let i=0;i<5;i++){flaky.view.gallerySchedulePageCheck();await flaky.tick()}
  assert.equal(flaky.requests.length,before);
  flaky.failAt(-1);
  await flaky.view.loadGlobalPage(false);
  for(let i=0;i<10;i++)await flaky.tick();
  assert.equal(flaky.view.read().loaded,360);

  const empty=harness(250);
  empty.emptyAt(90);
  await empty.view.loadGlobalPage(true);
  for(let i=0;i<4;i++)await empty.tick();
  assert.equal(empty.view.read().loaded,90);
  assert.match(empty.view.read().error,/пустую страницу/);
  assert.equal(empty.view.read().offset,90);
  assert.deepEqual(empty.requests,[0,90]);
  console.log('Gallery pagination: 1305 photos, scrolling, retry and empty-page guard OK');
})().catch(err=>{console.error(err);process.exitCode=1});
