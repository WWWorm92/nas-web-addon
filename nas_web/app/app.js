let csrf='',selected='',dir='',shares=[],items=[],view=(['grid','list'].includes(localStorage.getItem('nas_view'))?localStorage.getItem('nas_view'):'grid'),previewIndex=-1;
const el=id=>document.getElementById(id);
const message=s=>el('status').textContent=s;
const qs=o=>new URLSearchParams(o).toString();
const ext=n=>(n.split('.').pop()||'').toLowerCase();
const imageExt=['jpg','jpeg','png','gif','webp'];
const videoExt=['mp4','webm','m4v','mov','mp3','ogg'];

const ICON_PATHS={
 folder:'<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z"/>',
 trash:'<path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13M10 11v6m4-6v6"/>',
 image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="9" r="1.5"/><path d="m3 17 5-5 4 4 3-3 6 6"/>',
 video:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m10 8 6 4-6 4z"/>',
 file:'<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
 pdf:'<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M9 14h6m-6 3h4"/>',
 disk:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M6 15h12M8 18h.01"/>',
 music:'<path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'
};
function icon(kind,cls=''){const span=document.createElement('span');span.className='vectorIcon '+cls;const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.6');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('stroke-linecap','round');svg.innerHTML=ICON_PATHS[kind]||ICON_PATHS.file;span.append(svg);return span}
const fileKind=f=>f.directory?'folder':imageExt.includes(ext(f.name))?'image':videoExt.includes(ext(f.name))?(['mp3','ogg'].includes(ext(f.name))?'music':'video'):ext(f.name)==='pdf'?'pdf':'file';

const canPreview=f=>!f.directory&&(imageExt.includes(ext(f.name))||videoExt.includes(ext(f.name))||ext(f.name)==='pdf');
const size=n=>n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':n<1073741824?(n/1048576).toFixed(1)+' MB':(n/1073741824).toFixed(2)+' GB';
const fpath=name=>[dir,name].filter(Boolean).join('/');
const fileUrl=(name,inline=false)=>'/api/file?'+qs({share:selected,path:fpath(name),inline:String(inline)});
let loginGeneration=0,videoUser='';
async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',...options,headers:{...(options.headers||{}),'X-CSRF-Token':csrf}});if(!r.ok){let m='HTTP '+r.status;try{m=(await r.json()).detail||m}catch{}if(r.status===401&&url!=='/api/login'&&url!=='/api/me')showLogin();throw Error(m)}return r.json()}
function showLogin(){closeProfile();profileData=null;googleImportDestination=null;googlePickerWaiting=false;videoUser='';resetFileManagerState();leaveGlobalGallery();closeMobileSheet();hideMenu();closePreview();photoCacheClear();el('login').classList.remove('hidden');el('app').classList.add('hidden')}
function showApp(user){videoUser=String(user.username||'').toLocaleLowerCase();resetFileManagerState();closeMobileSheet();photoCacheClear();csrf=user.csrf;shares=user.shares;el('who').textContent=user.username;el('login').classList.add('hidden');el('app').classList.remove('hidden');renderShares();refreshProfile().catch(err=>console.warn('Profile:',err.message));if(shares.length)choose(shares[0]);else message('У пользователя нет доступных SMB-шар.')}
function renderShares(){el('shares').replaceChildren();for(const share of shares){const b=document.createElement('button');b.className='share'+(share===selected?' selected':'');b.append(icon('disk'),document.createTextNode(' '+share));b.onclick=()=>choose(share);el('shares').append(b)}}
const selectedFiles=new Set();
let selectionMode=false;
function updateSelection(){
  const active=selectedFiles.size>0||selectionMode;
  el('selectionBar').classList.toggle('hidden',!active);
  el('selectionModeButton').classList.toggle('activeSelect',active);
  el('entries').classList.toggle('selectionMode',active);
  el('selectionCount').textContent=selectedFiles.size+' выбрано';
  el('selectionDownload').disabled=selectedFiles.size!==1||!!items.find(f=>selectedFiles.has(f.name)&&f.directory);
  el('selectionDelete').disabled=selectedFiles.size===0;
  updateMobileNav();
  el('selectionCopy').disabled=selectedFiles.size===0;
  el('selectionMove').disabled=selectedFiles.size===0;
  el('selectionZip').disabled=selectedFiles.size===0;
  for(const tile of el('entries').querySelectorAll('.item[data-filename]')){
    const selected=selectedFiles.has(tile.dataset.filename);
    tile.classList.toggle('selectedItem',selected);
    const check=tile.querySelector('.selectionCheck');
    if(check){check.textContent=selected?'✓':'○';check.setAttribute('aria-pressed',String(selected))}
  }
}
function clearSelection(){selectedFiles.clear();selectionMode=false;updateSelection()}
function toggleSelected(name){selectionMode=true;if(selectedFiles.has(name))selectedFiles.delete(name);else selectedFiles.add(name);updateSelection()}

const folderScrollPositions=new Map();
const folderScrollKey=(share,path)=>JSON.stringify([share,path]);
function rememberFolderScroll(){
  if(!allPhotosMode&&selected)folderScrollPositions.set(folderScrollKey(selected,dir),window.scrollY);
}
async function navigateFiles(target,{restore=false}={}){
  if(target===dir)return;
  rememberFolderScroll();
  photoCacheClear();clearSelection();hideMenu();
  dir=target;el('search').value='';
  const share=selected,targetKey=folderScrollKey(share,target);
  const y=restore?(folderScrollPositions.get(targetKey)||0):0;
  if(!restore)folderScrollPositions.set(targetKey,0);
  const cached=Boolean(cachedFolderList(share,target));
  const loading=refresh();
  if(cached&&selected===share&&dir===target)
    requestAnimationFrame(()=>window.scrollTo({top:y,behavior:'instant'}));
  await loading;
  if(selected===share&&dir===target)
    requestAnimationFrame(()=>window.scrollTo({top:y,behavior:'instant'}));
}
function renderBreadcrumb(){
  const crumb=el('crumb');crumb.replaceChildren();
  const parts=dir?dir.split('/'):[];
  const add=(label,target,last)=>{
    const btn=document.createElement('button');btn.type='button';btn.textContent=label==='.recycle'?'Корзина':label;
    if(last)btn.setAttribute('aria-current','page');
    btn.onclick=()=>navigateFiles(target,{restore:true});
    attachFolderDrop(btn,()=>({share:selected,path:target}));
    crumb.append(btn);
  };
  add(selected,'',parts.length===0);
  parts.forEach((part,i)=>{const sep=document.createElement('span');sep.className='crumbSep';sep.textContent='›';crumb.append(sep);add(part,parts.slice(0,i+1).join('/'),i===parts.length-1)});
}
function choose(share){rememberFolderScroll();leaveGlobalGallery();clearSelection();photoCacheClear();hideMenu();selected=share;dir='';el('search').value='';renderShares();refresh().then(()=>{if(selected===share&&dir==='')requestAnimationFrame(()=>window.scrollTo({top:0,behavior:'instant'}))})}
function enterFolder(name){leaveGlobalGallery();navigateFiles(fpath(name))}
function download(f){const a=document.createElement('a');a.href=fileUrl(f.name);a.download=f.name;a.click()}
const isPhoto=f=>!f.directory&&imageExt.includes(ext(f.name));
let allPhotosMode=false,allPhotos=[],allPhotoTotal=0,allPhotoStatus=null,allPhotoPageBusy=false,allPhotoScanToken=0,previousFileView='grid';
let allPhotoStartOffset=0,allPhotoNextOffset=0,allPhotoTimeline=[],allPhotoTimelineCheckedAt=0,allPhotoSubsetMode=false;
const photoLocation=f=>({share:f.share||shownShare,folder:f.folder!==undefined?f.folder:shownDir});
const photoDate=f=>f.taken?new Date(f.taken):new Date(Number(f.modified||0)*1000);
const photoGalleryItems=()=>sortedFiltered().filter(isPhoto).sort((a,b)=>photoDate(b)-photoDate(a)||a.name.localeCompare(b.name,'ru'));
function photoDay(f){const d=photoDate(f);if(!Number.isFinite(d.getTime())||d.getFullYear()<1970)return 'Без даты';const today=new Date();if(d.toDateString()===today.toDateString())return 'Сегодня';const yesterday=new Date(today);yesterday.setDate(today.getDate()-1);if(d.toDateString()===yesterday.toDateString())return 'Вчера';return new Intl.DateTimeFormat('ru',{day:'numeric',month:'long',year:'numeric'}).format(d)}
function photoMonth(f){const d=photoDate(f);if(!Number.isFinite(d.getTime())||d.getFullYear()<1970)return 'Без даты';return new Intl.DateTimeFormat('ru',{month:'long',year:'numeric'}).format(d)}
function photoYear(f){const d=photoDate(f);return Number.isFinite(d.getTime())&&d.getFullYear()>=1970?String(d.getFullYear()):'Без даты'}
let galleryDateGeneration=0;
async function scanGalleryDates(){
  const generation=++galleryDateGeneration,share=selected,folder=dir;
  if(view!=='gallery'||!share)return;
  const photos=items.filter(isPhoto),batchSize=8;
  for(let i=0;i<photos.length;i+=batchSize){
    if(generation!==galleryDateGeneration||view!=='gallery'||selected!==share||dir!==folder)return;
    while(previewIndex>=0){
      await new Promise(resolve=>setTimeout(resolve,300));
      if(generation!==galleryDateGeneration||view!=='gallery'||selected!==share||dir!==folder)return;
    }
    const batch=photos.slice(i,i+batchSize);
    try{
      const data=await api('/api/photo-dates',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({share,path:folder,files:batch.map(f=>({name:f.name,size:f.size,modified:f.modified}))})});
      if(generation!==galleryDateGeneration||selected!==share||dir!==folder)return;
      for(const f of batch){const entry=data.dates?.[f.name];if(entry&&entry.cached)f.taken=entry.taken||null}
      message('Проверяем даты съёмки: '+Math.min(i+batchSize,photos.length)+' / '+photos.length);
    }catch(e){if(generation===galleryDateGeneration)message('EXIF: '+e.message);return}
    if(i+batchSize<photos.length)await new Promise(resolve=>setTimeout(resolve,140));
  }
  if(generation===galleryDateGeneration&&view==='gallery'&&selected===share&&dir===folder){
    // Rebuild once after indexing, not for each photo: thumbnails keep priority.
    if(previewIndex<0){const before=window.scrollY;render();window.scrollTo(0,before)}
    message(photos.length+' фотографий · даты съёмки проверены');
  }
}
function showPhotoDetails(f){
  const loc=photoLocation(f),overlay=document.createElement('div');
  overlay.className='transferOverlay';
  const panel=document.createElement('div');panel.className='transferPanel';
  const title=document.createElement('h3');title.textContent='Сведения о фотографии';
  panel.append(title);
  const rows=[
    ['Имя',f.name],['Дата съёмки',f.taken?new Date(f.taken).toLocaleString('ru'):'Нет данных EXIF'],
    ['Дата изменения',new Date(Number(f.modified||0)*1000).toLocaleString('ru')],
    ['Размер',f.size!=null?(Number(f.size)/1048576).toFixed(2)+' МБ':'Неизвестен'],
    ['Расположение',loc.share+' / '+[loc.folder,f.name].filter(Boolean).join('/')]
  ];
  for(const [name,value] of rows){const line=document.createElement('div');line.className='photoInfoRow';const label=document.createElement('small');label.textContent=name;const detail=document.createElement('span');detail.textContent=value;line.append(label,detail);panel.append(line)}
  const close=document.createElement('button');close.textContent='Закрыть';close.onclick=()=>overlay.remove();
  panel.append(close);overlay.append(panel);overlay.onclick=e=>{if(e.target===overlay)overlay.remove()};document.body.append(overlay);
}
let galleryColumns=Number(localStorage.getItem('nasweb-gallery-columns')||3);
if(![2,3,4,5].includes(galleryColumns))galleryColumns=3;
const galleryPicked=new Map();
let galleryPickMode=false;
function galleryId(f){return f.share+'\\0'+f.path}
function updateGalleryPick(){
  const bar=el('galleryPickBar');
  if(!bar)return;
  bar.classList.toggle('hidden',!galleryPickMode);
  el('galleryPickCount').textContent=galleryPicked.size+' выбрано';
  for(const tile of el('entries').querySelectorAll('.galleryPhoto[data-photo-id]')){
    const yes=galleryPicked.has(tile.dataset.photoId);
    tile.classList.toggle('selectedItem',yes);
    tile.setAttribute('aria-selected',String(yes));
  }
}
function toggleGalleryPick(f){
  galleryPickMode=true;
  const id=galleryId(f);
  if(galleryPicked.has(id))galleryPicked.delete(id);else galleryPicked.set(id,f);
  updateGalleryPick();
}
function clearGalleryPick(){galleryPicked.clear();galleryPickMode=false;updateGalleryPick()}
function setGalleryColumns(n){
  galleryColumns=Math.max(2,Math.min(5,n));
  localStorage.setItem('nasweb-gallery-columns',String(galleryColumns));
  el('entries').style.setProperty('--gallery-columns',galleryColumns);
  el('galleryZoomLabel').textContent=galleryColumns+' в ряд';
}
function galleryJumpTo(year,month){
  if(allPhotosMode&&galleryVirtualScrollTo(year,month))return;
  const heading=[...el('entries').querySelectorAll('.galleryMonth')].find(h=>h.dataset.year===year&&(!month||h.dataset.month===month));
  if(heading)heading.scrollIntoView({behavior:'smooth',block:'start'});
}
function renderGalleryYears(photos){
  const bar=el('galleryYears');bar.replaceChildren();
  if(view!=='gallery'){bar.classList.add('hidden');return}
  const fullIndex=allPhotosMode&&!allPhotoSubsetMode;
  const months=fullIndex?allPhotoTimeline:null;
  const years=months
    ? [...new Set(months.map(m=>m.month.slice(0,4)))]
    : [...new Set(photos.map(photoYear))];
  bar.classList.toggle('hidden',!years.length);
  const picker=el('galleryMonthJump');
  if(picker){
    const previous=picker.value;
    picker.replaceChildren();
    const first=document.createElement('option');first.value='';
    first.textContent=fullIndex&&!months.length?'Загружаем все месяцы…':'Перейти к месяцу';
    picker.append(first);picker.disabled=fullIndex&&!months.length;
    if(months){
      for(const item of months){
        const option=document.createElement('option');option.value=item.month;
        const [year,month]=item.month.split('-').map(Number);
        const label=new Intl.DateTimeFormat('ru',{month:'long',year:'numeric'}).format(new Date(year,month-1,1));
        option.textContent=label+' · '+item.count+' фото';
        picker.append(option);
      }
    }else{
      const seen=new Set();
      for(const f of photos){
        const d=photoDate(f);if(!Number.isFinite(d.getTime()))continue;
        const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
        if(seen.has(key))continue;
        seen.add(key);const option=document.createElement('option');option.value=key;
        option.textContent=new Intl.DateTimeFormat('ru',{month:'long',year:'numeric'}).format(d);
        picker.append(option);
      }
    }
    if([...picker.options].some(option=>option.value===previous))picker.value=previous;
  }
  for(const year of years){
    const button=document.createElement('button');button.type='button';button.textContent=year;
    button.onclick=()=>{
      if(months){
        const firstMonth=months.find(m=>m.month.slice(0,4)===year);
        if(firstMonth)jumpToGlobalMonth(firstMonth.month);
      }else{
        galleryJumpTo(year);
      }
      for(const b of bar.children)b.classList.toggle('galleryYearCurrent',b===button);
    };
    bar.append(button);
  }
}
let gallery=[],zoom=1,panX=0,panY=0,preloadTimer=null,viewerSerial=0,shownShare='',shownDir='',filmNodes=new Map();
let originalController=null, originalObjectUrl=null;
const originalCache=new Map();
let originalCacheBytes=0;
const ORIGINAL_CACHE_LIMIT=48*1024*1024;

let photoFetches=new Map();
function photoKey(f){const loc=photoLocation(f);return [csrf,loc.share,loc.folder,f.name,f.modified||0,f.size||0].join('|')}
function photoCacheGet(key){const entry=originalCache.get(key);if(!entry)return null;originalCache.delete(key);originalCache.set(key,entry);return entry.url}
function photoCachePut(key,blob){
  if(blob.size>ORIGINAL_CACHE_LIMIT){originalObjectUrl=URL.createObjectURL(blob);return originalObjectUrl}
  const existing=originalCache.get(key);
  if(existing){originalCacheBytes-=existing.size;URL.revokeObjectURL(existing.url);originalCache.delete(key)}
  const url=URL.createObjectURL(blob);
  originalCache.set(key,{url,size:blob.size});originalCacheBytes+=blob.size;
  while(originalCacheBytes>ORIGINAL_CACHE_LIMIT){
    const oldest=originalCache.keys().next().value;
    if(oldest===key)break;
    const entry=originalCache.get(oldest);originalCache.delete(oldest);
    originalCacheBytes-=entry.size;URL.revokeObjectURL(entry.url);
  }
  return url;
}
function photoSource(f){const loc=photoLocation(f);return ['jpg','jpeg'].includes(ext(f.name))?'/api/photo?'+qs({share:loc.share,path:[loc.folder,f.name].filter(Boolean).join('/')}):imageURL(f,true,loc.folder,loc.share)}
function photoLoad(f){
  const key=photoKey(f),hit=photoCacheGet(key);
  if(hit)return Promise.resolve(hit);
  if(photoFetches.has(key))return photoFetches.get(key).promise;
  const controller=new AbortController(),job={controller};
  job.promise=fetch(photoSource(f),{credentials:'same-origin',signal:controller.signal})
    .then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.blob()})
    .then(blob=>{if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');return photoCachePut(key,blob)})
    .finally(()=>{if(photoFetches.get(key)===job)photoFetches.delete(key)});
  photoFetches.set(key,job);return job.promise;
}
let swipeDirection=1;
function photoPrefetch(serial){
  if(serial!==viewerSerial||previewIndex<0)return;
  clearTimeout(preloadTimer);
  // At most one background SMB transfer. Prefetch two frames in the
  // latest swipe direction, then one behind, without starving the viewer.
  const offsets=swipeDirection>=0?[1,2,-1]:[-1,-2,1];
  // Don't fetch huge neighboring originals or evict the recently viewed photo.
  // Large files remain available on demand; data-saver users skip background transfers.
  if(navigator.connection?.saveData)return;
  const candidates=offsets.map(offset=>gallery[previewIndex+offset])
    .filter(f=>f&&isPhoto(f)&&Number(f.size)>0&&Number(f.size)<=12*1024*1024);
  const prepare=async()=>{
    for(const f of candidates){
      if(serial!==viewerSerial)return;
      const key=photoKey(f);
      if(originalCache.has(key))continue;
      if(originalCacheBytes+Number(f.size)>ORIGINAL_CACHE_LIMIT)continue;
      try{await photoLoad(f)}catch(e){if(e.name==='AbortError')return}
    }
  };
  preloadTimer=setTimeout(()=>{if(serial===viewerSerial)prepare()},180);
}
function photoCacheClear(){
  for(const job of photoFetches.values())job.controller.abort();
  photoFetches.clear();
  for(const entry of originalCache.values())URL.revokeObjectURL(entry.url);
  originalCache.clear();originalCacheBytes=0;
}

function clearOriginal(){if(originalController){originalController.abort();originalController=null}if(originalObjectUrl){URL.revokeObjectURL(originalObjectUrl);originalObjectUrl=null}}
const imageURL=(f,large=false,folder=shownDir,share=shownShare)=>'/api/thumb?'+qs({share,path:[folder,f.name].filter(Boolean).join('/'),v:String(f.modified||0)+'-'+String(f.size||0),large:String(large)});
function previewable(){return items.filter(canPreview)}
function resetZoom(){zoom=1;panX=0;panY=0}
function setZoom(scale,cx=0,cy=0){const img=el('previewBody').querySelector('img');if(!img)return;const prev=zoom;zoom=Math.max(1,Math.min(5,scale));if(zoom===1){panX=panY=0}else if(prev!==zoom){panX+=(cx-panX)*(1-prev/zoom);panY+=(cy-panY)*(1-prev/zoom)}drawZoom()}
function drawZoom(){const img=el('previewBody').querySelector('img');if(!img)return;const bound=el('photoStage').getBoundingClientRect(),w=(img.naturalWidth||bound.width),h=(img.naturalHeight||bound.height),fit=Math.min(bound.width/w,bound.height/h),cw=w*fit,ch=h*fit;panX=Math.max(-Math.max(0,(cw*zoom-bound.width)/2),Math.min(Math.max(0,(cw*zoom-bound.width)/2),panX));panY=Math.max(-Math.max(0,(ch*zoom-bound.height)/2),Math.min(Math.max(0,(ch*zoom-bound.height)/2),panY));img.style.transform='translate('+panX+'px,'+panY+'px) scale('+zoom+')'}
function openPreview(f){el('preview').classList.remove('controlsHidden');if(f.directory)return enterFolder(f.name);filmNodes.clear();if(!canPreview(f))return download(f);shownShare=f.share||selected;shownDir=f.folder!==undefined?f.folder:dir;const photos=isPhoto(f);gallery=photos?(allPhotosMode?allPhotos:view==='gallery'?photoGalleryItems():items.filter(isPhoto)):[f];previewIndex=Math.max(0,gallery.findIndex(x=>x===f||(x.name===f.name&&x.share===f.share&&x.folder===f.folder)));el('preview').style.display='flex';document.body.style.overflow='hidden';showPreview(0)}
function closePreview(){el('previewBody').querySelector('video')?._nasSavePosition?.();el('previewBody').querySelector('video')?.pause();clearTimeout(tapTimer);el('preview').classList.remove('controlsHidden');viewerSerial++;clearOriginal();for(const job of photoFetches.values())job.controller.abort();photoFetches.clear();clearTimeout(preloadTimer);el('previewBody').replaceChildren();el('preview').style.display='none';el('filmstrip').replaceChildren();previewIndex=-1;gallery=[];filmNodes.clear();resetZoom();document.body.style.overflow='';pumpThumbs()}

/* Device-local video playback positions: per SMB user, path and file version.
 * Only small metadata stored in the browser; video data remains on the NAS. */
const VIDEO_PROGRESS_KEY='nasweb-video-positions-v1';
function videoIsTrackable(f){
  return ['mp4','m4v','mov','webm'].includes(ext(f.name));
}
function videoPositionKey(f,share,folder){
  return JSON.stringify([videoUser,share,[folder,f.name].filter(Boolean).join('/'),
    Number(f.size)||0,Number(f.modified)||0]);
}
function videoSavedPositions(){
  try{
    const data=JSON.parse(localStorage.getItem(VIDEO_PROGRESS_KEY)||'{}');
    return data&&typeof data==='object'&&!Array.isArray(data)?data:{};
  }catch{return {}}
}
function videoStoredPosition(key){
  const record=videoSavedPositions()[key];
  if(!record||!Number.isFinite(record.time)||!Number.isFinite(record.updated)||
     Date.now()-record.updated>60*86400000)return 0;
  return record.time;
}
function videoWritePosition(key,time,duration,ended=false){
  if(!key)return;
  const saved=videoSavedPositions();
  if(ended||!Number.isFinite(time)||!Number.isFinite(duration)||
     time<10||time>duration-10)delete saved[key];
  else saved[key]={time:Math.floor(time),updated:Date.now()};
  const records=Object.entries(saved).filter(([,v])=>v&&Date.now()-v.updated<60*86400000)
    .sort((a,b)=>b[1].updated-a[1].updated).slice(0,150);
  try{localStorage.setItem(VIDEO_PROGRESS_KEY,JSON.stringify(Object.fromEntries(records)))}catch{}
}
function videoTime(seconds){
  if(!Number.isFinite(seconds))return '0:00';
  const n=Math.floor(Math.max(0,seconds));
  return (n>=3600?Math.floor(n/3600)+':':'')+
    String(Math.floor(n/60)%60).padStart(n>=3600?2:1,'0')+':'+
    String(n%60).padStart(2,'0');
}
function setupVideoPlayback(video,f){
  const wrap=document.createElement('div');wrap.className='videoPlayback';
  const label=document.createElement('div');label.className='videoPlaybackStatus hidden';
  label.setAttribute('role','status');
  const quick=document.createElement('div');quick.className='videoQuickActions';
  function button(caption,title,run){
    const btn=document.createElement('button');btn.type='button';
    btn.textContent=caption;btn.title=title;btn.setAttribute('aria-label',title);
    btn.onclick=run;quick.append(btn);return btn;
  }
  const seek=seconds=>{
    if(!Number.isFinite(video.duration)||video.duration<=0)return;
    video.currentTime=Math.min(Math.max(0,video.currentTime+seconds),video.duration);
  };
  button('↶ 10','Назад на 10 секунд',()=>seek(-10));
  button('10 ↷','Вперёд на 10 секунд',()=>seek(10));
  button('⛶','Полный экран',()=>{
    if(video.requestFullscreen)video.requestFullscreen().catch(()=>{});
    else if(video.webkitEnterFullscreen)video.webkitEnterFullscreen();
  });
  wrap.append(video,label,quick);
  const key=videoPositionKey(f,shownShare,shownDir);
  let lastPersist=0;
  function save(force=false){
    if(!force&&Date.now()-lastPersist<5000)return;
    if(!Number.isFinite(video.duration)||video.duration<=0)return;
    lastPersist=Date.now();
    videoWritePosition(key,video.currentTime,video.duration,video.ended);
  }
  video._nasSavePosition=()=>save(true);
  video.addEventListener('timeupdate',()=>save());
  video.addEventListener('pause',()=>save(true));
  video.addEventListener('ended',()=>videoWritePosition(key,0,video.duration,true));
  video.addEventListener('loadedmetadata',()=>{
    const previous=videoStoredPosition(key);
    if(previous>=10&&Number.isFinite(video.duration)&&previous<video.duration-10){
      // Seek; leave play/pause to the user's gesture and browser policy.
      try{video.currentTime=previous}catch{return}
      label.replaceChildren();
      const notice=document.createElement('span');
      notice.textContent='Продолжено с '+videoTime(previous);
      const restart=document.createElement('button');restart.type='button';
      restart.textContent='С начала';
      restart.onclick=()=>{
        video.currentTime=0;videoWritePosition(key,0,video.duration,true);
        label.classList.add('hidden');
      };
      label.append(notice,restart);label.classList.remove('hidden');
    }
  });
  if(ext(f.name)!=='mov'){
    video.addEventListener('error',()=>{
      const text='Не удалось воспроизвести видео. Возможно, браузер не поддерживает кодек. Оригинал можно скачать.';
      label.replaceChildren();label.textContent=text;label.classList.remove('hidden');
    });
  }
  return wrap;
}
function showPreview(direction=0){if(previewIndex<0||!gallery.length)return;if(direction)swipeDirection=Math.sign(direction);const serial=++viewerSerial,f=gallery[previewIndex],box=el('previewBody');shownShare=f.share||shownShare;shownDir=f.folder!==undefined?f.folder:shownDir;box.querySelector('video')?._nasSavePosition?.();box.querySelector('video')?.pause();clearOriginal();clearTimeout(preloadTimer);resetZoom();box.replaceChildren();el('viewerSpinner').textContent='Загрузка…';el('previewCounter').textContent=(previewIndex+1)+' / '+gallery.length;el('previewTitle').textContent=f.name;el('viewerSpinner').classList.toggle('hidden',!isPhoto(f));el('photoStage').style.touchAction=isPhoto(f)?'none':'auto';let node;if(isPhoto(f)){node=document.createElement('img');node.alt=f.name;node.draggable=false;node.className='arriving';node.style.setProperty('--slide',direction>0?'30px':direction<0?'-30px':'0px');node.onload=()=>{if(serial!==viewerSerial)return;el('viewerSpinner').classList.add('hidden');drawZoom()};node.onerror=()=>{if(serial===viewerSerial)el('viewerSpinner').textContent='Изображение недоступно'};const photoId=photoKey(f),cachedPhoto=photoCacheGet(photoId);
node.src=cachedPhoto||imageURL(f,false);
for(const [key,job] of photoFetches){if(key!==photoId){job.controller.abort();photoFetches.delete(key)}}
if(cachedPhoto){photoPrefetch(serial)}
else {
  photoLoad(f).then(url=>{
    if(serial!==viewerSerial)return;
    const decoded=new Image();
    decoded.onload=()=>{if(serial!==viewerSerial)return;node.src=url;photoPrefetch(serial)};
    decoded.onerror=()=>{if(serial===viewerSerial)el('viewerSpinner').textContent='Невозможно открыть оригинал'};
    decoded.src=url;
  }).catch(err=>{if(serial===viewerSerial&&err.name!=='AbortError')el('viewerSpinner').textContent='Оригинал недоступен'});
}
}else if(ext(f.name)==='pdf'){node=document.createElement('iframe');node.title=f.name;node.src=fileUrl(f.name,true)}else{
const audio=['mp3','ogg'].includes(ext(f.name));
node=document.createElement(audio?'audio':'video');
node.controls=true;node.playsInline=true;node.preload='metadata';
const visual=audio?node:setupVideoPlayback(node,f);
if(ext(f.name)==='mov'){
  let fallbackOffered=false;
  node.addEventListener('error',()=>{
    if(serial!==viewerSerial||fallbackOffered)return;
    fallbackOffered=true;
    const hint=document.createElement('div');hint.className='videoFallback';
    const p=document.createElement('p');
    p.textContent='Браузер не смог воспроизвести MOV. Можно преобразовать его в совместимый MP4 (первый запуск может занять несколько минут).';
    const btn=document.createElement('button');btn.type='button';btn.textContent='Открыть как MP4';
    btn.onclick=()=>{
      btn.disabled=true;p.textContent='Подготавливаем MP4 на Raspberry Pi. Первый запуск может быть долгим…';
      node.addEventListener('error',()=>{p.textContent='Не удалось преобразовать видео. Возможно, файл слишком большой или кодек не поддерживается. Оригинал можно скачать кнопкой сверху.'},{once:true});
      node.addEventListener('loadeddata',()=>hint.remove(),{once:true});
      node.src='/api/mov-mp4?'+qs({share:shownShare,path:[shownDir,f.name].filter(Boolean).join('/'),v:String(f.modified||0)+'-'+String(f.size||0)});
      node.load();node.play().catch(()=>{});btn.remove();
    };
    hint.append(p,btn);box.append(hint);
  },{once:true});
}
box.append(visual);
node.src='/api/video?'+qs({share:shownShare,path:[shownDir,f.name].filter(Boolean).join('/')});
}if(node.tagName==='IFRAME'||node.tagName==='IMG')box.append(node);renderFilmstrip()}
function renderFilmstrip(){const strip=el('filmstrip');if(gallery.length<2){strip.classList.add('hidden');return}strip.classList.remove('hidden');const from=Math.max(0,previewIndex-5),to=Math.min(gallery.length,previewIndex+6),fragment=document.createDocumentFragment();for(let i=from;i<to;i++){const f=gallery[i];let b=filmNodes.get(i);if(!b){b=document.createElement('button');b.type='button';b.setAttribute('aria-label','Фотография '+(i+1)+' из '+gallery.length);if(isPhoto(f)){const img=document.createElement('img');img.loading='lazy';img.alt='';img.src=imageURL(f,false,f.folder!==undefined?f.folder:shownDir,f.share||shownShare);b.append(img)}else{const mark=document.createElement('span');mark.textContent='▣';b.append(mark)}b.onclick=()=>{if(previewIndex!==i){const movement=i>previewIndex?1:-1;previewIndex=i;showPreview(movement)}};filmNodes.set(i,b)}b.classList.toggle('active',i===previewIndex);fragment.append(b)}strip.replaceChildren(fragment);const active=strip.querySelector('button.active');if(active)requestAnimationFrame(()=>active.scrollIntoView({block:'nearest',inline:'center',behavior:'smooth'}))}
function stepPreview(offset){if(zoom>1||!gallery.length)return;const next=previewIndex+offset;if(next<0||next>=gallery.length)return;previewIndex=next;showPreview(offset)}
function isMobileLayout(){return window.matchMedia('(max-width:760px)').matches}
function closeMobileSheet(){
  el('mobileSheetOverlay').classList.add('hidden');
  el('mobileSheetActions').replaceChildren();
  document.body.classList.remove('sheetOpen');
}
function openMobileSheet(title,actions){
  hideMenu();
  el('mobileSheetTitle').textContent=title;
  const container=el('mobileSheetActions');container.replaceChildren();
  for(const action of actions){
    const btn=document.createElement('button');btn.type='button';
    btn.textContent=action.label;
    if(action.danger)btn.classList.add('sheetDanger');
    btn.onclick=()=>{closeMobileSheet();action.run()};
    container.append(btn);
  }
  el('mobileSheetOverlay').classList.remove('hidden');
  document.body.classList.add('sheetOpen');
  el('mobileSheetClose').focus({preventScroll:true});
}
el('mobileSheetClose').onclick=closeMobileSheet;
el('mobileSheetOverlay').addEventListener('click',e=>{if(e.target===el('mobileSheetOverlay'))closeMobileSheet()});
// Desktop navigation stays visible even with the indexing panel collapsed.
const desktopReturnToFiles=()=>{
  leaveGlobalGallery();
  window.scrollTo({top:0,behavior:'instant'});
};
for(const id of ['desktopFilesNav','desktopGalleryBack']){
  el(id).onclick=desktopReturnToFiles;
}
for(const id of ['desktopPhotosNav']){
  el(id).onclick=()=>{enterGlobalGallery();window.scrollTo({top:0,behavior:'instant'})};
}
el('mobileHome').onclick=()=>{closeMobileSheet();leaveGlobalGallery();navigateFiles('',{restore:true})};
el('mobileSearch').onclick=()=>{
 closeMobileSheet();
 const app=el('app'),gallery=allPhotosMode;
 const active=app.classList.toggle(gallery?'gallerySearching':'filesSearching');
 if(active){requestAnimationFrame(()=>{el('search').scrollIntoView({block:'nearest',behavior:'smooth'});el('search').focus()})}
 else{el('search').value='';render()}
};
el('mobileAdd').onclick=()=>openMobileSheet('Добавить',[
  {label:'＋ Создать папку',run:()=>el('folder').click()},
  {label:'↑ Загрузить файлы',run:()=>el('upload').click()}
]);
el('mobilePhotos').onclick=()=>{closeMobileSheet();enterGlobalGallery()};
el('mobileMore').onclick=()=>openMobileSheet('Ещё',[
  {label:'Мой профиль',run:()=>openProfile()},
  {label:'★ Избранное и альбомы',run:()=>openCollections()},
  {label:'Статистика фотографий',run:()=>openNasStats()},
  {label:'Обновить список',run:()=>allPhotosMode?el('globalGalleryRescan').click():refresh()},
  {label:'Выбрать файлы',run:()=>{leaveGlobalGallery();el('selectionModeButton').click()}},
  {label:'Сменить тему',run:()=>el('theme').click()},
  {label:'Выйти из NAS Web',danger:true,run:()=>el('logout').click()}
]);

async function collectionPost(url,data,method='POST'){
 return api(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
}
async function addPhotoToCollection(f){
 try{
  const data=await api('/api/collections');
  const actions=[{label:'★ В избранное',run:async()=>{try{await collectionPost('/api/collections/item',{share:f.share,path:f.path,enabled:true});message('Добавлено в избранное')}catch(e){alert(e.message)}}}];
  for(const album of data.albums)actions.push({label:'В альбом: '+album.name,run:async()=>{try{await collectionPost('/api/collections/item',{share:f.share,path:f.path,album_id:album.id,enabled:true});message('Добавлено в альбом')}catch(e){alert(e.message)}}});
  actions.push({label:'☆ Убрать из избранного',run:async()=>{try{await collectionPost('/api/collections/item',{share:f.share,path:f.path,enabled:false});message('Удалено из избранного')}catch(e){alert(e.message)}}});
  actions.push({label:'＋ Новый альбом',run:async()=>{const name=prompt('Название альбома');if(!name)return;try{const a=await collectionPost('/api/collections/album',{name});await collectionPost('/api/collections/item',{share:f.share,path:f.path,album_id:a.id,enabled:true});message('Альбом создан')}catch(e){alert(e.message)}}});
  openMobileSheet(f.name,actions);
 }catch(e){alert(e.message)}
}
async function openCollections(){
 try{
  const data=await api('/api/collections');
  const actions=[{label:'★ Избранное ('+data.favorites+')',run:()=>openCollectionPhotos(null,true)}];
  for(const a of data.albums){actions.push({label:a.name+' ('+a.count+')',run:()=>openCollectionPhotos(a.id,false)});actions.push({label:'Удалить альбом «'+a.name+'»',run:async()=>{if(!confirm('Удалить альбом? Фотографии останутся на NAS.'))return;try{await api('/api/collections/album/'+a.id,{method:'DELETE'});openCollections()}catch(e){alert(e.message)}}})}
  actions.push({label:'＋ Создать альбом',run:async()=>{const name=prompt('Название альбома');if(!name)return;try{await collectionPost('/api/collections/album',{name});openCollections()}catch(e){alert(e.message)}}});
  openMobileSheet('Альбомы',actions);
 }catch(e){alert(e.message)}
}
async function openCollectionPhotos(albumId,favorites){
 try{
  const result=await api('/api/collections/photos?'+qs({favorites:String(favorites),...(favorites?{}:{album_id:String(albumId)}),limit:'120'}));
  if(!allPhotosMode)await enterGlobalGallery();
  allPhotoSubsetMode=true;allPhotoTimeline=[];allPhotoStartOffset=0;
  allPhotos=result.items;allPhotoTotal=result.items.length;allPhotoNextOffset=allPhotoTotal;
  allPhotoStatus={complete:true,total:allPhotoTotal,pending:0};
  ++allPhotoScanToken;galleryRenderSignature='';renderAllGallery();
  message(favorites?'Избранное':'Фотографии альбома');
 }catch(e){alert(e.message)}
}
// Memories now live above the gallery timeline, like Google Photos Stories.
// Never replace allPhotos: opening a card uses the existing preview/filmstrip
// and returns to exactly the same gallery when the viewer closes.
let galleryMemoryGroups=[],galleryMemoriesGeneration=0,galleryMemoriesRenderedSignature='';
function groupGalleryMemories(photos,today=new Date()){
  const currentYear=today.getFullYear();
  const grouped=new Map();
  for(const photo of photos||[]){
    const raw=String(photo.taken||'');
    const match=/^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    if(!match||!isPhoto(photo))continue;
    const year=Number(match[1]),yearsAgo=currentYear-year;
    if(yearsAgo<1||yearsAgo>100)continue;
    if(!grouped.has(yearsAgo))grouped.set(yearsAgo,[]);
    grouped.get(yearsAgo).push(photo);
  }
  return [...grouped].sort((a,b)=>a[0]-b[0]).map(([yearsAgo,items])=>({
    yearsAgo,items,title:yearsAgo===1?'Год назад':yearsAgo+' '+(
      yearsAgo%10===1&&yearsAgo%100!==11?'год':
      yearsAgo%10>=2&&yearsAgo%10<=4&&!(yearsAgo%100>=12&&yearsAgo%100<=14)?'года':'лет')+' назад'
  }));
}
function renderGalleryMemories(){
  const section=el('galleryMemories'),strip=el('galleryMemoryStories');
  const visible=allPhotosMode&&!allPhotoSubsetMode&&galleryMemoryGroups.length>0;
  section.classList.toggle('hidden',!visible);
  if(!visible){strip.replaceChildren();galleryMemoriesRenderedSignature='';return}
  const signature=galleryMemoryGroups.map(g=>g.yearsAgo+'|'+g.items.length+'|'+
    g.items[0].share+'|'+g.items[0].path+'|'+g.items[0].modified).join(';');
  if(signature===galleryMemoriesRenderedSignature)return;
  const previousScroll=strip.scrollLeft;
  const fragment=document.createDocumentFragment();
  for(const group of galleryMemoryGroups){
    const photo=group.items[0];
    const card=document.createElement('button');
    card.type='button';card.className='memoryStory';
    card.setAttribute('aria-label',group.title+' — '+group.items.length+' фото');
    const cover=document.createElement('img');cover.loading='lazy';cover.alt='';
    cover.src=imageURL(photo,false,photo.folder,photo.share);
    const content=document.createElement('span');content.className='memoryStoryContent';
    const heading=document.createElement('strong');heading.textContent=group.title;
    const note=document.createElement('small');
    note.textContent=group.items.length+' фото · В этот день';
    content.append(heading,note);
    card.append(cover,content);
    card.onclick=()=>openMemoryStory(group.items);
    fragment.append(card);
  }
  strip.replaceChildren(fragment);
  strip.scrollLeft=previousScroll;
  galleryMemoriesRenderedSignature=signature;
}
function openMemoryStory(photos){
  if(!allPhotosMode||!photos?.length)return;
  const f=photos[0];
  el('preview').classList.remove('controlsHidden');
  filmNodes.clear();
  gallery=photos.slice();
  previewIndex=0;
  shownShare=f.share;shownDir=f.folder;
  el('preview').style.display='flex';
  document.body.style.overflow='hidden';
  showPreview(0);
}
async function loadGalleryMemories(){
  const generation=++galleryMemoriesGeneration;
  if(!allPhotosMode||allPhotoSubsetMode)return;
  try{
    const data=await api('/api/gallery/memories');
    if(generation!==galleryMemoriesGeneration||!allPhotosMode||allPhotoSubsetMode)return;
    galleryMemoryGroups=groupGalleryMemories(data.items);
    renderGalleryMemories();
  }catch(err){
    if(generation===galleryMemoriesGeneration&&allPhotosMode){
      console.warn('Gallery memories:',err.message);
      galleryMemoryGroups=[];renderGalleryMemories();
    }
  }
}
async function openNasStats(){
 try{
  const s=await api('/api/gallery/statistics');
  const actions=[
    {label:'Фотографий: '+s.photos.toLocaleString('ru'),run:()=>{}},
    {label:'Размер фотографий: '+size(s.bytes),run:()=>{}},
    {label:'С датой съёмки: '+s.dated.toLocaleString('ru'),run:()=>{}},
    ...s.by_share.map(x=>({label:x.share+': '+x.photos+' фото · '+size(x.bytes),run:()=>{}}))
  ];
  openMobileSheet('Статистика галереи',actions);
 }catch(e){alert(e.message)}
}
const gallerySettingsHomes=new Map();
function gallerySettingsOpen(open){
  const panel=el('gallerySettingsPanel');
  if(!panel)return;
  const holder=el('gallerySettingsContent');
  if(open){
    for(const id of ['globalGallerySummary','galleryControls','galleryYears','status']){
      const node=el(id);
      if(!node)continue;
      if(!gallerySettingsHomes.has(id)){
        const marker=document.createComment('gallery-home-'+id);
        node.parentNode.insertBefore(marker,node);
        gallerySettingsHomes.set(id,marker);
      }
      holder.append(node);
    }
  }else{
    for(const [id,marker] of gallerySettingsHomes){
      if(marker.parentNode)marker.parentNode.insertBefore(el(id),marker);
      marker.remove();
    }
    gallerySettingsHomes.clear();
  }
  panel.classList.toggle('hidden',!open);
}
el('gallerySettingsToggle').onclick=()=>gallerySettingsOpen(el('gallerySettingsPanel').classList.contains('hidden'));
el('gallerySettingsClose').onclick=()=>gallerySettingsOpen(false);
el('gallerySearchToggle').onclick=()=>{
  const active=el('app').classList.toggle('gallerySearching');
  if(active)el('search').focus();else{el('search').value='';renderAllGallery()}
};
function mobileNavigateTo(path){
 if(path===dir)return;
 el('app').classList.remove('filesSearching');
 navigateFiles(path,{restore:true});
}
function mobileSharesMenu(){
 openMobileSheet('Хранилища',shares.map(share=>({
   label:(share===selected?'✓ ':'▱ ')+share,run:()=>{if(share!==selected)choose(share);else mobileNavigateTo('')}
 })));
}
function updateMobileFilesBreadcrumb(){
 const node=el('mobileFilesBreadcrumb');
 if(!node)return;
 node.replaceChildren();
 const back=document.createElement('button');back.type='button';back.className='mobilePathBack';
 back.textContent='←';back.setAttribute('aria-label','На уровень выше');
 back.onclick=()=>{if(dir)mobileNavigateTo(dir.split('/').slice(0,-1).join('/'));else mobileSharesMenu()};
 node.append(back);
 const trail=document.createElement('div');trail.className='mobilePathTrail';
 const root=document.createElement('button');root.type='button';root.textContent=selected||'Хранилища';
 root.onclick=()=>mobileSharesMenu();trail.append(root);
 const parts=dir?dir.split('/'):[];
 parts.forEach((part,i)=>{
   const sep=document.createElement('span');sep.textContent='›';sep.className='mobilePathSeparator';trail.append(sep);
   const button=document.createElement('button');button.type='button';button.textContent=part==='.recycle'?'Корзина':part;
   const target=parts.slice(0,i+1).join('/');
   button.onclick=()=>mobileNavigateTo(target);
   if(i===parts.length-1)button.setAttribute('aria-current','page');
   trail.append(button);
 });
 node.append(trail);
}
el('filesSearchToggle').onclick=()=>{
 const active=el('app').classList.toggle('filesSearching');
 if(active)el('search').focus();else{el('search').value='';render()}
};
el('filesSortToggle').onclick=()=>openMobileSheet('Сортировка',[
 {label:'По имени',run:()=>{el('sort').value='name';render()}},
 {label:'Сначала новые',run:()=>{el('sort').value='new';render()}},
 {label:'По размеру',run:()=>{el('sort').value='size';render()}}
]);
el('filesSettingsToggle').onclick=()=>openMobileSheet('Файлы',[
 {label:'Мой профиль',run:()=>openProfile()},
 {label:'▦ Плитки',run:()=>el('gridView').click()},
 {label:'☰ Список',run:()=>el('listView').click()},
 {label:'☑ Выбрать файлы',run:()=>el('selectionModeButton').click()},
 {label:'＋ Создать папку',run:()=>el('folder').click()},
 {label:'⟳ Обновить',run:()=>refresh()},
 {label:'◐ Сменить тему',run:()=>el('theme').click()},
 {label:'⇥ Выйти',danger:true,run:()=>el('logout').click()}
]);
function updateDesktopWorkspace(){
  const gallery=allPhotosMode;
  for(const id of ['desktopFilesNav']){
    const b=el(id);b.classList.toggle('navSelected',!gallery);b.setAttribute('aria-current',gallery?'false':'page');
  }
  for(const id of ['desktopPhotosNav']){
    const b=el(id);b.classList.toggle('navSelected',gallery);b.setAttribute('aria-current',gallery?'page':'false');
  }

}
function updateMobileNav(){
  const photos=el('mobilePhotos');
  photos.classList.toggle('navSelected',allPhotosMode);
  el('mobileHome').classList.toggle('navSelected',!allPhotosMode);
  updateDesktopWorkspace();
}
function hideMenu(){el('fileMenu').classList.add('hidden');el('fileMenu').replaceChildren()}
function menuButton(text,fn,danger=false){const btn=document.createElement('button');btn.textContent=text;if(danger)btn.classList.add('danger');btn.onclick=()=>{hideMenu();fn()};return btn}
function openMenu(f,button){
const inTrash=dir==='.recycle'||dir.startsWith('.recycle/');
if(isMobileLayout()){
  const actions=[];
  if(f.directory)actions.push({label:'▱ Открыть папку',run:()=>enterFolder(f.name)});
  else{if(canPreview(f))actions.push({label:'▣ Просмотреть',run:()=>openPreview(f)});actions.push({label:'↓ Скачать',run:()=>download(f)})}
  if(inTrash)actions.push({label:'↶ Восстановить',run:()=>restoreItem(f)});
  actions.push({label:'✎ Переименовать',run:()=>renameItem(f)});
  actions.push({label:'□ Выделить',run:()=>toggleSelected(f.name)});
  actions.push({label:'× '+(isTrashItemPath(fpath(f.name))?'Удалить навсегда':'В корзину'),danger:true,run:()=>deleteItem(f)});
  openMobileSheet(f.name,actions);return;
}
const menu=el('fileMenu');menu.replaceChildren();
if(f.directory)menu.append(menuButton('Открыть',()=>enterFolder(f.name)));
else{if(canPreview(f))menu.append(menuButton('Просмотреть',()=>openPreview(f)));menu.append(menuButton('Скачать',()=>download(f)))}
if(inTrash)menu.append(menuButton('↶ Восстановить',()=>restoreItem(f)));
menu.append(menuButton('Переименовать',()=>renameItem(f)));
menu.append(menuButton(isTrashItemPath(fpath(f.name))?'Удалить навсегда':'В корзину',()=>deleteItem(f),true));
menu.classList.remove('hidden');const rect=button.getBoundingClientRect(),mw=210,mh=220;menu.style.left=Math.max(8,Math.min(rect.left,innerWidth-mw-8))+'px';menu.style.top=(rect.bottom+mh>innerHeight?Math.max(8,rect.top-mh):rect.bottom+5)+'px'}
function sortedFiltered(){let a=items.filter(f=>f.name.toLocaleLowerCase().includes(el('search').value.trim().toLocaleLowerCase()));const sort=el('sort').value;a.sort((x,y)=>Number(y.directory)-Number(x.directory)||(sort==='new'?Number(y.modified||0)-Number(x.modified||0):sort==='size'?Number(y.size)-Number(x.size):x.name.localeCompare(y.name,'ru')));return a}
// Limit simultaneous thumbnail requests so phones don't saturate the NAS.
const thumbQueue=[];let activeThumbs=0;const THUMB_CONCURRENCY=3;
const THUMB_NEARBY_PX=350;
const thumbInflight=new Map();
function stopDetachedThumbnail(img){
  photoObserver.unobserve(img);
  const cancel=thumbInflight.get(img);
  if(cancel){cancel();img.removeAttribute('src')}
}
function pumpThumbs(){
  if(previewIndex>=0||activeThumbs>=THUMB_CONCURRENCY||!thumbQueue.length)return;
  // The user may have scrolled far away while previous thumbnails were loading.
  // Measure each pending tile only once, and never transfer offscreen leftovers.
  const pending=thumbQueue.splice(0),nearby=[];
  for(const img of pending){
    if(!img.isConnected||!img.dataset.src)continue;
    const rect=img.getBoundingClientRect();
    if(!rect.width||!rect.height||rect.top>innerHeight+THUMB_NEARBY_PX||rect.bottom< -THUMB_NEARBY_PX){
      photoObserver.observe(img);
      continue;
    }
    nearby.push({img,priority:rect.bottom>0&&rect.top<innerHeight?0:1,distance:Math.abs(rect.top)});
  }
  nearby.sort((a,b)=>a.priority-b.priority||a.distance-b.distance);
  for(const {img} of nearby){
    if(activeThumbs>=THUMB_CONCURRENCY){thumbQueue.push(img);continue}
    activeThumbs++;
    let completed=false;
    const done=()=>{
      if(completed)return;
      completed=true;thumbInflight.delete(img);
      activeThumbs=Math.max(0,activeThumbs-1);
      pumpThumbs();
    };
    thumbInflight.set(img,done);
    img.addEventListener('load',done,{once:true});
    img.addEventListener('error',done,{once:true});
    img.src=img.dataset.src;
    delete img.dataset.src;
  }
}
const photoObserver=new IntersectionObserver(records=>{
  for(const record of records){
    if(record.isIntersecting){
      const img=record.target;
      photoObserver.unobserve(img);
      if(img.dataset.src){thumbQueue.push(img)}
    }
  }
  pumpThumbs();
},{root:null,rootMargin:'350px 0px',threshold:0});

/* Keep only visible gallery rows in the DOM; the full timeline remains in SQLite. */
let galleryVirtual={signature:'',rows:[],offsets:[0],cols:0,gap:0,width:0,from:-1,to:-1,anchor:-1,frame:0};
function resetGalleryVirtual(){
  if(galleryVirtual.frame)cancelAnimationFrame(galleryVirtual.frame);
  galleryVirtual={signature:'',rows:[],offsets:[0],cols:0,gap:0,width:0,from:-1,to:-1,anchor:-1,frame:0};
}
function galleryVirtualMetrics(grid){
  const css=getComputedStyle(grid);
  const tracks=css.gridTemplateColumns.trim().split(/\s+/).filter(Boolean);
  const cols=Math.max(1,tracks.length||galleryColumns);
  const width=grid.getBoundingClientRect().width;
  const gap=parseFloat(css.rowGap)||0;
  const columnGap=parseFloat(css.columnGap)||0;
  return {cols,width,gap,columnGap,tileSize:Math.max(32,(width-columnGap*(cols-1))/cols)};
}
function galleryVirtualLayout(photos,cols,tileSize,gap,compact){
  const rows=[],offsets=[0];
  let day='',group=[],headerAt=0;
  function add(row){rows.push(row);offsets.push(offsets[offsets.length-1]+row.height+gap)}
  function flush(){
    for(let i=0;i<group.length;i+=cols)
      add({kind:'photos',photos:group.slice(i,i+cols),height:tileSize,headerAt});
    group=[];
  }
  for(const f of photos){
    const label=photoDay(f);
    if(label!==day){
      flush();day=label;headerAt=rows.length;
      add({kind:'header',label,year:photoYear(f),
        month:String(photoDate(f).getMonth()+1).padStart(2,'0'),
        height:compact?40:44,headerAt});
    }
    group.push(f);
  }
  flush();
  return {rows,offsets};
}
function galleryVirtualWindow(rows,offsets,top,height,scroll,overscan=850){
  if(!rows.length)return {from:0,to:0,anchor:0};
  const first=Math.max(0,scroll-top-overscan);
  const last=Math.max(0,scroll-top+height+overscan);
  // Binary search: first row whose bottom crosses the viewport boundary.
  let lo=0,hi=rows.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(offsets[mid]+rows[mid].height<first)lo=mid+1;else hi=mid}
  const from=Math.min(rows.length-1,Math.floor(lo/8)*8);
  lo=from;hi=rows.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(offsets[mid]<=last)lo=mid+1;else hi=mid}
  const to=Math.min(rows.length,Math.max(from+1,Math.ceil(lo/8)*8));
  return {from,to,anchor:rows[from].headerAt};
}
function galleryVirtualScrollTo(year,month=''){
  const v=galleryVirtual;
  const index=v.rows.findIndex(row=>row.kind==='header'&&row.year===year&&(!month||row.month===month));
  if(index<0)return false;
  const grid=el('entries'),top=grid.getBoundingClientRect().top+window.scrollY+v.offsets[index];
  window.scrollTo({top:Math.max(0,top-8),behavior:'smooth'});
  return true;
}
function renderGalleryVirtualWindow(force=false){
  if(!allPhotosMode||!galleryVirtual.rows.length)return;
  const grid=el('entries'),v=galleryVirtual;
  const top=grid.getBoundingClientRect().top+window.scrollY;
  const range=galleryVirtualWindow(v.rows,v.offsets,top,innerHeight,window.scrollY);
  if(!force&&v.from===range.from&&v.to===range.to&&v.anchor===range.anchor)return;
  v.from=range.from;v.to=range.to;v.anchor=range.anchor;
  const previous=[...grid.querySelectorAll('.galleryPhoto img')];
  const reused=new Set();
  const oldTiles=new Map([...grid.querySelectorAll('.galleryPhoto[data-photo-id]')].map(tile=>[tile.dataset.photoId,tile]));
  const fragment=document.createDocumentFragment();
  let cursor=0;
  const appendGap=(start,end)=>{
    if(end<=start)return;
    const spacer=document.createElement('div');spacer.className='galleryVirtualSpacer';
    spacer.style.height=Math.max(0,v.offsets[end]-v.offsets[start]-v.gap)+'px';
    spacer.setAttribute('aria-hidden','true');fragment.append(spacer);
  };
  const displayIndices=[];
  if(range.anchor<range.from)displayIndices.push(range.anchor);
  for(let i=range.from;i<range.to;i++)displayIndices.push(i);
  for(const index of displayIndices){
    appendGap(cursor,index);
    const row=v.rows[index];
    if(row.kind==='header'){
      const heading=document.createElement('h3');heading.className='galleryMonth galleryVirtualHeader';
      heading.textContent=row.label;heading.dataset.year=row.year;heading.dataset.month=row.month;
      fragment.append(heading);
    }else{
      const line=document.createElement('div');line.className='galleryVirtualRow';
      line.style.setProperty('--virtual-cols',String(v.cols));
      line.style.setProperty('--virtual-gap',v.columnGap+'px');
      for(const f of row.photos){
        const tile=document.createElement('article');tile.className='item galleryPhoto';tile.tabIndex=0;tile.role='button';
        tile.title=f.share+' / '+f.path;tile.dataset.photoId=galleryId(f);
        tile.setAttribute('aria-label','Открыть '+f.name+' — '+f.share+'/'+f.folder);
        tile.onclick=()=>{if(tile.dataset.longPress){delete tile.dataset.longPress;return}if(galleryPickMode)toggleGalleryPick(f);else openPreview(f)};
        let hold=null,sx=0,sy=0;
        tile.addEventListener('touchstart',e=>{if(e.touches.length!==1)return;sx=e.touches[0].clientX;sy=e.touches[0].clientY;hold=setTimeout(()=>{tile.dataset.longPress='1';navigator.vibrate?.(15);openMobileSheet(f.name,[{label:'Выбрать',run:()=>toggleGalleryPick(f)},{label:'Открыть фото',run:()=>openPreview(f)},{label:'★ В избранное / альбом',run:()=>addPhotoToCollection(f)},{label:'Открыть папку',run:()=>{leaveGlobalGallery();selected=f.share;dir=f.folder;renderShares();refresh()}},{label:'Сведения',run:()=>showPhotoDetails(f)},{label:'Скачать',run:()=>{const a=document.createElement('a');a.href='/api/file?'+qs({share:f.share,path:f.path});a.download=f.name;a.click()}}])},550)},{passive:true});
        tile.addEventListener('touchmove',e=>{if(e.touches.length&&Math.hypot(e.touches[0].clientX-sx,e.touches[0].clientY-sy)>12)clearTimeout(hold)},{passive:true});
        tile.addEventListener('touchend',()=>clearTimeout(hold));tile.addEventListener('touchcancel',()=>clearTimeout(hold));
        tile.onkeydown=e=>{if(e.target===tile&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openPreview(f)}};
        const thumb=document.createElement('div');thumb.className='thumb';
        const requestedSrc=imageURL(f,false,f.folder,f.share);
        const oldTile=oldTiles.get(galleryId(f));
        const previousImg=oldTile?.dataset.thumbSrc===requestedSrc?oldTile.querySelector('.thumb img'):null;
        const img=previousImg||document.createElement('img');
        if(previousImg)reused.add(img);
        else{img.loading='lazy';img.decoding='async';img.alt='';img.onload=()=>img.classList.add('photoLoaded');img.dataset.src=requestedSrc}
        img.onerror=()=>{img.remove();thumb.replaceChildren(icon('image'))};
        tile.dataset.thumbSrc=requestedSrc;thumb.append(img);tile.append(thumb);line.append(tile);
      }
      fragment.append(line);
    }
    cursor=index+1;
  }
  appendGap(cursor,v.rows.length);
  thumbQueue.length=0;
  photoObserver.takeRecords();
  grid.replaceChildren(fragment);
  for(const img of previous)if(!reused.has(img))stopDetachedThumbnail(img);
  for(const img of grid.querySelectorAll('.galleryPhoto img[data-src]')){photoObserver.unobserve(img);photoObserver.observe(img)}
  updateGalleryPick();pumpThumbs();
}
function scheduleGalleryVirtualScroll(){
  if(!allPhotosMode||galleryVirtual.frame||!galleryVirtual.rows.length)return;
  galleryVirtual.frame=requestAnimationFrame(()=>{galleryVirtual.frame=0;renderGalleryVirtualWindow()});
}
window.addEventListener('scroll',scheduleGalleryVirtualScroll,{passive:true});
const galleryVirtualResize=new ResizeObserver(()=>{
  if(!allPhotosMode||!galleryVirtual.rows.length)return;
  const grid=el('entries'),metrics=galleryVirtualMetrics(grid);
  if(Math.abs(metrics.width-galleryVirtual.width)>1||metrics.cols!==galleryVirtual.cols){
    resetGalleryVirtual();galleryRenderSignature='';renderAllGallery();
  }
});
galleryVirtualResize.observe(el('entries'));


// Poll lightweight gallery metadata while it is open. Completed indexes only
// relist SMB folders periodically; no thumbnails or EXIF are scanned again.
let galleryWatchTimer=null,galleryWatchBusy=false,galleryWatchEpoch=0;
let gallerySeenRevision=null,galleryPendingRevision=null;
const GALLERY_WATCH_INTERVAL=45000;
function stopGalleryWatch(){
  ++galleryWatchEpoch;
  if(galleryWatchTimer!==null)clearInterval(galleryWatchTimer);
  galleryWatchTimer=null;galleryWatchBusy=false;
  gallerySeenRevision=null;galleryPendingRevision=null;
}
function galleryCanRefreshInPlace(){
  return allPhotosMode&&!allPhotoSubsetMode&&previewIndex<0&&
    window.scrollY<200&&!allPhotoPageBusy;
}
async function applyGalleryChange(){
  if(galleryPendingRevision===null||!galleryCanRefreshInPlace())return;
  const requested=galleryPendingRevision;
  galleryPendingRevision=null;
  await loadGlobalPage(true);
  if(!allPhotosMode)return;
  loadGalleryMemories();
  if(gallerySeenRevision!==null&&gallerySeenRevision>=requested){
    loadGlobalTimeline(allPhotoScanToken);
  }else{
    galleryPendingRevision=requested;
  }
}
async function watchGalleryChanges(){
  if(!allPhotosMode||document.hidden||galleryWatchBusy)return;
  galleryWatchBusy=true;
  const epoch=galleryWatchEpoch;
  try{
    const status=await api('/api/gallery/scan',{method:'POST'});
    if(!allPhotosMode||epoch!==galleryWatchEpoch)return;
    allPhotoStatus=status;allPhotoTotal=status.total;
    const revision=Number(status.revision);
    if(Number.isFinite(revision)){
      if(gallerySeenRevision===null)gallerySeenRevision=revision;
      else if(revision!==gallerySeenRevision)galleryPendingRevision=revision;
    }
    if(galleryPendingRevision!==null)await applyGalleryChange();
    else renderGlobalProgress();
  }catch(err){
    if(allPhotosMode&&epoch===galleryWatchEpoch)
      console.warn('Gallery background sync:',err.message);
  }finally{
    if(epoch===galleryWatchEpoch)galleryWatchBusy=false;
  }
}
function startGalleryWatch(){
  stopGalleryWatch();
  galleryWatchTimer=setInterval(watchGalleryChanges,GALLERY_WATCH_INTERVAL);
}
window.addEventListener('scroll',()=>{
  if(galleryPendingRevision!==null&&galleryCanRefreshInPlace())applyGalleryChange();
},{passive:true});
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&allPhotosMode)watchGalleryChanges();
});

let galleryRenderSignature='';
function leaveGlobalGallery(){
  ++galleryMemoriesGeneration;
  galleryMemoryGroups=[];renderGalleryMemories();
  stopGalleryWatch();
  galleryRenderSignature='';resetGalleryVirtual();clearGalleryPick();
  if(!allPhotosMode)return;
  if(previewIndex>=0)closePreview();
  gallerySettingsOpen(false);el('app').classList.remove('gallerySearching');
  allPhotosMode=false;allPhotoScanToken++;allPhotoSubsetMode=false;allPhotoTimeline=[];view=previousFileView;
  el('app').classList.remove('globalGalleryOpen');
  el('globalGallerySummary').classList.add('hidden');
  el('galleryPageFooter').classList.add('hidden');
  el('search').value='';el('search').placeholder='Поиск файлов и папок…';
  renderBreadcrumb();render();updateMobileNav();
}

async function loadGlobalTimeline(token=allPhotoScanToken){
  if(!allPhotosMode||allPhotoSubsetMode)return;
  try{
    const result=await api('/api/gallery/months?'+qs({timezone_offset:String(new Date().getTimezoneOffset())}));
    if(token!==allPhotoScanToken||!allPhotosMode||allPhotoSubsetMode)return;
    allPhotoTimeline=result.months||[];
    allPhotoTimelineCheckedAt=Date.now();
    renderGalleryYears(allPhotos);
  }catch(e){
    if(token===allPhotoScanToken)message('Не удалось загрузить список месяцев: '+e.message);
  }
}
async function jumpToGlobalMonth(monthKey){
  if(!allPhotosMode||allPhotoSubsetMode)return;
  const month=allPhotoTimeline.find(item=>item.month===monthKey);
  if(!month)return;
  // Month positions refer to the entire database, not the loaded page.
  const token=++allPhotoScanToken;
  allPhotoStartOffset=month.offset;allPhotoNextOffset=month.offset;
  allPhotos=[];allPhotoTotal=0;allPhotoStatus=null;galleryRenderSignature='';
  resetGalleryVirtual();window.scrollTo({top:0,behavior:'instant'});
  render();
  while(allPhotoPageBusy&&allPhotosMode&&token===allPhotoScanToken){
    await new Promise(resolve=>setTimeout(resolve,80));
  }
  if(!allPhotosMode||token!==allPhotoScanToken)return;
  await loadGlobalPage(true);
  if(!allPhotosMode||token!==allPhotoScanToken)return;
  requestAnimationFrame(()=>{
    if(token!==allPhotoScanToken)return;
    const heading=el('entries').querySelector('.galleryMonth');
    heading?.scrollIntoView({behavior:'smooth',block:'start'});
    el('galleryMonthJump').value=monthKey;
  });
  scanAllPhotos(token);
}
async function loadGlobalPage(reset=false){
  if(allPhotoPageBusy||!allPhotosMode||allPhotoSubsetMode)return;
  const token=allPhotoScanToken;
  allPhotoPageBusy=true;
  try{
    const start=reset?allPhotoStartOffset:allPhotoNextOffset;
    const data=await api('/api/gallery?'+qs({offset:start,limit:90,timezone_offset:String(new Date().getTimezoneOffset())}));
    if(!allPhotosMode||token!==allPhotoScanToken||allPhotoSubsetMode)return;
    allPhotoStatus=data;allPhotoTotal=data.total;
    if(reset&&Number.isFinite(Number(data.revision)))
      gallerySeenRevision=Number(data.revision);
    allPhotoNextOffset=start+data.items.length;
    if(reset)allPhotos=data.items;else{
      const known=new Set(allPhotos.map(f=>f.share+'|'+f.path));
      for(const f of data.items)if(!known.has(f.share+'|'+f.path))allPhotos.push(f);
    }
    render();
  }catch(e){if(token===allPhotoScanToken)message('Ошибка фотогалереи: '+e.message)}
  finally{allPhotoPageBusy=false}
}
async function scanAllPhotos(token){
  let steps=0;
  while(allPhotosMode&&token===allPhotoScanToken){
    if(previewIndex>=0){await new Promise(resolve=>setTimeout(resolve,500));continue}
    try{
      const data=await api('/api/gallery/scan',{method:'POST'});
      if(token!==allPhotoScanToken||!allPhotosMode)return;
      allPhotoStatus=data;allPhotoTotal=data.total;
      steps++;
      // EXIF discovery introduces dates/months that were not previously known.
      // Refresh the full-index month list occasionally, never for each photo.
      if(steps%100===0&&Date.now()-allPhotoTimelineCheckedAt>30000){
        loadGlobalTimeline(token);
      }
      if((!allPhotos.length&&data.total)||
         (!data.complete&&steps%20===0&&allPhotos.length<90)){
        // Only refresh pages while the folder tree is still being discovered.
        // An EXIF-only pass should not recreate image tiles on each poll.
        await loadGlobalPage(true);
      }else renderGlobalProgress();
      if(data.complete&&((data.dates_available??data.dates_pending)===0||data.limited)){
        // The finished index has a stable chronology for pagination.
        await loadGlobalPage(true);
        return;
      }
    }catch(e){if(token===allPhotoScanToken)message('Индексация: '+e.message);return}
    await new Promise(resolve=>setTimeout(resolve,350));
  }
}
function toggleGalleryStatus(){el('globalGallerySummary').classList.toggle('detailsOpen')}
function renderGlobalProgress(){
  if(!allPhotosMode||!allPhotoStatus)return;
  const data=allPhotoStatus;
  el('globalGalleryProgress').textContent=(data.complete?'Найдено '+data.total+' фото':'Поиск: '+data.scanned+' папок · '+data.total+' фото')
    +(data.dates_pending&&data.complete?' · EXIF: к проверке '+(data.dates_available??data.dates_pending)+(data.dates_blocked?' · нет доступа: '+data.dates_blocked:''):'')
    +(data.limited?' · лимит индекса':'');
  el('galleryPageFooter').classList.toggle('hidden',!data.complete||allPhotoSubsetMode||allPhotoNextOffset>=data.total);
}
async function enterGlobalGallery(){
  if(allPhotosMode)return;
  galleryDateGeneration++;clearSelection();
  previousFileView=view==='gallery'?'grid':view;
  gallerySettingsOpen(false);el('app').classList.remove('gallerySearching');
  el('app').classList.remove('filesSearching');
  allPhotosMode=true;view='gallery';allPhotoSubsetMode=false;
  allPhotoStartOffset=0;allPhotoNextOffset=0;allPhotoTimeline=[];allPhotoTimelineCheckedAt=0;
  allPhotos=[];allPhotoTotal=0;allPhotoStatus=null;
  const token=++allPhotoScanToken;
  el('app').classList.add('globalGalleryOpen');
  el('search').value='';el('search').placeholder='Поиск среди загруженных фото…';
  el('crumb').textContent='Все фотографии';
  el('globalGallerySummary').classList.remove('hidden');
  el('globalGallerySummary').classList.remove('detailsOpen');
  updateMobileNav();window.scrollTo({top:0,behavior:'instant'});render();
  loadGalleryMemories();
  startGalleryWatch();
  await loadGlobalPage(true);
  if(allPhotosMode&&token===allPhotoScanToken){
    loadGlobalTimeline(token);
    scanAllPhotos(token);
  }
}
function renderAllGallery(){
  renderGalleryMemories();
  const grid=el('entries');
  const search=el('search').value.trim().toLocaleLowerCase();
  const shown=allPhotos.filter(f=>!search||f.name.toLocaleLowerCase().includes(search)||f.folder.toLocaleLowerCase().includes(search));
  setGalleryColumns(galleryColumns);
  grid.classList.remove('list');grid.classList.add('galleryMode');
  const metrics=galleryVirtualMetrics(grid);
  const signature=shown.map(f=>[f.share,f.path,f.modified,f.size,f.taken||''].join('|')).join('\n')
    +'|'+metrics.cols+'|'+metrics.width+'|'+metrics.gap;
  if(galleryRenderSignature===signature&&galleryVirtual.rows.length){
    renderGlobalProgress();scheduleGalleryVirtualScroll();return;
  }
  galleryRenderSignature=signature;
  const layout=galleryVirtualLayout(shown,metrics.cols,metrics.tileSize,metrics.gap,innerWidth<=700);
  resetGalleryVirtual();
  galleryVirtual={...galleryVirtual,...metrics,...layout,signature};
  if(!layout.rows.length){
    thumbQueue.length=0;photoObserver.takeRecords();
    for(const img of grid.querySelectorAll('.galleryPhoto img'))stopDetachedThumbnail(img);
    grid.replaceChildren();
    if(!allPhotos.length&&!allPhotoStatus){
      for(let i=0;i<12;i++){const sk=document.createElement('div');sk.className='photoSkeleton';grid.append(sk)}
    }
  }else renderGalleryVirtualWindow(true);
  el('galleryYears').classList.remove('hidden');
  el('globalGallerySummary').classList.remove('hidden');
  renderGalleryYears(shown);updateGalleryPick();
  const status=allPhotoStatus;
  el('globalGalleryProgress').textContent=status
    ? (status.complete?'Найдено '+status.total+' фото': 'Поиск фотографий: '+status.scanned+' папок, найдено '+status.total)
      +(status.limited?' · достигнут предел индекса':'')
      +(status.complete&&status.dates_pending?' · EXIF: осталось '+(status.shared_dates_pending??status.dates_pending):'')
    : 'Подготавливаем фототеку…';
  el('galleryPageFooter').classList.toggle('hidden',!status?.complete||allPhotoSubsetMode||allPhotoNextOffset>=allPhotoTotal||!allPhotos.length);
  message(allPhotos.length?'Показано '+shown.length+' из '+allPhotoTotal+' фотографий':'Ищем фотографии во всех доступных папках…');
  pumpThumbs();
}
/* Bounded file browser DOM: only render rows close to the viewport.
 * Photo gallery virtualization remains independent. */
let fileVirtual=null;
const FILE_VIRTUAL_THRESHOLD=160;
function resetFileVirtual(){
  if(fileVirtual?.frame)cancelAnimationFrame(fileVirtual.frame);
  fileVirtual=null;
}
function fileVirtualWindow(total,cols,rowHeight,gap,top,scroll,viewport,overscan=780){
  const rows=Math.ceil(total/cols),step=rowHeight+gap;
  const first=Math.max(0,Math.min(rows-1,Math.floor(Math.max(0,scroll-top-overscan)/step)));
  const last=Math.min(rows,Math.max(first+1,Math.ceil(Math.max(0,scroll-top+viewport+overscan)/step)));
  return {first,last,rows};
}
function fileVirtualMetrics(grid){
  const cs=getComputedStyle(grid);
  const list=grid.classList.contains('list')||window.matchMedia('(max-width:700px)').matches;
  const widths=cs.gridTemplateColumns.trim().split(/\s+/).filter(t=>t&&t!=='none');
  const cols=list?1:Math.max(1,widths.length);
  return {cols,list,gridWidth:grid.getBoundingClientRect().width,
    gap:parseFloat(cs.rowGap)||0,
    columnGap:parseFloat(cs.columnGap)||0};
}
function activateFileVirtual(shown){
  const grid=el('entries'),metrics=fileVirtualMetrics(grid);
  const probe=document.createElement('div');probe.className='fileVirtualRow';
  probe.style.setProperty('--file-virtual-columns',String(metrics.cols));
  probe.style.setProperty('--file-virtual-gap',metrics.columnGap+'px');
  // Probe the first row plus a file to handle height differences between
  // directory tiles and files with a size label.
  for(const f of shown.slice(0,metrics.cols))probe.append(createFileTile(f));
  if(!shown.slice(0,metrics.cols).some(f=>!f.directory)){
    const regular=shown.find(f=>!f.directory);
    if(regular)probe.lastElementChild.replaceWith(createFileTile(regular));
  }
  grid.append(probe);
  const measured=Math.ceil(probe.getBoundingClientRect().height);
  const rowHeight=Math.max(1,measured|| (metrics.list?68:170));
  for(const img of probe.querySelectorAll('img'))stopDetachedThumbnail(img);
  grid.replaceChildren();
  fileVirtual={...metrics,rowHeight,shown,first:-1,last:-1,frame:0};
  renderFileVirtualWindow(true);
}
function renderFileVirtualWindow(force=false){
  const v=fileVirtual;
  if(!v||allPhotosMode||view==='gallery')return;
  const grid=el('entries');
  const top=grid.getBoundingClientRect().top+window.scrollY;
  const range=fileVirtualWindow(v.shown.length,v.cols,v.rowHeight,v.gap,top,window.scrollY,innerHeight);
  if(!force&&v.first===range.first&&v.last===range.last)return;
  v.first=range.first;v.last=range.last;
  const oldTiles=new Map([...grid.querySelectorAll('.item[data-filename]')].map(t=>[t.dataset.filename,t]));
  const reused=new Set(),frag=document.createDocumentFragment();
  const spacer=rows=>{
    if(rows<=0)return;
    const div=document.createElement('div');div.className='fileVirtualSpacer';
    div.style.height=Math.max(0,rows*(v.rowHeight+v.gap)-v.gap)+'px';
    div.setAttribute('aria-hidden','true');frag.append(div);
  };
  spacer(range.first);
  const visible=document.createElement('div');visible.className='fileVirtualRow';
  visible.style.setProperty('--file-virtual-columns',String(v.cols));
  visible.style.setProperty('--file-virtual-gap',v.columnGap+'px');
  // The grid wrapper uses the same gaps as the original file list.
  visible.style.rowGap=v.gap+'px';
  for(const f of v.shown.slice(range.first*v.cols,range.last*v.cols)){
    const old=oldTiles.get(f.name);
    if(old){reused.add(old);visible.append(old)}
    else visible.append(createFileTile(f));
  }
  frag.append(visible);
  spacer(range.rows-range.last);
  const oldImages=[...grid.querySelectorAll('img')];
  thumbQueue.length=0;photoObserver.takeRecords();
  grid.replaceChildren(frag);
  for(const img of oldImages)if(!img.isConnected)stopDetachedThumbnail(img);
  // Requeued images may already have been intersecting before the last DOM
  // window change; observe them again so no visible tile stays blank.
  for(const img of grid.querySelectorAll('img[data-src]')){
    photoObserver.unobserve(img);photoObserver.observe(img);
  }
  updateSelection();
  pumpThumbs();
}
function scheduleFileVirtualScroll(){
  if(!fileVirtual||fileVirtual.frame||allPhotosMode)return;
  const v=fileVirtual;
  v.frame=requestAnimationFrame(()=>{if(fileVirtual!==v)return;v.frame=0;renderFileVirtualWindow()});
}
window.addEventListener('scroll',scheduleFileVirtualScroll,{passive:true});
const fileVirtualResize=new ResizeObserver(()=>{
  if(!fileVirtual||allPhotosMode)return;
  const metrics=fileVirtualMetrics(el('entries'));
  if(Math.abs(metrics.gridWidth-fileVirtual.gridWidth)>1||metrics.cols!==fileVirtual.cols||
     Math.abs(metrics.gap-fileVirtual.gap)>0.5){
    render();
  }
});
fileVirtualResize.observe(el('entries'));
function createFileTile(f){
const tile=document.createElement('article');tile.className='item';if(view==='gallery')tile.classList.add('galleryPhoto');tile.tabIndex=0;tile.role='button';tile.title=f.name;tile.dataset.filename=f.name;
if(f.directory)tile.classList.add('folderTile');else tile.classList.add('fileTile');if(f.directory&&f.name==='.recycle'&&dir==='')tile.classList.add('recycleTile');
tile.onclick=event=>{if(event.ctrlKey||event.metaKey){toggleSelected(f.name);return}selectionMode?toggleSelected(f.name):openPreview(f)};
tile.onkeydown=e=>{if(e.target===tile&&(e.key==='Enter'||e.key===' ')){e.preventDefault();selectionMode?toggleSelected(f.name):openPreview(f)}};
let pressTimer=null,longPressed=false,startX=0,startY=0;
tile.addEventListener('touchstart',e=>{if(e.touches.length!==1)return;longPressed=false;startX=e.touches[0].clientX;startY=e.touches[0].clientY;pressTimer=setTimeout(()=>{longPressed=true;openMenu(f,tile);navigator.vibrate?.(15)},520)},{passive:true});
tile.addEventListener('touchmove',e=>{if(e.touches.length&&Math.hypot(e.touches[0].clientX-startX,e.touches[0].clientY-startY)>12)clearTimeout(pressTimer)},{passive:true});
tile.addEventListener('touchend',()=>clearTimeout(pressTimer));tile.addEventListener('touchcancel',()=>clearTimeout(pressTimer));
tile.addEventListener('contextmenu',e=>{if(e.target.closest('.more'))return;e.preventDefault();openMenu(f,tile)});
tile.addEventListener('click',e=>{if(longPressed){e.stopImmediatePropagation();longPressed=false}},true);
const check=document.createElement('button');check.type='button';check.className='selectionCheck';check.title='Выделить '+f.name;check.setAttribute('aria-label','Выделить '+f.name);check.onclick=e=>{e.stopPropagation();toggleSelected(f.name)};tile.append(check);const thumb=document.createElement('div');thumb.className='thumb';thumb.title=f.directory?'Открыть папку':'Просмотреть файл';if(f.directory)thumb.append(icon(f.name==='.recycle'&&dir===''?'trash':'folder'));else if(imageExt.includes(ext(f.name))){const img=document.createElement('img');img.loading='lazy';img.decoding='async';img.alt='';img.onload=()=>img.classList.add('photoLoaded');img.dataset.src=imageURL(f,false,dir,selected);photoObserver.observe(img);img.onerror=()=>{img.remove();thumb.replaceChildren(icon('image'))};thumb.append(img)}else if(videoIsTrackable(f)){
  const img=document.createElement('img');img.loading='lazy';img.decoding='async';
  img.className='videoPoster';img.alt='';
  img.dataset.src='/api/video-poster?'+qs({
    share:selected,path:fpath(f.name),
    v:String(f.modified||0)+'-'+String(f.size||0)
  });
  img.onload=()=>img.classList.add('photoLoaded');
  img.onerror=()=>{photoObserver.unobserve(img);img.remove();thumb.replaceChildren(icon('video'))};
  photoObserver.observe(img);thumb.append(img);
  const play=document.createElement('span');play.className='videoPosterPlay';
  play.textContent='▶';play.setAttribute('aria-hidden','true');thumb.append(play);
}else thumb.append(icon(fileKind(f)));tile.append(thumb);const details=document.createElement('div');details.className='details';const title=document.createElement('div');title.className='filename';title.textContent=f.name==='.recycle'?'Корзина':f.name;title.title=f.name;details.append(title);const meta=document.createElement('div');meta.className='filemeta';meta.textContent=f.directory?'':size(f.size);if(!f.directory)details.append(meta);if(view!=='gallery')tile.append(details);const more=document.createElement('button');more.className='more';more.textContent='⋯';more.title='Действия с файлом';more.setAttribute('aria-label','Действия: '+f.name);more.onclick=event=>{event.stopPropagation();openMenu(f,more)};more.onkeydown=event=>event.stopPropagation();tile.append(more);attachFileDrag(tile,f);
return tile;
}
function render(){
  updateDesktopWorkspace();updateMobileFilesBreadcrumb();
  if(allPhotosMode){resetFileVirtual();renderAllGallery();return}
  thumbQueue.length=0;photoObserver.takeRecords();
  const grid=el('entries');
  for(const img of grid.querySelectorAll('img'))stopDetachedThumbnail(img);
  grid.replaceChildren();
  grid.classList.toggle('list',view==='list');
  grid.classList.toggle('galleryMode',view==='gallery');
  el('gridView').classList.toggle('active',view==='grid');
  el('listView').classList.toggle('active',view==='list');
  el('galleryView').classList.toggle('active',view==='gallery');
  const shown=view==='gallery'?photoGalleryItems():sortedFiltered();
  renderGalleryYears(shown);
  if(view!=='gallery'&&shown.length>160){
    activateFileVirtual(shown);
  }else{
    resetFileVirtual();
    let previousMonth=null;
    const fragment=document.createDocumentFragment();
    for(const f of shown){
      if(view==='gallery'){
        const month=photoDay(f);
        if(month!==previousMonth){
          const heading=document.createElement('h3');heading.className='galleryMonth';
          heading.textContent=month;heading.dataset.year=photoYear(f);
          fragment.append(heading);previousMonth=month;
        }
      }
      fragment.append(createFileTile(f));
    }
    grid.append(fragment);
    updateSelection();
  }
  if(!shown.length)message(view==='gallery'?'В этой папке нет фотографий. Переключитесь на плитки, чтобы увидеть файлы и папки.':el('search').value?'Ничего не найдено':'Папка пуста');
  else message(shown.length+(view==='gallery'?' фотографий':' элементов'));
}
const folderListCache=new Map();
const FOLDER_CACHE_TTL=15000;
const FOLDER_CACHE_LIMIT=12;
let folderFetchGeneration=0;
function cachedFolderList(share,path){
  const key=folderScrollKey(share,path),record=folderListCache.get(key);
  if(!record||Date.now()-record.at>FOLDER_CACHE_TTL){if(record)folderListCache.delete(key);return null}
  folderListCache.delete(key);folderListCache.set(key,record);
  return record.items;
}
function rememberFolderList(share,path,list){
  const key=folderScrollKey(share,path);
  folderListCache.delete(key);folderListCache.set(key,{items:list,at:Date.now()});
  if(folderListCache.size>FOLDER_CACHE_LIMIT)folderListCache.delete(folderListCache.keys().next().value);
}
async function refresh(){
  galleryDateGeneration++;
  if(!selected)return;
  const request=++folderFetchGeneration;
  selectedFiles.clear();selectionMode=false;updateSelection();hideMenu();
  const share=selected,path=dir;
  renderBreadcrumb();el('up').disabled=!dir;
  const cached=cachedFolderList(share,path);
  if(cached){
    items=cached;render();message('Проверяем содержимое папки…');
  }else{
    resetFileVirtual();el('entries').replaceChildren();message('Загрузка…');
  }
  try{
    // Always revalidate with the authenticated SMB backend. Cached names
    // must never authorize a file or survive an access-denied response.
    const data=await api('/api/list?'+qs({share,path}));
    if(request!==folderFetchGeneration||share!==selected||path!==dir)return;
    items=data.items;rememberFolderList(share,path,items);
    render();
    if(view==='gallery')scanGalleryDates();
  }catch(e){
    if(request!==folderFetchGeneration||share!==selected||path!==dir)return;
    folderListCache.delete(folderScrollKey(share,path));
    items=[];render();message(e.message);
  }
}
async function mutate(action,payload){try{await api('/api/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({share:selected,...payload})});await refresh()}catch(e){alert(e.message)}}
let activeDialog=null;
function askDialog({title,text,initial='',input=false,confirm='Продолжить',danger=false}){
  if(activeDialog){activeDialog(null)}
  return new Promise(resolve=>{
    const overlay=el('dialogOverlay'),field=el('dialogInput'),accept=el('dialogAccept');
    el('dialogTitle').textContent=title;
    el('dialogText').textContent=text;
    field.classList.toggle('hidden',!input);
    field.value=initial;accept.textContent=confirm;
    accept.classList.toggle('dangerConfirm',danger);
    overlay.classList.remove('hidden');
    const finish=value=>{overlay.classList.add('hidden');el('actionDialog').onsubmit=null;el('dialogCancel').onclick=null;activeDialog=null;resolve(value)};
    activeDialog=finish;
    el('dialogCancel').onclick=()=>finish(null);
    el('actionDialog').onsubmit=e=>{e.preventDefault();const value=input?field.value.trim():true;if(input&&!value)return;finish(value)};
    requestAnimationFrame(()=>{if(input){field.focus();field.select()}else accept.focus()});
  });
}
async function renameItem(f){const name=await askDialog({title:'Переименовать',text:'Введите новое имя файла или папки.',initial:f.name,input:true,confirm:'Сохранить'});if(name&&name!==f.name)await mutate('rename',{path:fpath(f.name),name})}
const isTrashItemPath=path=>path.startsWith('.recycle/')&&path.length>'.recycle/'.length;
async function restoreItem(f){
  if(dir!=='.recycle'&&!dir.startsWith('.recycle/'))return;
  try{
    const data=await api('/api/trash/restore',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({share:selected,path:fpath(f.name)})
    });
    await refresh();
    message('Восстановлено: '+data.restored_to);
  }catch(e){alert(e.message)}
}
async function deleteItem(f){
  const path=fpath(f.name),insideTrash=isTrashItemPath(path);
  if(insideTrash){
    const approved=await askDialog({
      title:'Удалить '+(f.directory?'папку':'файл')+' навсегда?',
      text:'«'+f.name+'» '+(f.directory?'и всё содержимое будут удалены навсегда.':'будет удалён навсегда.'),
      confirm:'Удалить',danger:true
    });
    if(approved)await mutate('trash/permanent-delete',{path,directory:!!f.directory});
  }else{
    const approved=await askDialog({
      title:'Переместить '+(f.directory?'папку':'файл')+' в корзину?',
      text:'«'+f.name+'» '+(f.directory?'будет перемещена в корзину вместе со всем содержимым.':'будет перемещён в корзину.')+
        ' Восстановить можно в течение 14 дней.',
      confirm:'В корзину',danger:true
    });
    if(approved)await mutate('delete',{path,directory:!!f.directory});
  }
}
function chooseUploadDestination(files){
  return new Promise(resolve=>{
    let share=shares.includes(selected)?selected:shares[0],folder=dir||'';
    const overlay=document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:16px';
    const panel=document.createElement('div');
    panel.style.cssText='width:min(480px,100%);max-height:85vh;overflow:auto;background:var(--panel,#20242c);color:var(--text,#fff);border:1px solid var(--border,#555);border-radius:18px;padding:20px;display:grid;gap:12px;box-shadow:0 20px 70px #0008';
    const heading=document.createElement('strong');heading.textContent='Куда загрузить '+files.length+' файл(ов)?';
    const select=document.createElement('select');select.style.cssText='width:100%;padding:12px;border-radius:10px;background:var(--panel2,#303642);color:inherit';
    for(const name of shares){const option=document.createElement('option');option.value=name;option.textContent=name;select.append(option)}
    select.value=share;
    const location=document.createElement('div');location.style.cssText='font-size:13px;overflow-wrap:anywhere;opacity:.85';
    const listing=document.createElement('div');listing.style.cssText='display:grid;gap:5px;max-height:38vh;overflow:auto';
    const status=document.createElement('small');
    const actions=document.createElement('div');actions.style.cssText='display:flex;gap:10px;justify-content:flex-end';
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Отмена';
    const confirm=document.createElement('button');confirm.type='button';confirm.textContent='Загрузить сюда';confirm.className='primary';
    const close=value=>{overlay.remove();resolve(value)};
    cancel.onclick=()=>close(null);
    confirm.onclick=()=>close({share,path:folder});
    overlay.onclick=e=>{if(e.target===overlay)close(null)};
    const addFolder=(name,path)=>{
      const btn=document.createElement('button');btn.type='button';btn.textContent='📁 '+name;
      btn.style.cssText='text-align:left;padding:10px;border-radius:9px;overflow-wrap:anywhere';
      btn.onclick=()=>{folder=path;load()};listing.append(btn);
    };
    let generation=0;
    async function load(){
      const current=++generation;
      location.textContent='Папка назначения: '+share+'/'+folder;
      listing.replaceChildren();status.textContent='Загрузка папок…';confirm.disabled=true;
      if(folder)addFolder('.. На уровень выше',folder.split('/').slice(0,-1).join('/'));
      try{
        const data=await api('/api/list?'+qs({share,path:folder}));
        if(current!==generation)return;
        for(const item of data.items||[]){
          if(item.directory&&item.name!=='.'&&item.name!=='..'&& !item.name.includes('/')&&!item.name.includes('\\')){
            addFolder(item.name,[folder,item.name].filter(Boolean).join('/'));
          }
        }
        status.textContent='Выберите папку или загрузите файлы сюда';
        confirm.disabled=false;
      }catch(err){if(current===generation)status.textContent='Нет доступа к папке: '+err.message}
    }
    select.onchange=()=>{share=select.value;folder='';load()};
    actions.append(cancel,confirm);panel.append(heading,select,location,listing,status,actions);overlay.append(panel);document.body.append(overlay);
    load();
  });
}
const uploadQueue=[];
let uploadBatchBusy=false,uploadPaintAt=0;
const uploadCanCancel=job=>['queued','preparing','sending'].includes(job.stage);
function uploadEta(seconds){
  if(!Number.isFinite(seconds)||seconds<0)return '…';
  const n=Math.ceil(seconds);
  if(n<60)return n+' с';
  if(n<3600)return Math.floor(n/60)+' мин '+n%60+' с';
  return Math.floor(n/3600)+' ч '+Math.ceil(n%3600/60)+' мин';
}
function uploadTick(job,loaded,total,now){
  if(!(total>0)||!(job.bytes>=0))return;
  const sent=Math.min(job.bytes,Math.round(job.bytes*Math.max(0,Math.min(1,loaded/total))));
  if(!job.sampleAt){job.sampleAt=now;job.sampleBytes=sent}
  else if(now-job.sampleAt>=400){
    const instant=Math.max(0,sent-job.sampleBytes)*1000/(now-job.sampleAt);
    job.speed=job.speed>0?job.speed*.55+instant*.45:instant;
    job.sampleAt=now;job.sampleBytes=sent;
  }
  job.sent=sent;
  job.progress=Math.min(99,Math.floor(100*sent/Math.max(1,job.bytes)));
  job.remaining=job.speed>0?(job.bytes-sent)/job.speed:null;
}
function uploadDescription(job){
  if(job.stage==='queued')return 'Ожидание · '+size(job.bytes);
  if(job.stage==='preparing')return 'Подготовка · '+size(job.bytes);
  if(job.stage==='saving')return 'Отправлено · сохраняем на NAS…';
  if(job.stage==='done')return 'Готово · '+size(job.bytes);
  if(job.stage==='canceled')return 'Отменено';
  if(job.stage==='failed')return 'Ошибка: '+(job.error||'неизвестная');
  const parts=['Передача',job.progress+'%',size(job.sent||0)+' / '+size(job.bytes)];
  if(job.speed>0&&job.sent<job.bytes)parts.push('≈ '+size(job.speed)+'/с','осталось '+uploadEta(job.remaining));
  return parts.join(' · ');
}
function notifyUploadJobs(force=false){
  const now=performance.now();
  if(!force&&now-uploadPaintAt<180)return;
  uploadPaintAt=now;
  el('app').classList.toggle('nasUploadsActive',uploadBatchBusy);
  const active=uploadQueue.filter(uploadCanCancel).length;
  el('uploadCenterButton').textContent=active?'⇧ Загрузки: '+active:'⇧ Центр загрузок';
  document.dispatchEvent(new Event('nas-upload-progress'));
}
function setUploadStage(job,stage,progress=job.progress){
  job.stage=stage;job.progress=progress;notifyUploadJobs(true);
}
function cancelUploadJob(job){
  if(job.stage==='queued'||job.stage==='preparing'){setUploadStage(job,'canceled');return true}
  if(job.stage==='sending'&&job.xhr){job.xhr.abort();return true}
  return false; // When SMB saving starts, an abort cannot guarantee rollback.
}
function showUploadCenter(){
  if(document.querySelector('.nasUploadCenter'))return;
  const overlay=document.createElement('div');overlay.className='transferOverlay nasUploadCenter';
  const panel=document.createElement('div');panel.className='transferPanel';
  const title=document.createElement('h3');title.textContent='Центр загрузок';
  const hint=document.createElement('small');hint.className='nasUploadHint';
  hint.textContent='После отправки файл ещё сохраняется на NAS. На этом этапе отмена недоступна.';
  const list=document.createElement('div');list.className='transferList';
  const controls=document.createElement('div');controls.className='nasUploadActions';
  const cancelAll=document.createElement('button');cancelAll.type='button';cancelAll.textContent='Отменить отправку всех';
  cancelAll.onclick=()=>{for(const job of uploadQueue)cancelUploadJob(job)};
  const close=document.createElement('button');close.type='button';close.textContent='Закрыть';close.onclick=()=>dismiss();
  controls.append(cancelAll,close);
  function paint(){
    const scroll=list.scrollTop;list.replaceChildren();
    for(const job of uploadQueue.slice(-30).reverse()){
      const row=document.createElement('div');row.className='transferRow nasUploadRow';
      const name=document.createElement('strong');name.textContent=job.name;name.title=job.name;
      const label=document.createElement('small');label.textContent=uploadDescription(job);
      const progress=document.createElement('progress');progress.max=100;progress.value=job.progress;
      progress.setAttribute('aria-label','Загрузка '+job.name);
      row.append(name,label,progress);
      if(uploadCanCancel(job)){
        const cancel=document.createElement('button');cancel.type='button';cancel.className='nasUploadCancel';
        cancel.textContent='Отменить';cancel.onclick=()=>cancelUploadJob(job);
        row.append(cancel);
      }
      list.append(row);
    }
    list.scrollTop=scroll;cancelAll.disabled=!uploadQueue.some(uploadCanCancel);
  }
  const dismiss=()=>{document.removeEventListener('nas-upload-progress',paint);overlay.remove()};
  panel.append(title,hint,list,controls);overlay.append(panel);
  overlay.onclick=e=>{if(e.target===overlay)dismiss()};
  document.body.append(overlay);paint();
  document.addEventListener('nas-upload-progress',paint);
}
function uploadOne(file,target,job){
  return new Promise((resolve,reject)=>{
    if(job.stage==='canceled'){reject(new DOMException('Отменено','AbortError'));return}
    const xhr=new XMLHttpRequest(),form=new FormData();
    job.xhr=xhr;
    form.set('share',target.share);form.set('path',target.path);form.set('file',file);
    xhr.open('POST','/api/upload');xhr.withCredentials=true;
    xhr.setRequestHeader('X-CSRF-Token',csrf);
    xhr.upload.onprogress=e=>{
      if(job.stage!=='sending'||!e.lengthComputable)return;
      uploadTick(job,e.loaded,e.total,performance.now());
      el('progressFill').style.width=job.progress+'%';notifyUploadJobs();
    };
    xhr.upload.onload=()=>{
      if(job.stage!=='sending')return;
      job.sent=job.bytes;job.speed=0;job.remaining=null;
      setUploadStage(job,'saving',99);
      el('progressFill').style.width='99%';
    };
    xhr.onload=()=>{
      job.xhr=null;
      if(xhr.status>=200&&xhr.status<300){resolve();return}
      let reason='HTTP '+xhr.status;
      try{reason=JSON.parse(xhr.responseText).detail||reason}catch{}
      reject(Error(String(reason)));
    };
    xhr.onerror=()=>{job.xhr=null;reject(Error('Сетевая ошибка'))};
    xhr.onabort=()=>{
      job.xhr=null;setUploadStage(job,'canceled');
      reject(new DOMException('Отменено','AbortError'));
    };
    setUploadStage(job,'sending',0);xhr.send(form);
  });
}
async function uploadFiles(files){
  if(!shares.length||!files.length)return;
  if(uploadBatchBusy){message('Дождитесь завершения текущей загрузки');showUploadCenter();return}
  uploadBatchBusy=true;
  let target=null,success=0,failed=0;
  try{
    target=await chooseUploadDestination(files);
    if(!target)return;
    const jobs=files.map(file=>({name:file.name,bytes:file.size,stage:'queued',progress:0,
      sent:0,speed:0,remaining:null,sampleAt:0,sampleBytes:0,xhr:null,error:''}));
    uploadQueue.push(...jobs);
    if(uploadQueue.length>100)uploadQueue.splice(0,uploadQueue.length-100);
    const bar=el('uploadProgress');bar.classList.remove('hidden');
    notifyUploadJobs(true);showUploadCenter();
    try{
      for(let i=0;i<files.length;i++){
        const job=jobs[i];
        if(job.stage==='canceled')continue;
        setUploadStage(job,'preparing',0);
        message('Загрузка в '+target.share+'/'+target.path+': '+job.name);
        el('progressFill').style.width='0';
        try{
          await uploadOne(files[i],target,job);
          success++;setUploadStage(job,'done',100);
        }catch(e){
          if(job.stage==='canceled'||e.name==='AbortError')setUploadStage(job,'canceled');
          else{failed++;job.error=e.message;setUploadStage(job,'failed')}
        }
      }
    }finally{bar.classList.add('hidden')}
  }finally{uploadBatchBusy=false;notifyUploadJobs(true)}
  if(!target)return;
  const destination=target.share+'/'+target.path;
  if(allPhotosMode&&success){
    if(galleryCanRefreshInPlace()){
      await loadGlobalPage(true);
      loadGlobalTimeline(allPhotoScanToken);
    }else{
      galleryPendingRevision=(gallerySeenRevision??0)+1;
    }
  }else if(target.share===selected&&target.path===dir&&success)await refresh();
  message('Загружено '+success+' из '+files.length+' в '+destination+
    (failed?' · Ошибок: '+failed+' (см. центр загрузок)':''));
  if(success){
    const open=await askDialog({title:'Загрузка завершена',
      text:'Загружено '+success+' из '+files.length+' в '+destination+'. Открыть папку?',
      confirm:'Открыть папку'});
    if(open){
      leaveGlobalGallery();selected=target.share;dir=target.path;
      el('search').value='';renderShares();await refresh();
    }
  }
}
el('togglePassword').onclick=()=>{const password=el('password'),visible=password.type==='password';password.type=visible?'text':'password';el('togglePassword').textContent=visible?'Скрыть':'Показать';password.focus()};
el('loginForm').onsubmit=async e=>{e.preventDefault();++loginGeneration;el('loginError').textContent='';const submit=el('submitLogin');submit.disabled=true;submit.textContent='Проверяем доступ…';try{const form=new FormData();form.set('username',el('username').value);form.set('password',el('password').value);form.set('remember',el('remember').checked?'true':'false');const user=await api('/api/login',{method:'POST',body:form});el('password').value='';showApp(user)}catch(e){el('loginError').textContent=e.message}finally{submit.disabled=false;submit.innerHTML='Войти в NAS Web <span aria-hidden="true">→</span>'}};
el('logout').onclick=async()=>{try{await api('/api/logout',{method:'POST'})}catch{}showLogin()};
el('up').onclick=()=>{if(dir)navigateFiles(dir.split('/').slice(0,-1).join('/'),{restore:true})};
el('folder').onclick=async()=>{const name=await askDialog({title:'Новая папка',text:'Папка будет создана в текущем расположении.',input:true,confirm:'Создать'});if(name)await mutate('mkdir',{path:dir,name})};
let destinationResolve=null,destinationDir='',destinationBusy=false;
async function showDestinationFolders(){
  const share=el('destinationShare').value,box=el('destinationFolders');
  box.replaceChildren();el('destinationError').textContent='';
  el('destinationPath').textContent=share+' / '+destinationDir;
  try{
    const data=await api('/api/list?'+qs({share,path:destinationDir}));
    if(el('destinationOverlay').classList.contains('hidden')||share!==el('destinationShare').value)return;
    const upper=document.createElement('button');upper.textContent='↑ На уровень выше';upper.disabled=!destinationDir;
    upper.onclick=()=>{destinationDir=destinationDir.split('/').slice(0,-1).join('/');showDestinationFolders()};
    box.append(upper);
    for(const folder of data.items.filter(x=>x.directory).sort((a,b)=>a.name.localeCompare(b.name,'ru'))){
      const btn=document.createElement('button');btn.textContent='▱  '+folder.name;
      btn.onclick=()=>{destinationDir=[destinationDir,folder.name].filter(Boolean).join('/');showDestinationFolders()};
      box.append(btn);
    }
  }catch(e){el('destinationError').textContent=e.message}
}
function chooseDestination(operation){
  return new Promise(resolve=>{
    destinationResolve=resolve;destinationDir='';const overlay=el('destinationOverlay'),pick=el('destinationShare');
    pick.replaceChildren();
    for(const share of shares){const option=document.createElement('option');option.value=share;option.textContent=share;pick.append(option)}
    pick.value=selected;overlay.classList.remove('hidden');
    el('destinationTitle').textContent=operation==='move'?'Переместить в папку':'Копировать в папку';
    el('destinationApply').textContent=operation==='move'?'Переместить сюда':'Копировать сюда';
    showDestinationFolders();
  });
}
function endDestination(value){
  el('destinationOverlay').classList.add('hidden');
  const done=destinationResolve;destinationResolve=null;if(done)done(value);
}
el('destinationShare').onchange=()=>{destinationDir='';showDestinationFolders()};
el('destinationCancel').onclick=()=>endDestination(null);
el('destinationApply').onclick=()=>endDestination({share:el('destinationShare').value,path:destinationDir});
async function bulkTransfer(operation){
  const targets=items.filter(f=>selectedFiles.has(f.name));if(!targets.length)return;
  const destination=await chooseDestination(operation);if(!destination)return;
  let done=0,failed=0,lastError='';
  for(const f of targets){
    try{await api('/api/transfer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({share:selected,path:fpath(f.name),target_share:destination.share,target_dir:destination.path,operation})});done++}
    catch(e){failed++;lastError=e.message}
  }
  clearSelection();await refresh();
  message((operation==='move'?'Перемещено: ':'Скопировано: ')+done+(failed?'. Ошибок: '+failed+'. '+lastError:''));
}

/* Desktop file manager: in-app clipboard and same-share drag-to-move.
 * Uses the existing /api/transfer ACL checks; never uses the system clipboard. */
let fileClipboard=null,draggedFiles=null,fileTransferBusy=false;
function resetFileManagerState(){
  fileClipboard=null;draggedFiles=null;fileTransferBusy=false;
  folderScrollPositions.clear();folderListCache.clear();folderFetchGeneration++;
  resetFileVirtual();
}
function chosenFileEntries(){
  const chosen=items.filter(f=>selectedFiles.has(f.name));
  if(chosen.length)return chosen;
  const focused=document.activeElement?.closest?.('.item[data-filename]');
  if(!focused||!el('entries').contains(focused))return [];
  const match=items.find(f=>f.name===focused.dataset.filename);
  return match?[match]:[];
}
function filePathWithinTrash(path){return path==='.recycle'||path.startsWith('.recycle/')}
function fileDropAllowed(source,target){
  if(!source||!target||source.share!==target.share||!source.files?.length)return false;
  if(source.folder===target.path||filePathWithinTrash(source.folder)||filePathWithinTrash(target.path))return false;
  return source.files.every(f=>{
    const path=[source.folder,f.name].filter(Boolean).join('/');
    return f.name!=='.recycle'&&(!f.directory||(target.path!==path&&!target.path.startsWith(path+'/')));
  });
}
function captureFileEntries(){
  return {share:selected,folder:dir,files:chosenFileEntries().map(f=>({name:f.name,directory:!!f.directory}))};
}
function beginFileClipboard(operation){
  const data=captureFileEntries();
  if(!data.files.length){message('Выберите файлы или папки');return}
  if(filePathWithinTrash(data.folder)||data.files.some(f=>f.name==='.recycle')){
    message('Для корзины используйте обычные действия с файлами');return;
  }
  fileClipboard={...data,operation};
  message((operation==='move'?'Вырезано: ':'Скопировано: ')+data.files.length+' · перейдите в папку и нажмите Ctrl+V');
}
async function transferCapturedFiles(source,target,operation){
  if(fileTransferBusy||!source?.files?.length)return;
  if(source.share===target.share&&source.folder===target.path){
    message('Выберите другую папку назначения');return;
  }
  if(filePathWithinTrash(source.folder)||filePathWithinTrash(target.path)||
     source.files.some(f=>f.name==='.recycle')){
    message('Для корзины используйте обычные действия с файлами');return;
  }
  if(source.files.some(f=>f.directory&&source.share!==target.share)){
    message('Перенос папок между SMB-шарами не поддерживается');return;
  }
  if(source.files.some(f=>f.directory&&source.share===target.share&&
     (target.path===[source.folder,f.name].filter(Boolean).join('/')||
      target.path.startsWith([source.folder,f.name].filter(Boolean).join('/')+'/')))){
    message('Нельзя переносить папку внутрь себя');return;
  }
  fileTransferBusy=true;
  let done=0,failed=0,lastError='';
  const originalShare=selected,originalDir=dir;
  try{
    for(const f of source.files){
      try{
        await api('/api/transfer',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({share:source.share,path:[source.folder,f.name].filter(Boolean).join('/'),
            target_share:target.share,target_dir:target.path,operation})});
        done++;
      }catch(err){failed++;lastError=err.message}
    }
    if(source===fileClipboard&&operation==='move'&&failed===0)fileClipboard=null;
    if(originalShare===selected&&originalDir===dir&&(done>0||operation==='move')){
      clearSelection();
      await refresh();
    }
    message((operation==='move'?'Перемещено: ':'Скопировано: ')+done+
      (failed?' · Ошибок: '+failed+' · '+lastError:''));
  }finally{fileTransferBusy=false}
}
function pasteFileClipboard(){
  if(!fileClipboard){message('Буфер файлов пуст. Выберите файлы и нажмите Ctrl+C или Ctrl+X');return}
  return transferCapturedFiles(fileClipboard,{share:selected,path:dir},fileClipboard.operation);
}
function clearFolderDropStyles(){
  for(const node of document.querySelectorAll('.nasFolderDropTarget'))node.classList.remove('nasFolderDropTarget');
}
function endFileDrag(){
  draggedFiles=null;
  clearFolderDropStyles();
}
function attachFolderDrop(node,targetFn){
  node.addEventListener('dragover',event=>{
    const target=targetFn();
    if(!fileDropAllowed(draggedFiles,target))return;
    event.preventDefault();event.stopPropagation();
    event.dataTransfer.dropEffect='move';
    node.classList.add('nasFolderDropTarget');
  });
  node.addEventListener('dragleave',event=>{
    if(!node.contains(event.relatedTarget))node.classList.remove('nasFolderDropTarget');
  });
  node.addEventListener('drop',event=>{
    const payload=draggedFiles,target=targetFn();
    if(!fileDropAllowed(payload,target))return;
    event.preventDefault();event.stopPropagation();
    endFileDrag();
    transferCapturedFiles(payload,target,'move');
  });
}
function attachFileDrag(tile,f){
  // Native HTML DnD is deliberately desktop-only; mobile long-press is unchanged.
  if(!window.matchMedia('(pointer:fine)').matches||filePathWithinTrash(dir)||f.name==='.recycle')return;
  tile.draggable=true;
  tile.addEventListener('dragstart',event=>{
    if(allPhotosMode||view==='gallery'||fileTransferBusy){event.preventDefault();return}
    const files=selectedFiles.has(f.name)?items.filter(x=>selectedFiles.has(x.name)):[f];
    if(files.some(x=>x.name==='.recycle')){event.preventDefault();return}
    draggedFiles={share:selected,folder:dir,files:files.map(x=>({name:x.name,directory:!!x.directory}))};
    event.dataTransfer.effectAllowed='move';
    event.dataTransfer.setData('text/plain','NAS Web file transfer');
    tile.classList.add('nasDragging');
  });
  tile.addEventListener('dragend',()=>{tile.classList.remove('nasDragging');endFileDrag()});
  if(f.directory)attachFolderDrop(tile,()=>({share:selected,path:fpath(f.name)}));
}
function fileKeyboardAction(event){
  if(event.altKey||event.isComposing)return null;
  const key=event.key.toLowerCase();
  if((event.ctrlKey||event.metaKey)&&!event.shiftKey){
    return {a:'selectAll',c:'copy',x:'cut',v:'paste'}[key]||null;
  }
  if(!event.ctrlKey&&!event.metaKey&&!event.shiftKey){
    if(event.key==='F2')return 'rename';
    if(event.key==='Delete')return 'delete';
    if(event.key==='Escape')return 'unselect';
  }
  return null;
}
function fileShortcutsAvailable(event){
  const target=event.target;
  if(allPhotosMode||view==='gallery'||fileTransferBusy||el('app').classList.contains('hidden')||
     previewIndex>=0||activeDialog||!el('destinationOverlay').classList.contains('hidden')||
     !el('mobileSheetOverlay').classList.contains('hidden')||document.querySelector('.transferOverlay'))return false;
  if(target?.isContentEditable||target?.closest?.('input,textarea,select,[contenteditable]'))return false;
  return true;
}
document.addEventListener('keydown',event=>{
  const action=fileKeyboardAction(event);
  if(!action||!fileShortcutsAvailable(event))return;
  // Do not hijack Ctrl+C for plain page text or clipboard operations elsewhere.
  if(['copy','cut'].includes(action)&&
    !selectedFiles.size&&!chosenFileEntries().length)return;
  if(['delete','rename'].includes(action)&&!selectedFiles.size&&!chosenFileEntries().length)return;
  if(action==='unselect'&&!selectedFiles.size&&!selectionMode)return;
  event.preventDefault();event.stopImmediatePropagation();
  if(action==='selectAll')el('selectAll').click();
  if(action==='copy'||action==='cut')beginFileClipboard(action==='copy'?'copy':'move');
  if(action==='paste')pasteFileClipboard();
  if(action==='rename'){
    const files=chosenFileEntries();
    if(files.length===1)renameItem(files[0]);
    else message('Для переименования выберите один файл или папку');
  }
  if(action==='delete'){
    const files=chosenFileEntries();
    if(!selectedFiles.size&&files.length===1){selectedFiles.add(files[0].name);selectionMode=true;updateSelection()}
    el('selectionDelete').click();
  }
  if(action==='unselect')clearSelection();
},true);

el('selectionCopy').onclick=()=>bulkTransfer('copy');
el('selectionMove').onclick=()=>bulkTransfer('move');
el('selectionZip').onclick=async()=>{
  const targets=items.filter(f=>selectedFiles.has(f.name));
  if(!targets.length)return;
  if(targets.some(f=>f.directory)){message('Для ZIP выберите только файлы');return}
  try{
    message('Подготавливаем ZIP…');
    const r=await fetch('/api/zip',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({share:selected,path:dir,files:targets.map(f=>f.name)})});
    if(!r.ok){let err;try{err=(await r.json()).detail}catch{}throw Error(err||'HTTP '+r.status)}
    const blob=await r.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='NAS-Web-files.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
    message('ZIP готов: '+targets.length+' файлов');
  }catch(e){message('Ошибка ZIP: '+e.message)}
};
el('selectionModeButton').onclick=()=>{selectionMode=!selectionMode;selectedFiles.clear();updateSelection()};
el('selectionCancel').onclick=clearSelection;
el('selectAll').onclick=()=>{selectionMode=true;for(const file of sortedFiltered())selectedFiles.add(file.name);updateSelection()};
el('selectionDownload').onclick=()=>{if(selectedFiles.size!==1)return;const file=items.find(f=>selectedFiles.has(f.name));if(file&&!file.directory)download(file)};
el('selectionDelete').onclick=async()=>{
  const targets=items.filter(f=>selectedFiles.has(f.name));
  if(!targets.length)return;
  const inTrash=targets.every(f=>isTrashItemPath(fpath(f.name)));
  const approved=await askDialog(inTrash?{
    title:'Удалить навсегда '+targets.length+' элементов?',
    text:'Выбранные файлы и содержимое выбранных папок будут удалены навсегда.',
    confirm:'Удалить',danger:true
  }:{
    title:'Переместить в корзину?',
    text:'В корзину будут перемещены '+targets.length+' элементов вместе с содержимым выбранных папок.',
    confirm:'В корзину',danger:true
  });
  if(!approved)return;
  let removed=0,failed=0;
  for(const f of targets){
    const path=fpath(f.name);
    const permanent=isTrashItemPath(path);
    try{
      await api(permanent?'/api/trash/permanent-delete':'/api/delete',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({share:selected,path,directory:!!f.directory})
      });
      removed++;
    }catch(e){failed++}
  }
  clearSelection();await refresh();
  if(failed)message('Успешно: '+removed+'. Ошибок: '+failed+'. Если удаление прервалось, содержимое папки могло быть удалено частично.');
};
el('galleryZoomOut').onclick=()=>{setGalleryColumns(galleryColumns-1);if(allPhotosMode){galleryRenderSignature='';resetGalleryVirtual();renderAllGallery()}};
el('galleryZoomIn').onclick=()=>{setGalleryColumns(galleryColumns+1);if(allPhotosMode){galleryRenderSignature='';resetGalleryVirtual();renderAllGallery()}};
el('galleryMonthJump').onchange=e=>{
  const key=e.target.value;if(!key)return;
  if(allPhotosMode&&!allPhotoSubsetMode)jumpToGlobalMonth(key);
  else{const [year,month]=key.split('-');if(year)galleryJumpTo(year,month)}
};
el('galleryPickDone').onclick=clearGalleryPick;
el('galleryPickDownload').onclick=async()=>{
  const chosen=[...galleryPicked.values()];
  if(!chosen.length)return;
  // ZIP API accepts one share and one directory. Group downloads safely.
  const groups=new Map();
  for(const f of chosen){const key=JSON.stringify([f.share,f.folder]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(f.name)}
  for(const [key,names] of groups){
    const [share,path]=JSON.parse(key);
    try{
      const response=await fetch('/api/zip',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({share,path,files:names})});
      if(!response.ok)throw Error('HTTP '+response.status);
      const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download='NAS-Web-photos.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
    }catch(e){message('Ошибка скачивания: '+e.message);return}
  }
  clearGalleryPick();
};
setGalleryColumns(galleryColumns);
el('galleryStatusToggle').onclick=toggleGalleryStatus;
el('galleryLoadMore').onclick=()=>loadGlobalPage(false);
el('globalGalleryBack').onclick=leaveGlobalGallery;
const galleryNextObserver=new IntersectionObserver(entries=>{
  if(entries.some(e=>e.isIntersecting)&&allPhotosMode&&allPhotoStatus?.complete&&
     !allPhotoPageBusy&&!allPhotoSubsetMode&&allPhotoNextOffset<allPhotoTotal)loadGlobalPage(false);
},{rootMargin:'450px 0px'});
galleryNextObserver.observe(el('galleryLoadMore'));

// User-facing refresh never resets the SQLite photo index or EXIF progress.
el('galleryRetryDates').onclick=()=>message('Проверка дат доступна в администрировании');
el('globalGalleryRescan').onclick=async()=>{
  if(!allPhotosMode)return;
  const token=++allPhotoScanToken;
  allPhotoSubsetMode=false;allPhotoStartOffset=0;allPhotoNextOffset=0;
  allPhotoTimeline=[];allPhotoTimelineCheckedAt=0;
  allPhotos=[];allPhotoTotal=0;allPhotoStatus=null;galleryRenderSignature='';
  render();
  await loadGlobalPage(true);
  if(allPhotosMode&&token===allPhotoScanToken){
    loadGlobalTimeline(token);
    scanAllPhotos(token);
  }
};
el('refresh').onclick=()=>allPhotosMode?el('globalGalleryRescan').click():refresh();el('search').oninput=()=>{if(allPhotosMode)window.scrollTo({top:0,behavior:'instant'});render()};el('sort').onchange=render;
el('gridView').onclick=()=>{leaveGlobalGallery();galleryDateGeneration++;view='grid';localStorage.setItem('nas_view',view);render()};
el('listView').onclick=()=>{leaveGlobalGallery();galleryDateGeneration++;view='list';localStorage.setItem('nas_view',view);render()};
el('galleryView').onclick=()=>enterGlobalGallery();
el('uploadCenterButton').onclick=showUploadCenter;
el('upload').onchange=e=>{uploadFiles([...e.target.files]);e.target.value=''};
el('closePreview').onclick=closePreview;
el('previewInfo').onclick=()=>{
  if(previewIndex<0)return;
  const f=gallery[previewIndex];
  const img=el('previewBody').querySelector('img');
  const dimensions=img&&img.naturalWidth?img.naturalWidth+' × '+img.naturalHeight+' пикселей':'Ещё загружается';
  const stamp=Number(f.modified||0);
  const date=stamp?new Date(stamp*1000).toLocaleString('ru'):'Неизвестна';
  const lines=['Файл: '+f.name,'Размер: '+size(Number(f.size||0))];
  if(f.taken)lines.push('Дата съёмки (EXIF): '+f.taken.replace('T',' '));
  lines.push('Изменён: '+date);
  if(isPhoto(f))lines.push('Разрешение: '+dimensions);
  if(isMobileLayout()){
    openMobileSheet('Информация о файле',[]);
    const p=document.createElement('p');p.className='photoFileInfo';p.textContent=lines.join('\n');
    el('mobileSheetActions').append(p);
  }else askDialog({title:'Информация о файле',text:lines.join('\n'),confirm:'Закрыть'});
};
el('previewDownload').onclick=()=>{if(previewIndex>=0){const f=gallery[previewIndex];const a=document.createElement('a');a.href='/api/file?'+qs({share:shownShare,path:[shownDir,f.name].filter(Boolean).join('/')});a.download=f.name;a.click()}};
let gesture=null,lastTap=0,tapTimer=null,lastTouchAt=0;
function toggleViewerControls(){const viewer=el('preview');if(viewer.style.display==='flex')viewer.classList.toggle('controlsHidden')}
const previewArea=el('previewBody');
const dist=(a,b)=>Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);

let dismissActive=false;
function dismissMove(dy){
  const stage=el('photoStage'),preview=el('preview'),img=previewArea.querySelector('img');
  if(!img)return;
  const progress=Math.min(1,Math.max(0,dy)/260);
  img.classList.remove('arriving');
  img.style.transition='none';
  img.style.transform='translate3d(0,'+dy+'px,0) scale('+(1-progress*.12)+')';
  preview.style.backgroundColor='rgba(7,10,16,'+(1-progress*.72)+')';
  stage.style.opacity=String(1-progress*.16);
}
function dismissReset(){
  const preview=el('preview'),img=previewArea.querySelector('img'),stage=el('photoStage');
  preview.classList.remove('dismissClosing');
  preview.style.backgroundColor='';
  stage.style.opacity='';
  if(img){img.style.transition='transform .2s ease-out';img.style.transform='';setTimeout(()=>{if(zoom===1&&previewArea.contains(img))img.style.transition=''},220)}
  dismissActive=false;
}
function dismissFinish(dy){
  const img=previewArea.querySelector('img'),preview=el('preview');
  if(img){
    img.style.transition='transform .18s ease-in,opacity .18s ease-in';
    img.style.transform='translate3d(0,'+Math.max(innerHeight,dy+260)+'px,0) scale(.87)';
    img.style.opacity='0';
  }
  preview.classList.add('dismissClosing');
  setTimeout(()=>{closePreview();dismissReset()},185);
}

previewArea.addEventListener('touchstart',event=>{
  if(!previewArea.querySelector('img'))return;
  if(event.touches.length===2){
    if(dismissActive)dismissReset();
    gesture={mode:'pinch',distance:dist(event.touches[0],event.touches[1]),scale:zoom,px:panX,py:panY};
  }else if(event.touches.length===1){
    const t=event.touches[0];
    gesture={mode:'single',x:t.clientX,y:t.clientY,px:panX,py:panY,when:Date.now(),moved:false,baseZoom:zoom};
  }
},{passive:true});
previewArea.addEventListener('touchmove',event=>{
  if(!previewArea.querySelector('img')||!gesture)return;
  if(event.touches.length===2&&gesture.mode==='pinch'){
    event.preventDefault();
    setZoom(gesture.scale*dist(event.touches[0],event.touches[1])/Math.max(1,gesture.distance));
  }else if(event.touches.length===1&&gesture.mode==='single'){
    const t=event.touches[0],dx=t.clientX-gesture.x,dy=t.clientY-gesture.y;
    if(Math.hypot(dx,dy)>9)gesture.moved=true;
    if(zoom>1){
      event.preventDefault();panX=gesture.px+dx;panY=gesture.py+dy;drawZoom();
    }else if(gesture.mode==='single'&&dy>12&&Math.abs(dy)>Math.abs(dx)*1.35){
      gesture.dismissing=true;dismissActive=true;
      event.preventDefault();dismissMove(dy);
    }else if(gesture.dismissing){
      event.preventDefault();dismissMove(Math.max(0,dy));
    }
  }
},{passive:false});
previewArea.addEventListener('touchend',event=>{
  if(!gesture)return;
  if(gesture.mode==='pinch'){if(event.touches.length===0)gesture=null;else gesture={mode:'finished'};return}
  if(gesture.mode!=='single'||event.changedTouches.length!==1){gesture=null;return}
  const t=event.changedTouches[0],dx=t.clientX-gesture.x,dy=t.clientY-gesture.y;
  const tapped=Math.abs(dx)<12&&Math.abs(dy)<12&&Date.now()-gesture.when<320;
  const dismissing=!!gesture.dismissing;
  gesture=null;
  if(dismissing){
    if(dy>105&&dy>Math.abs(dx)*1.15)dismissFinish(dy);
    else dismissReset();
    return;
  }
  if(tapped){
    lastTouchAt=Date.now();
    const now=lastTouchAt;
    if(now-lastTap<330){clearTimeout(tapTimer);setZoom(zoom>1?1:2.5);lastTap=0}
    else {lastTap=now;clearTimeout(tapTimer);tapTimer=setTimeout(()=>{if(previewIndex>=0)toggleViewerControls()},340)}
  }else if(zoom===1&&Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.25){
    stepPreview(dx<0?1:-1);
  }
},{passive:true});
previewArea.addEventListener('touchcancel',()=>{gesture=null;if(dismissActive)dismissReset()});
previewArea.addEventListener('click',event=>{if(!event.target.closest('img')||Date.now()-lastTouchAt<600)return;clearTimeout(tapTimer);tapTimer=setTimeout(toggleViewerControls,210)});
previewArea.addEventListener('dblclick',event=>{if(!previewArea.querySelector('img'))return;clearTimeout(tapTimer);setZoom(zoom>1?1:2.5)});
previewArea.addEventListener('wheel',event=>{if(!previewArea.querySelector('img')||!(event.ctrlKey||event.metaKey))return;event.preventDefault();setZoom(zoom*(event.deltaY<0?1.18:.85))},{passive:false});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!el('mobileSheetOverlay').classList.contains('hidden'))closeMobileSheet();else if(activeDialog)activeDialog(null);else{closePreview();hideMenu()}}if(el('preview').style.display==='flex'){
  const video=el('previewBody').querySelector('video');
  if(video&&document.activeElement?.tagName!=='INPUT'&&!e.altKey&&!e.ctrlKey&&!e.metaKey){
    if(e.key==='ArrowLeft'||e.key==='ArrowRight'){
      e.preventDefault();
      if(Number.isFinite(video.duration))video.currentTime=Math.max(0,Math.min(video.duration,video.currentTime+(e.key==='ArrowRight'?10:-10)));
      return;
    }
  }
  if(e.key==='ArrowLeft')stepPreview(-1);if(e.key==='ArrowRight')stepPreview(1);if(e.key==='0')setZoom(1);if(e.key==='+')setZoom(zoom*1.25);if(e.key==='-')setZoom(zoom/1.25)}});
document.addEventListener('pointerdown',e=>{if(!el('fileMenu').contains(e.target)&&!e.target.closest('.more'))hideMenu()});
let dragDepth=0;
const work=el('workspace');
const externalFileDrag=e=>!draggedFiles&&Array.from(e.dataTransfer?.types||[]).includes('Files');
work.addEventListener('dragenter',e=>{
  if(!externalFileDrag(e))return;
  e.preventDefault();dragDepth++;work.classList.add('drop');
});
work.addEventListener('dragover',e=>{
  if(draggedFiles||externalFileDrag(e))e.preventDefault();
});
work.addEventListener('dragleave',e=>{
  if(!dragDepth)return;
  e.preventDefault();dragDepth=Math.max(0,dragDepth-1);
  if(!dragDepth)work.classList.remove('drop');
});
work.addEventListener('drop',e=>{
  e.preventDefault();dragDepth=0;work.classList.remove('drop');
  if(draggedFiles){endFileDrag();return}
  const files=[...e.dataTransfer.files];
  if(files.length)uploadFiles(files);
});

// User profiles are linked to the SMB login, not to an editable display name.
// Folder bindings affect only the gallery queries; SMB ACLs stay authoritative.
const PROFILE_COLORS=['#4b80db','#64748b','#7a72cf','#208b91','#ad698d','#bd834b'];
let profileData=null,profileColor=PROFILE_COLORS[0];
function profileNotice(text){el('profileMessage').textContent=text}
function profileInitial(name){return Array.from(String(name||'?').trim())[0]?.toLocaleUpperCase()||'?'}
function updateProfileAvatar(){
  const name=profileData?.display_name||videoUser||'?';
  for(const id of ['profileAvatar','profileBigAvatar']){
    el(id).textContent=profileInitial(name);
    el(id).style.backgroundColor=profileData?.avatar_color||PROFILE_COLORS[0];
  }
  if(profileData)el('who').textContent=profileData.display_name;
}
async function refreshProfile(){
  const data=await api('/api/profile');
  if(!csrf)return;
  profileData=data;
  profileColor=data.avatar_color;
  updateProfileAvatar();
  renderProfile();
  renderImportDestination();
  return data;
}
function renderProfile(){
  if(!profileData)return;
  el('profileLogin').textContent=profileData.username;
  el('profileName').value=profileData.display_name;
  const palette=el('profileColors');palette.replaceChildren();
  for(const color of PROFILE_COLORS){
    const button=document.createElement('button');button.type='button';
    button.className='profileColor'+(color===profileColor?' selected':'');
    button.style.backgroundColor=color;button.dataset.color=color;
    button.setAttribute('aria-label','Цвет '+color);
    button.setAttribute('aria-pressed',String(color===profileColor));
    button.onclick=()=>{
      profileColor=color;
      for(const b of palette.children){
        b.classList.toggle('selected',b.dataset.color===color);
        b.setAttribute('aria-pressed',String(b.dataset.color===color));
      }
      el('profileBigAvatar').style.backgroundColor=color;
    };
    palette.append(button);
  }
  const list=el('profileFolders');list.replaceChildren();
  if(!(profileData.folders||[]).length){
    const empty=document.createElement('p');empty.className='profileHint';
    empty.textContent='Пока нет привязанных папок. Откройте нужную папку в разделе «Файлы», затем нажмите «Привязать».';
    list.append(empty);
  }
  for(const folder of profileData.folders||[]){
    const row=document.createElement('div');row.className='profileFolder';
    const info=document.createElement('div');info.className='profileFolderInfo';
    const label=document.createElement('strong');label.textContent=folder.path.split('/').at(-1);
    const sub=document.createElement('small');
    sub.textContent=folder.share+' / '+folder.path+' · '+(folder.visible?'В общей галерее':'Скрыта для всех');
    info.append(label,sub);
    const actions=document.createElement('div');actions.className='profileFolderActions';
    const toggle=document.createElement('button');toggle.type='button';
    toggle.textContent=folder.visible?'Скрыть фото':'Показать фото';
    toggle.setAttribute('aria-label',(folder.visible?'Скрыть':'Показать')+' фотографии из '+folder.path+' для всех');
    toggle.onclick=async()=>{
      toggle.disabled=true;
      try{
        profileData=await collectionPost('/api/profile/folders',{
          share:folder.share,path:folder.path,visible:!folder.visible
        },'PATCH');
        renderProfile();
        profileNotice(folder.visible?'Папка скрыта в галерее у всех пользователей':'Папка снова видна в общей галерее');
        if(allPhotosMode&&!allPhotoSubsetMode){
          await loadGlobalPage(true);loadGlobalTimeline(allPhotoScanToken);
        }
      }catch(err){profileNotice('Ошибка: '+err.message)}
      finally{toggle.disabled=false}
    };
    const remove=document.createElement('button');remove.type='button';
    remove.className='profileDanger';remove.textContent='Отвязать';
    remove.onclick=async()=>{
      if(!confirm('Отвязать папку '+folder.path+'? Её фотографии снова будут видны всем, кому разрешает SMB.'))return;
      try{
        profileData=await collectionPost('/api/profile/folders',{share:folder.share,path:folder.path},'DELETE');
        renderProfile();profileNotice('Привязка удалена, файлы не изменены');
        if(allPhotosMode&&!allPhotoSubsetMode){
          await loadGlobalPage(true);loadGlobalTimeline(allPhotoScanToken);
        }
      }catch(err){profileNotice('Ошибка: '+err.message)}
    };
    actions.append(toggle,remove);row.append(info,actions);list.append(row);
  }
  // The profile picker works from gallery mode, a share root, or any folder.
  // There is no prerequisite to navigate the file manager first.
  el('profileBindFolder').disabled=!shares.length;
}

// Independent folder picker: does not alter the user's active gallery,
// current file-manager directory or the shared index.
let profilePickShare='',profilePickPath='',profilePickerEpoch=0,profilePickerBusy=false;
let profilePickerPurpose='bind';
function closeProfilePicker(){
  ++profilePickerEpoch;
  profilePickerBusy=false;
  el('profilePicker').classList.add('hidden');
}
function profilePickerTrail(){
  const trail=el('profilePickTrail');trail.replaceChildren();
  const parts=profilePickPath?profilePickPath.split('/'):[];
  const home=document.createElement('button');home.type='button';
  home.textContent=profilePickShare||'Хранилище';
  home.disabled=parts.length===0;
  home.onclick=()=>profileBrowseFolder(profilePickShare,'');
  trail.append(home);
  for(let index=0;index<parts.length;index++){
    const separator=document.createElement('span');separator.textContent='›';
    const step=document.createElement('button');step.type='button';
    step.textContent=parts[index];step.disabled=index===parts.length-1;
    const target=parts.slice(0,index+1).join('/');
    step.onclick=()=>profileBrowseFolder(profilePickShare,target);
    trail.append(separator,step);
  }
}
// A response from an older navigation can never overwrite a newer folder.
async function profileBrowseFolder(share,path){
  if(!shares.includes(share))return;
  const serial=++profilePickerEpoch;
  profilePickShare=share;profilePickPath=path;
  profilePickerBusy=true;
  el('profilePickShare').value=share;
  profilePickerTrail();
  const container=el('profilePickFolders');container.replaceChildren();
  const loading=document.createElement('p');loading.textContent='Открываем папку…';
  container.append(loading);
  el('profilePickConfirm').disabled=true;
  try{
    const data=await api('/api/list?'+qs({share,path}));
    if(serial!==profilePickerEpoch||el('profilePicker').classList.contains('hidden'))return;
    const folders=(data.items||[])
      .filter(item=>item.directory&&item.name&&item.name!=='.'&&item.name!=='..'&&item.name!=='.recycle')
      .sort((a,b)=>a.name.localeCompare(b.name,'ru',{numeric:true}));
    container.replaceChildren();
    for(const folder of folders){
      const next=[path,folder.name].filter(Boolean).join('/');
      const button=document.createElement('button');button.type='button';
      button.textContent='▱  '+folder.name;
      button.onclick=()=>profileBrowseFolder(share,next);
      container.append(button);
    }
    if(!folders.length){
      const empty=document.createElement('p');
      empty.textContent=path?'Нет подпапок. Выберите текущую папку.':'В этой шаре нет доступных папок.';
      container.append(empty);
    }
    profilePickerBusy=false;
    el('profilePickConfirm').disabled=!path;
  }catch(err){
    if(serial!==profilePickerEpoch)return;
    container.replaceChildren();
    const error=document.createElement('p');
    error.textContent='Не удалось открыть папку: '+err.message;
    container.append(error);
    profilePickerBusy=false;
    el('profilePickConfirm').disabled=true;
  }
}
function openProfilePicker(purpose='bind'){
  profilePickerPurpose=purpose==='import'?'import':'bind';
  el('profilePickConfirm').textContent=profilePickerPurpose==='import'?'Выбрать эту папку':'Привязать эту папку';
  if(!shares.length){profileNotice('Нет доступных SMB-шар');return;}
  el('profilePicker').classList.remove('hidden');
  profileNotice('');
  const select=el('profilePickShare');select.replaceChildren();
  for(const share of shares){
    const option=document.createElement('option');option.value=share;option.textContent=share;
    select.append(option);
  }
  const share=selected&&shares.includes(selected)?selected:shares[0];
  const path=!allPhotosMode&&share===selected&&dir&&!dir.startsWith('.recycle')?dir:'';
  profileBrowseFolder(share,path);
  el('profilePicker').scrollIntoView({block:'nearest',behavior:'smooth'});
}
el('profilePickShare').onchange=()=>profileBrowseFolder(el('profilePickShare').value,'');
el('profilePickerClose').onclick=closeProfilePicker;
el('profilePickCancel').onclick=closeProfilePicker;
el('profilePickConfirm').onclick=async()=>{
  if(profilePickerBusy||!profilePickShare||!profilePickPath)return;
  const share=profilePickShare,path=profilePickPath;
  if(profilePickerPurpose==='import'){
    googleImportDestination={share,path};
    closeProfilePicker();renderImportDestination();
    importNotice('Папка назначения выбрана');
    return;
  }
  const button=el('profilePickConfirm');button.disabled=true;
  try{
    const result=await collectionPost('/api/profile/folders',{share,path});
    profileData=result;
    closeProfilePicker();renderProfile();
    profileNotice('Папка '+share+' / '+path+' привязана к профилю');
  }catch(err){
    profileNotice('Не удалось привязать папку: '+err.message);
    if(!el('profilePicker').classList.contains('hidden'))button.disabled=false;
  }
};

function closeProfile(){
  closeProfilePicker();
  el('profileOverlay').classList.add('hidden');
}
async function openProfile(){
  closeMobileSheet();
  el('profileOverlay').classList.remove('hidden');
  profileNotice('');
  try{await refreshProfile()}catch(e){profileNotice('Не удалось открыть профиль: '+e.message)}
  refreshGoogleImport().catch(err=>importNotice('Импорт Google: '+err.message));
}
el('profileTrigger').onclick=openProfile;
el('profileClose').onclick=closeProfile;
el('profileOverlay').addEventListener('click',e=>{
  if(e.target===el('profileOverlay'))closeProfile();
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&!el('profileOverlay').classList.contains('hidden'))closeProfile();
});
el('profileForm').onsubmit=async e=>{
  e.preventDefault();const button=el('profileSave');button.disabled=true;
  try{
    profileData=await collectionPost('/api/profile',{
      display_name:el('profileName').value,avatar_color:profileColor
    },'PATCH');
    updateProfileAvatar();renderProfile();profileNotice('Профиль сохранён');
  }catch(err){profileNotice('Ошибка сохранения: '+err.message)}
  finally{button.disabled=false}
};
el('profileBindFolder').onclick=openProfilePicker;


// All import controls live INSIDE the existing user profile, not the app shell.
let googleImportDestination=null,googlePickerWaiting=false,googleImportBusy=false;
let googlePickerPollAfter=0;
let googleStatusRequestBusy=false;
function importNotice(text){el('profileImportMessage').textContent=text}
function renderImportDestination(){
  if(!googleImportDestination&&profileData?.folders?.length){
    const folder=profileData.folders[0];
    googleImportDestination={share:folder.share,path:folder.path};
  }
  el('profileImportPath').textContent=googleImportDestination
    ?googleImportDestination.share+' / '+googleImportDestination.path
    :'Выберите папку на NAS';
}
el('profileImportChoose').onclick=()=>openProfilePicker('import');
function formatImportJob(job){
  const card=document.createElement('div');card.className='profileImportJob';
  const source=job.source==='picker'?'Выбор Google Фото':'Google Takeout';
  const phase={
    queued:'В очереди',running:'Перенос выполняется',
    completed:'Завершён',failed:'Ошибка',interrupted:'Прерван'
  }[job.status]||job.status;
  card.textContent=source+' · '+phase+
    (job.total?' · '+job.processed+' / '+job.total:'')+
    ' · перенесено: '+job.imported+', пропущено: '+job.skipped+
    (job.failed?' · ошибок: '+job.failed:'')+
    (job.detail?' · '+job.detail:'');
  return card;
}
async function refreshGoogleImport(){
  if(el('profileOverlay').classList.contains('hidden')||googleStatusRequestBusy)return;
  googleStatusRequestBusy=true;
  try{
    const status=await api('/api/import/google/status');
    const {configured,connected}=status;
    if(connected&&status.picker_active)googlePickerWaiting=true;
    if(!connected)googlePickerWaiting=false;
    el('profileGoogleState').textContent=!configured
      ?'Для Picker не настроен OAuth в аддоне'
      :connected?'Google подключён':'Google не подключён';
    el('profileGoogleConnect').disabled=!configured;
    el('profileGoogleConnect').classList.toggle('hidden',!!connected);
    el('profileGoogleDisconnect').classList.toggle('hidden',!connected);
    el('profileGooglePickerStart').disabled=!connected||googleImportBusy;
    const cards=el('profileImportJobsList');cards.replaceChildren();
    for(const job of status.jobs||[])cards.append(formatImportJob(job));
    if(!(status.jobs||[]).length){
      const empty=document.createElement('p');empty.className='profileHint';
      empty.textContent='Переносов пока нет';
      cards.append(empty);
    }
    if(googlePickerWaiting&&connected){
      el('profilePickerActions').classList.remove('hidden');
      if(Date.now()<googlePickerPollAfter)return;
      const result=await api('/api/import/google/picker/status');
      const waitMs=Math.max(6000,Math.min(60000,Number.parseFloat(result.poll_interval||'6s')*1000||6000));
      googlePickerPollAfter=Date.now()+waitMs;
      if(result.active){
        el('profileGooglePickerLink').href=result.picker_uri;
        el('profileGooglePickerStatus').textContent=result.ready
          ?'Выбор завершён, можно начать импорт'
          :'Завершите выбор фотографий во вкладке Google';
        el('profileGoogleImportPicked').disabled=!result.ready||googleImportBusy;
      }else{
        googlePickerWaiting=false;
        el('profilePickerActions').classList.add('hidden');
      }
    }
  }finally{googleStatusRequestBusy=false}
}
function googleImportDestinationRequired(){
  if(!googleImportDestination){
    importNotice('Сначала выберите папку назначения в профиле');
    return null;
  }
  return googleImportDestination;
}
el('profileGoogleConnect').onclick=async()=>{
  try{
    const result=await api('/api/import/google/oauth/start',{method:'POST'});
    if(!result.url?.startsWith('https://accounts.google.com/'))throw Error('Некорректная ссылка OAuth');
    window.location.assign(result.url);
  }catch(err){importNotice(err.message)}
};
el('profileGoogleDisconnect').onclick=async()=>{
  if(!confirm('Отключить Google Фото для этого профиля? Уже импортированные файлы останутся.'))return;
  try{
    await api('/api/import/google/disconnect',{method:'POST'});
    googlePickerWaiting=false;el('profilePickerActions').classList.add('hidden');
    await refreshGoogleImport();importNotice('Google Фото отключён');
  }catch(err){importNotice(err.message)}
};
el('profileGooglePickerStart').onclick=async()=>{
  try{
    const result=await api('/api/import/google/picker/start',{method:'POST'});
    if(!result.picker_uri?.startsWith('https://'))throw Error('Не получена ссылка Google');
    googlePickerWaiting=true;
    googlePickerPollAfter=0;
    el('profilePickerActions').classList.remove('hidden');
    el('profileGooglePickerLink').href=result.picker_uri;
    el('profileGooglePickerStatus').textContent='Откройте Google Фото, отметьте фотографии и подтвердите выбор';
    el('profileGoogleImportPicked').disabled=true;
    importNotice('Ссылка Google Фото готова. Откройте её и выберите фотографии.');
  }catch(err){importNotice('Ошибка Picker: '+err.message)}
};
el('profileGoogleImportPicked').onclick=async()=>{
  const destination=googleImportDestinationRequired();if(!destination)return;
  const button=el('profileGoogleImportPicked');button.disabled=true;
  try{
    const result=await collectionPost('/api/import/google/picker/import',{
      share:destination.share,path:destination.path
    });
    googlePickerWaiting=false;el('profilePickerActions').classList.add('hidden');
    importNotice('Импорт выбранных фотографий запущен: '+result.total+' файлов');
    refreshGoogleImport();
  }catch(err){importNotice('Импорт не запущен: '+err.message)}
  finally{button.disabled=false}
};
// A Takeout ZIP is never sent as one long HTTP request: proxies and mobile
// networks can disconnect mid-upload. Each 1 MiB chunk can be acknowledged,
// retried and resumed from the durable server-side byte offset.
function sendTakeoutChunk(blob,uploadId,offset,onProgress){
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();
    xhr.open('PUT','/api/import/google/takeout/chunk?'+qs({
      upload_id:uploadId,offset:String(offset)
    }));
    xhr.withCredentials=true;
    xhr.timeout=90000;
    xhr.setRequestHeader('Content-Type','application/octet-stream');
    xhr.setRequestHeader('X-CSRF-Token',csrf);
    xhr.upload.onprogress=e=>{
      if(e.lengthComputable)onProgress(e.loaded);
    };
    xhr.onload=()=>{
      let result={};try{result=JSON.parse(xhr.responseText)}catch{}
      if(xhr.status>=200&&xhr.status<300)resolve(result);
      else{
        const error=new Error(result.detail||'HTTP '+xhr.status);
        error.status=xhr.status;
        reject(error);
      }
    };
    xhr.onerror=()=>reject(Error('Соединение прервано при передаче части ZIP'));
    xhr.ontimeout=()=>reject(Error('Превышено время ожидания части ZIP'));
    xhr.onabort=()=>reject(Error('Загрузка прервана'));
    xhr.send(blob);
  });
}
async function submitTakeoutArchive(file,destination){
  const transfer=await collectionPost('/api/import/google/takeout/start',{
    share:destination.share,path:destination.path,name:file.name,
    size:file.size,mtime:file.lastModified||0
  });
  const id=transfer.upload_id,chunkSize=transfer.chunk_size||1048576;
  let offset=transfer.offset||0,failures=0;
  const progress=el('profileImportUploadProgress');
  const bar=el('profileImportUploadBar');
  const label=el('profileImportUploadText');
  progress.classList.remove('hidden');
  function updateProgress(current,extra=''){
    const value=Math.round(Math.min(1,current/file.size)*100);
    bar.value=value;
    label.textContent='Takeout: '+file.name+' · '+value+'% ('+
      size(current)+' / '+size(file.size)+')'+extra;
  }
  updateProgress(offset,offset?' · продолжаем передачу':'');
  while(offset<file.size){
    const chunk=file.slice(offset,Math.min(file.size,offset+chunkSize));
    try{
      const answer=await sendTakeoutChunk(chunk,id,offset,
        loaded=>updateProgress(offset+loaded));
      if(!Number.isSafeInteger(answer.offset)||answer.offset<=offset||
         answer.offset>file.size)throw Error('Сервер вернул неверную позицию загрузки');
      offset=answer.offset;
      failures=0;
      updateProgress(offset);
    }catch(err){
      // A dropped ACK does not mean the chunk was lost. Ask the server where
      // the file actually ends before retransmitting anything.
      if([400,401,403,404,410,413].includes(err.status))throw err;
      failures++;
      if(failures>6)throw Error('Не удалось восстановить передачу ZIP: '+err.message+
        '. Повторно выберите тот же архив для продолжения.');
      updateProgress(offset,' · переподключение '+failures+'/6');
      await new Promise(resolve=>setTimeout(resolve,Math.min(6000,500*2**failures)));
      try{
        const status=await api('/api/import/google/takeout/status?'+
          qs({upload_id:id}));
        if(!Number.isSafeInteger(status.offset)||status.offset<offset||
           status.offset>file.size)throw Error('Некорректная позиция на NAS');
        offset=status.offset;
        updateProgress(offset,' · восстановлено');
      }catch(statusError){
        if(/HTTP 401|HTTP 403|HTTP 404/.test(statusError.message))throw statusError;
        // Temporary status request failure: send original chunk again. The
        // server recognizes exact duplicates and cannot write them twice.
      }
    }
  }
  label.textContent='ZIP передан · проверяем архив и запускаем импорт…';
  const job=await collectionPost('/api/import/google/takeout/finish',{
    upload_id:id
  });
  progress.classList.add('hidden');
  return job;
}
async function waitImportJob(id){
  // Individual ZIP parts must be applied sequentially so that one user's
  // worker never races itself or resets the gallery while scanning.
  for(;;){
    const state=await api('/api/import/google/status');
    const job=(state.jobs||[]).find(job=>job.id===id);
    if(!job)throw Error('Задача импорта потеряна');
    if(['completed','failed','interrupted'].includes(job.status)){
      if(job.status!=='completed')throw Error(job.detail||'Ошибка импорта');
      return job;
    }
    if(el('profileImportMessage')){
      importNotice('Импортируем '+job.processed+'/'+(job.total||'…')+
        ' · перенесено '+job.imported+' · ошибок '+job.failed);
    }
    await new Promise(resolve=>setTimeout(resolve,2200));
  }
}
el('profileTakeoutFiles').onchange=async()=>{
  const files=Array.from(el('profileTakeoutFiles').files||[]);
  if(!files.length)return;
  const destination=googleImportDestinationRequired();
  if(!destination){el('profileTakeoutFiles').value='';return}
  if(googleImportBusy){importNotice('Импорт уже выполняется');return}
  googleImportBusy=true;
  el('profileTakeoutFiles').disabled=true;
  let complete=0;
  try{
    for(const file of files){
      if(!file.name.toLowerCase().endsWith('.zip')){
        throw Error('Поддерживаются только ZIP-архивы');
      }
      importNotice('Загружаем архив '+file.name+' ('+(complete+1)+'/'+files.length+')');
      const job=await submitTakeoutArchive(file,destination);
      el('profileImportUploadProgress').classList.add('hidden');
      await waitImportJob(job.job_id);
      complete++;
      await refreshGoogleImport();
    }
    importNotice('Готово: обработано '+complete+' ZIP-архивов Google Takeout');
  }catch(err){importNotice('Импорт остановлен: '+err.message+' · обработано архивов: '+complete)}
  finally{
    googleImportBusy=false;
    el('profileTakeoutFiles').disabled=false;
    el('profileTakeoutFiles').value='';
    el('profileImportUploadProgress').classList.add('hidden');
    refreshGoogleImport().catch(()=>{});
  }
};
setInterval(()=>{
  if(!document.hidden&&!el('profileOverlay').classList.contains('hidden'))
    refreshGoogleImport().catch(err=>console.warn('Google import status:',err.message));
},6500);


const theme=localStorage.getItem('nas_theme')||'dark';document.documentElement.dataset.theme=theme;el('theme').onclick=()=>{const t=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=t;localStorage.setItem('nas_theme',t)};
// Return to the profile after Google's top-level OAuth redirect.
const oauthResult=new URLSearchParams(window.location.search).get('nas_google');
if(oauthResult){
  window.history.replaceState({},'',window.location.pathname);
}
const startupLoginGeneration=loginGeneration;
api('/api/me').then(user=>{if(loginGeneration===startupLoginGeneration){showApp(user);if(oauthResult){openProfile().then(()=>importNotice(oauthResult==='connected'?'Google Фото подключён':'Google OAuth не завершён'))}}}).catch(()=>{if(loginGeneration===startupLoginGeneration)showLogin()});
