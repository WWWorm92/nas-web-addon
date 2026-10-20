let csrf='',selected='',dir='',shares=[],items=[],view=(['grid','list'].includes(localStorage.getItem('nas_view'))?localStorage.getItem('nas_view'):'grid'),previewIndex=-1;
const el=id=>document.getElementById(id);
const message=s=>el('status').textContent=s;
const qs=o=>new URLSearchParams(o).toString();
const ext=n=>(n.split('.').pop()||'').toLowerCase();
const imageExt=['jpg','jpeg','png','gif','webp'];
const videoExt=['mp4','webm','m4v','mov','mp3','ogg'];

const ICON_PATHS={
 folder:'<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z"/>',
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
let loginGeneration=0;
async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',...options,headers:{...(options.headers||{}),'X-CSRF-Token':csrf}});if(!r.ok){let m='HTTP '+r.status;try{m=(await r.json()).detail||m}catch{}if(r.status===401&&url!=='/api/login'&&url!=='/api/me')showLogin();throw Error(m)}return r.json()}
function showLogin(){leaveGlobalGallery();closeMobileSheet();hideMenu();closePreview();photoCacheClear();el('login').classList.remove('hidden');el('app').classList.add('hidden')}
function showApp(user){closeMobileSheet();photoCacheClear();csrf=user.csrf;shares=user.shares;el('who').textContent=user.username;el('login').classList.add('hidden');el('app').classList.remove('hidden');renderShares();if(shares.length)choose(shares[0]);else message('У пользователя нет доступных SMB-шар.')}
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
function renderBreadcrumb(){
  const crumb=el('crumb');crumb.replaceChildren();
  const parts=dir?dir.split('/'):[];
  const add=(label,target,last)=>{
    const btn=document.createElement('button');btn.type='button';btn.textContent=label==='.recycle'?'Корзина':label;
    if(last)btn.setAttribute('aria-current','page');
    btn.onclick=()=>{if(dir===target)return;photoCacheClear();clearSelection();dir=target;el('search').value='';refresh()};
    crumb.append(btn);
  };
  add(selected,'',parts.length===0);
  parts.forEach((part,i)=>{const sep=document.createElement('span');sep.className='crumbSep';sep.textContent='›';crumb.append(sep);add(part,parts.slice(0,i+1).join('/'),i===parts.length-1)});
}
function choose(share){leaveGlobalGallery();clearSelection();photoCacheClear();hideMenu();selected=share;dir='';el('search').value='';renderShares();refresh()}
function enterFolder(name){leaveGlobalGallery();clearSelection();photoCacheClear();hideMenu();dir=fpath(name);el('search').value='';refresh()}
function download(f){const a=document.createElement('a');a.href=fileUrl(f.name);a.download=f.name;a.click()}
const isPhoto=f=>!f.directory&&imageExt.includes(ext(f.name));
let allPhotosMode=false,allPhotos=[],allPhotoTotal=0,allPhotoStatus=null,allPhotoPageBusy=false,allPhotoScanToken=0,previousFileView='grid';
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
  const heading=[...el('entries').querySelectorAll('.galleryMonth')].find(h=>h.dataset.year===year&&(!month||h.dataset.month===month));
  if(heading)heading.scrollIntoView({behavior:'smooth',block:'start'});
}
function renderGalleryYears(photos){
  const bar=el('galleryYears');bar.replaceChildren();
  bar.classList.toggle('hidden',view!=='gallery'||!photos.length);
  if(view!=='gallery')return;
  const years=[...new Set(photos.map(photoYear))];
  const picker=el('galleryMonthJump');if(picker){picker.replaceChildren();const first=document.createElement('option');first.value='';first.textContent='Перейти к месяцу';picker.append(first);const seen=new Set();for(const f of photos){const d=photoDate(f);if(!Number.isFinite(d.getTime()))continue;const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');if(seen.has(key))continue;seen.add(key);const option=document.createElement('option');option.value=key;option.textContent=new Intl.DateTimeFormat('ru',{month:'long',year:'numeric'}).format(d);picker.append(option)}}
  for(const year of years){
    const button=document.createElement('button');button.type='button';button.textContent=year;
    button.onclick=()=>{const heading=[...el('entries').querySelectorAll('.galleryMonth')].find(h=>h.dataset.year===year);if(heading)heading.scrollIntoView({behavior:'smooth',block:'start'});for(const b of bar.children)b.classList.toggle('galleryYearCurrent',b===button)};
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
    .then(blob=>photoCachePut(key,blob))
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
  const candidates=offsets.map(offset=>gallery[previewIndex+offset]).filter(f=>f&&isPhoto(f)&&Number(f.size)<=ORIGINAL_CACHE_LIMIT);
  const prepare=async()=>{
    for(const f of candidates){
      if(serial!==viewerSerial)return;
      const key=photoKey(f);
      if(photoCacheGet(key))continue;
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
function closePreview(){clearTimeout(tapTimer);el('preview').classList.remove('controlsHidden');viewerSerial++;clearOriginal();for(const job of photoFetches.values())job.controller.abort();photoFetches.clear();clearTimeout(preloadTimer);el('previewBody').replaceChildren();el('preview').style.display='none';el('filmstrip').replaceChildren();previewIndex=-1;gallery=[];filmNodes.clear();resetZoom();document.body.style.overflow='';pumpThumbs()}
function showPreview(direction=0){if(previewIndex<0||!gallery.length)return;if(direction)swipeDirection=Math.sign(direction);const serial=++viewerSerial,f=gallery[previewIndex],box=el('previewBody');shownShare=f.share||shownShare;shownDir=f.folder!==undefined?f.folder:shownDir;clearOriginal();clearTimeout(preloadTimer);resetZoom();box.replaceChildren();el('viewerSpinner').textContent='Загрузка…';el('previewCounter').textContent=(previewIndex+1)+' / '+gallery.length;el('previewTitle').textContent=f.name;el('viewerSpinner').classList.toggle('hidden',!isPhoto(f));el('photoStage').style.touchAction=isPhoto(f)?'none':'auto';let node;if(isPhoto(f)){node=document.createElement('img');node.alt=f.name;node.draggable=false;node.className='arriving';node.style.setProperty('--slide',direction>0?'30px':direction<0?'-30px':'0px');node.onload=()=>{if(serial!==viewerSerial)return;el('viewerSpinner').classList.add('hidden');drawZoom()};node.onerror=()=>{if(serial===viewerSerial)el('viewerSpinner').textContent='Изображение недоступно'};const photoId=photoKey(f),cachedPhoto=photoCacheGet(photoId);
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
}else if(ext(f.name)==='pdf'){node=document.createElement('iframe');node.title=f.name;node.src=fileUrl(f.name,true)}else{node=document.createElement(['mp3','ogg'].includes(ext(f.name))?'audio':'video');node.controls=true;node.playsInline=true;node.preload='metadata';node.src='/api/video?'+qs({share:shownShare,path:[shownDir,f.name].filter(Boolean).join('/')});if(ext(f.name)==='mov'){let fallbackOffered=false;node.addEventListener('error',()=>{if(serial!==viewerSerial||fallbackOffered)return;fallbackOffered=true;const hint=document.createElement('div');hint.className='videoFallback';const p=document.createElement('p');p.textContent='Браузер не смог воспроизвести MOV. Можно преобразовать его в совместимый MP4 (первый запуск может занять несколько минут).';const btn=document.createElement('button');btn.textContent='Открыть как MP4';btn.onclick=()=>{btn.disabled=true;p.textContent='Подготавливаем MP4 на Raspberry Pi. Первый запуск может быть долгим…';node.addEventListener('error',()=>{p.textContent='Не удалось преобразовать видео. Возможно, файл слишком большой или кодек не поддерживается. Оригинал можно скачать кнопкой сверху.'},{once:true});node.addEventListener('loadeddata',()=>hint.remove(),{once:true});node.src='/api/mov-mp4?'+qs({share:shownShare,path:[shownDir,f.name].filter(Boolean).join('/'),v:String(f.modified||0)+'-'+String(f.size||0)});node.load();node.play().catch(()=>{});btn.remove()};hint.append(p,btn);box.append(hint)},{once:true})}}box.append(node);renderFilmstrip()}
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
el('mobileHome').onclick=()=>{closeMobileSheet();leaveGlobalGallery();clearSelection();photoCacheClear();dir='';el('search').value='';refresh();window.scrollTo({top:0,behavior:'smooth'})};
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
  {label:'★ Избранное и альбомы',run:()=>openCollections()},
  {label:'Воспоминания',run:()=>openMemories()},
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
  actions.push({label:'＋ Новый альбом',run:async()=>{const name=prompt('Название альбома');if(!name)return;try{const a=await collectionPost('/api/collections/album',{name});await collectionPost('/api/collections/item',{share:f.share,path:f.path,album_id:a.id,enabled:true});message('Альбом создан')}catch(e){alert(e.message)}}});
  openMobileSheet(f.name,actions);
 }catch(e){alert(e.message)}
}
async function openCollections(){
 try{
  const data=await api('/api/collections');
  const actions=[{label:'★ Избранное ('+data.favorites+')',run:()=>openCollectionPhotos(null,true)}];
  for(const a of data.albums)actions.push({label:a.name+' ('+a.count+')',run:()=>openCollectionPhotos(a.id,false)});
  actions.push({label:'＋ Создать альбом',run:async()=>{const name=prompt('Название альбома');if(!name)return;try{await collectionPost('/api/collections/album',{name});openCollections()}catch(e){alert(e.message)}}});
  openMobileSheet('Альбомы',actions);
 }catch(e){alert(e.message)}
}
async function openCollectionPhotos(albumId,favorites){
 try{
  const result=await api('/api/collections/photos?'+qs({favorites:String(favorites),...(favorites?{}:{album_id:String(albumId)}),limit:'120'}));
  if(!allPhotosMode)await enterGlobalGallery();
  allPhotos=result.items;allPhotoTotal=result.items.length;
  allPhotoStatus={complete:true,total:allPhotoTotal,pending:0};
  ++allPhotoScanToken;galleryRenderSignature='';renderAllGallery();
  message(favorites?'Избранное':'Фотографии альбома');
 }catch(e){alert(e.message)}
}
async function openMemories(){
 try{
  const result=await api('/api/gallery/memories');
  if(!result.items.length){openMobileSheet('Воспоминания',[{label:'На эту дату фотографий пока нет',run:()=>{}}]);return}
  if(!allPhotosMode)await enterGlobalGallery();
  allPhotos=result.items;allPhotoTotal=result.items.length;
  allPhotoStatus={complete:true,total:allPhotoTotal,pending:0};
  ++allPhotoScanToken;galleryRenderSignature='';renderAllGallery();
 }catch(e){alert(e.message)}
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
let globalGalleryOrder=localStorage.getItem('nasweb-gallery-order')==='modified'?'modified':'taken';
const orderSelect=el('galleryOrderSelect');
orderSelect.value=globalGalleryOrder;
orderSelect.onchange=()=>setGlobalGalleryOrder(orderSelect.value);
el('gallerySettingsToggle').onclick=()=>gallerySettingsOpen(el('gallerySettingsPanel').classList.contains('hidden'));
el('gallerySettingsClose').onclick=()=>gallerySettingsOpen(false);
el('gallerySearchToggle').onclick=()=>{
  const active=el('app').classList.toggle('gallerySearching');
  if(active)el('search').focus();else{el('search').value='';renderAllGallery()}
};
function mobileNavigateTo(path){
 if(path===dir)return;
 photoCacheClear();clearSelection();dir=path;el('search').value='';
 el('app').classList.remove('filesSearching');
 refresh();window.scrollTo({top:0,behavior:'instant'});
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
 {label:'▦ Плитки',run:()=>el('gridView').click()},
 {label:'☰ Список',run:()=>el('listView').click()},
 {label:'☑ Выбрать файлы',run:()=>el('selectionModeButton').click()},
 {label:'＋ Создать папку',run:()=>el('folder').click()},
 {label:'⟳ Обновить',run:()=>refresh()},
 {label:'◐ Сменить тему',run:()=>el('theme').click()},
 {label:'⇥ Выйти',danger:true,run:()=>el('logout').click()}
]);
function updateMobileNav(){
  const photos=el('mobilePhotos');
  photos.classList.toggle('navSelected',allPhotosMode);
  el('mobileHome').classList.toggle('navSelected',!allPhotosMode);
}
function hideMenu(){el('fileMenu').classList.add('hidden');el('fileMenu').replaceChildren()}
function menuButton(text,fn,danger=false){const btn=document.createElement('button');btn.textContent=text;if(danger)btn.classList.add('danger');btn.onclick=()=>{hideMenu();fn()};return btn}
function openMenu(f,button){
if(isMobileLayout()){
  const actions=[];
  if(f.directory)actions.push({label:'▱ Открыть папку',run:()=>enterFolder(f.name)});
  else{if(canPreview(f))actions.push({label:'▣ Просмотреть',run:()=>openPreview(f)});actions.push({label:'↓ Скачать',run:()=>download(f)})}
  actions.push({label:'✎ Переименовать',run:()=>renameItem(f)});
  actions.push({label:'□ Выделить',run:()=>toggleSelected(f.name)});
  actions.push({label:'× Удалить',danger:true,run:()=>deleteItem(f)});
  openMobileSheet(f.name,actions);return;
}
const menu=el('fileMenu');menu.replaceChildren();if(f.directory)menu.append(menuButton('Открыть',()=>enterFolder(f.name)));else{if(canPreview(f))menu.append(menuButton('Просмотреть',()=>openPreview(f)));menu.append(menuButton('Скачать',()=>download(f)))}menu.append(menuButton('Переименовать',()=>renameItem(f)));menu.append(menuButton('Удалить',()=>deleteItem(f),true));menu.classList.remove('hidden');const rect=button.getBoundingClientRect(),mw=200,mh=190;menu.style.left=Math.max(8,Math.min(rect.left,innerWidth-mw-8))+'px';menu.style.top=(rect.bottom+mh>innerHeight?Math.max(8,rect.top-mh):rect.bottom+5)+'px'}
function sortedFiltered(){let a=items.filter(f=>f.name.toLocaleLowerCase().includes(el('search').value.trim().toLocaleLowerCase()));const sort=el('sort').value;a.sort((x,y)=>Number(y.directory)-Number(x.directory)||(sort==='new'?Number(y.modified||0)-Number(x.modified||0):sort==='size'?Number(y.size)-Number(x.size):x.name.localeCompare(y.name,'ru')));return a}
// Limit simultaneous thumbnail requests so phones don't saturate the NAS.
const thumbQueue=[];let activeThumbs=0;const THUMB_CONCURRENCY=2;
function pumpThumbs(){
  if(previewIndex>=0)return; // Give foreground photo transfer bandwidth priority.
  while(activeThumbs<THUMB_CONCURRENCY && thumbQueue.length){
    thumbQueue.sort((a,b)=>{const ay=a.getBoundingClientRect().top,by=b.getBoundingClientRect().top;return (ay>=0&&ay<innerHeight?0:1)-(by>=0&&by<innerHeight?0:1)||Math.abs(ay)-Math.abs(by)});
    const img=thumbQueue.shift();
    if(!img.isConnected||!img.dataset.src)continue;
    activeThumbs++;
    const done=()=>{activeThumbs--;pumpThumbs()};
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
let galleryRenderSignature='';
function leaveGlobalGallery(){
  galleryRenderSignature='';clearGalleryPick();
  if(!allPhotosMode)return;
  if(previewIndex>=0)closePreview();
  gallerySettingsOpen(false);el('app').classList.remove('gallerySearching');
  allPhotosMode=false;allPhotoScanToken++;view=previousFileView;
  el('app').classList.remove('globalGalleryOpen');
  el('globalGallerySummary').classList.add('hidden');
  el('galleryPageFooter').classList.add('hidden');
  el('search').value='';el('search').placeholder='Поиск файлов и папок…';
  renderBreadcrumb();render();updateMobileNav();
}

function setGlobalGalleryOrder(order){
 if(!['taken','modified'].includes(order)||order===globalGalleryOrder)return;
 globalGalleryOrder=order;localStorage.setItem('nasweb-gallery-order',order);
 el('galleryOrderSelect').value=order;
 allPhotoScanToken++;allPhotos=[];allPhotoTotal=0;galleryRenderSignature='';
 loadGlobalPage(true);
}
async function loadGlobalPage(reset=false){
  if(allPhotoPageBusy||!allPhotosMode)return;
  const token=allPhotoScanToken;
  allPhotoPageBusy=true;
  try{
    const start=reset?0:allPhotos.length;
    const data=await api('/api/gallery?'+qs({offset:start,limit:90,order:globalGalleryOrder}));
    if(!allPhotosMode||token!==allPhotoScanToken)return;
    allPhotoStatus=data;allPhotoTotal=data.total;
    if(reset)allPhotos=data.items;else {
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
      if((!allPhotos.length&&data.total)||steps%8===0){
        if(allPhotos.length<90)await loadGlobalPage(true);
        else renderGlobalProgress();
      }else renderGlobalProgress();
      if(data.complete&&(!data.dates_pending||data.limited)){
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
    +(data.dates_pending&&data.complete?' · EXIF: осталось '+(data.shared_dates_pending??data.dates_pending):'')
    +(data.limited?' · лимит индекса':'');
  el('galleryPageFooter').classList.toggle('hidden',!data.complete||allPhotos.length>=data.total);
}
async function enterGlobalGallery(){
  if(allPhotosMode)return;
  galleryDateGeneration++;clearSelection();
  previousFileView=view==='gallery'?'grid':view;
  gallerySettingsOpen(false);el('app').classList.remove('gallerySearching');
  el('app').classList.remove('filesSearching');
  allPhotosMode=true;view='gallery';allPhotos=[];allPhotoTotal=0;allPhotoStatus=null;
  const token=++allPhotoScanToken;
  el('app').classList.add('globalGalleryOpen');
  el('search').value='';el('search').placeholder='Поиск среди загруженных фото…';
  el('crumb').textContent='Все фотографии';
  el('globalGallerySummary').classList.remove('hidden');
  el('globalGallerySummary').classList.remove('detailsOpen');
  updateMobileNav();render();
  await loadGlobalPage(true);
  if(allPhotosMode&&token===allPhotoScanToken)scanAllPhotos(token);
}
function renderAllGallery(){
  const grid=el('entries');
  const search=el('search').value.trim().toLocaleLowerCase();
  const shown=allPhotos.filter(f=>!search||f.name.toLocaleLowerCase().includes(search)||f.folder.toLocaleLowerCase().includes(search));
  const signature=shown.map(f=>[f.share,f.path,f.modified,f.size,f.taken||''].join('|')).join('\n');
  if(galleryRenderSignature===signature&&grid.classList.contains('galleryMode')&&grid.children.length){
    renderGlobalProgress();pumpThumbs();return;
  }
  galleryRenderSignature=signature;thumbQueue.length=0;
  setGalleryColumns(galleryColumns);photoObserver.takeRecords();
  for(const img of grid.querySelectorAll('img[data-src]'))photoObserver.unobserve(img);
  grid.replaceChildren();grid.classList.remove('list');grid.classList.add('galleryMode');
  if(!allPhotos.length&&!allPhotoStatus){for(let i=0;i<12;i++){const sk=document.createElement('div');sk.className='photoSkeleton';grid.append(sk)}}
  el('galleryYears').classList.remove('hidden');
  el('globalGallerySummary').classList.remove('hidden');
  let month='';
  for(const f of shown){
    const label=globalGalleryOrder==='taken'&&!f.taken?'Дата съёмки неизвестна':photoDay(globalGalleryOrder==='modified'?{...f,taken:null}:f);
    if(label!==month){
      const heading=document.createElement('h3');heading.className='galleryMonth';
      heading.textContent=label;heading.dataset.year=globalGalleryOrder==='taken'&&!f.taken?'Без даты':photoYear(globalGalleryOrder==='modified'?{...f,taken:null}:f);heading.dataset.month=globalGalleryOrder==='taken'&&!f.taken?'':String(photoDate(globalGalleryOrder==='modified'?{...f,taken:null}:f).getMonth()+1).padStart(2,'0');grid.append(heading);month=label;
    }
    const tile=document.createElement('article');tile.className='item galleryPhoto';tile.tabIndex=0;tile.role='button';tile.title=f.share+' / '+f.path;
    tile.setAttribute('aria-label','Открыть '+f.name+' — '+f.share+'/'+f.folder);
    tile.dataset.photoId=galleryId(f);
    tile.onclick=()=>{if(tile.dataset.longPress){delete tile.dataset.longPress;return}if(galleryPickMode)toggleGalleryPick(f);else openPreview(f)};
    let hold=null,sx=0,sy=0;
    tile.addEventListener('touchstart',e=>{if(e.touches.length!==1)return;sx=e.touches[0].clientX;sy=e.touches[0].clientY;hold=setTimeout(()=>{tile.dataset.longPress='1';navigator.vibrate?.(15);openMobileSheet(f.name,[{label:'Выбрать',run:()=>toggleGalleryPick(f)},{label:'Открыть фото',run:()=>openPreview(f)},{label:'★ В избранное / альбом',run:()=>addPhotoToCollection(f)},{label:'Открыть папку',run:()=>{leaveGlobalGallery();selected=f.share;dir=f.folder;renderShares();refresh()}},{label:'Сведения',run:()=>showPhotoDetails(f)},{label:'Скачать',run:()=>{const a=document.createElement('a');a.href='/api/file?'+qs({share:f.share,path:f.path});a.download=f.name;a.click()}}])},550)},{passive:true});
    tile.addEventListener('touchmove',e=>{if(e.touches.length&&Math.hypot(e.touches[0].clientX-sx,e.touches[0].clientY-sy)>12)clearTimeout(hold)},{passive:true});
    tile.addEventListener('touchend',()=>clearTimeout(hold));tile.addEventListener('touchcancel',()=>clearTimeout(hold));
    tile.onkeydown=e=>{if(e.target===tile&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openPreview(f)}};
    const thumb=document.createElement('div');thumb.className='thumb';
    const img=document.createElement('img');img.loading='lazy';img.decoding='async';img.alt='';
    img.onload=()=>img.classList.add('photoLoaded');
    img.onerror=()=>{img.remove();thumb.replaceChildren(icon('image'))};
    img.dataset.src=imageURL(f,false,f.folder,f.share);
    thumb.append(img);tile.append(thumb);
    // The source folder remains available in the photo details panel.

    grid.append(tile);photoObserver.observe(img);
  }
  renderGalleryYears(shown);updateGalleryPick();
  const status=allPhotoStatus;
  el('globalGalleryProgress').textContent=status
    ? (status.complete?'Найдено '+status.total+' фото': 'Поиск фотографий: '+status.scanned+' папок, найдено '+status.total)
      +(status.limited?' · достигнут предел индекса':'')
      +(status.complete&&status.dates_pending?' · EXIF: осталось '+(status.shared_dates_pending??status.dates_pending):'')
    : 'Подготавливаем фототеку…';
  el('galleryPageFooter').classList.toggle('hidden',!status?.complete||allPhotos.length>=allPhotoTotal||!allPhotos.length);
  message(allPhotos.length?'Показано '+shown.length+' из '+allPhotoTotal+' фотографий':'Ищем фотографии во всех доступных папках…');
  pumpThumbs();
}
function render(){updateMobileFilesBreadcrumb();if(allPhotosMode){renderAllGallery();return}thumbQueue.length=0;photoObserver.takeRecords();const grid=el('entries');for(const img of grid.querySelectorAll('img[data-src]'))photoObserver.unobserve(img);grid.replaceChildren();grid.classList.toggle('list',view==='list');grid.classList.toggle('galleryMode',view==='gallery');el('gridView').classList.toggle('active',view==='grid');el('listView').classList.toggle('active',view==='list');el('galleryView').classList.toggle('active',view==='gallery');const shown=view==='gallery'?photoGalleryItems():sortedFiltered();renderGalleryYears(shown);let previousMonth=null;for(const f of shown){if(view==='gallery'){const month=photoDay(f);if(month!==previousMonth){const heading=document.createElement('h3');heading.className='galleryMonth';heading.textContent=month;heading.dataset.year=photoYear(f);grid.append(heading);previousMonth=month}}const tile=document.createElement('article');tile.className='item';if(view==='gallery')tile.classList.add('galleryPhoto');tile.tabIndex=0;tile.role='button';tile.title=f.name;tile.dataset.filename=f.name;
if(f.directory)tile.classList.add('folderTile');else tile.classList.add('fileTile');
tile.onclick=()=>selectionMode?toggleSelected(f.name):openPreview(f);
tile.onkeydown=e=>{if(e.target===tile&&(e.key==='Enter'||e.key===' ')){e.preventDefault();selectionMode?toggleSelected(f.name):openPreview(f)}};
let pressTimer=null,longPressed=false,startX=0,startY=0;
tile.addEventListener('touchstart',e=>{if(e.touches.length!==1)return;longPressed=false;startX=e.touches[0].clientX;startY=e.touches[0].clientY;pressTimer=setTimeout(()=>{longPressed=true;openMenu(f,tile);navigator.vibrate?.(15)},520)},{passive:true});
tile.addEventListener('touchmove',e=>{if(e.touches.length&&Math.hypot(e.touches[0].clientX-startX,e.touches[0].clientY-startY)>12)clearTimeout(pressTimer)},{passive:true});
tile.addEventListener('touchend',()=>clearTimeout(pressTimer));tile.addEventListener('touchcancel',()=>clearTimeout(pressTimer));
tile.addEventListener('contextmenu',e=>{if(e.target.closest('.more'))return;e.preventDefault();openMenu(f,tile)});
tile.addEventListener('click',e=>{if(longPressed){e.stopImmediatePropagation();longPressed=false}},true);
const check=document.createElement('button');check.type='button';check.className='selectionCheck';check.title='Выделить '+f.name;check.setAttribute('aria-label','Выделить '+f.name);check.onclick=e=>{e.stopPropagation();toggleSelected(f.name)};tile.append(check);const thumb=document.createElement('div');thumb.className='thumb';thumb.title=f.directory?'Открыть папку':'Просмотреть файл';if(f.directory)thumb.append(icon('folder'));else if(imageExt.includes(ext(f.name))){const img=document.createElement('img');img.loading='lazy';img.decoding='async';img.alt='';img.onload=()=>img.classList.add('photoLoaded');img.dataset.src=imageURL(f,false,dir,selected);photoObserver.observe(img);img.onerror=()=>{img.remove();thumb.replaceChildren(icon('image'))};thumb.append(img)}else thumb.append(icon(fileKind(f)));tile.append(thumb);const details=document.createElement('div');details.className='details';const title=document.createElement('div');title.className='filename';title.textContent=f.name==='.recycle'?'Корзина':f.name;title.title=f.name;details.append(title);const meta=document.createElement('div');meta.className='filemeta';meta.textContent=f.directory?'':size(f.size);if(!f.directory)details.append(meta);if(view!=='gallery')tile.append(details);const more=document.createElement('button');more.className='more';more.textContent='⋯';more.title='Действия с файлом';more.setAttribute('aria-label','Действия: '+f.name);more.onclick=event=>{event.stopPropagation();openMenu(f,more)};more.onkeydown=event=>event.stopPropagation();tile.append(more);grid.append(tile)}updateSelection();if(!shown.length)message(view==='gallery'?'В этой папке нет фотографий. Переключитесь на плитки, чтобы увидеть файлы и папки.':el('search').value?'Ничего не найдено':'Папка пуста');else message(shown.length+(view==='gallery'?' фотографий':' элементов'))}
async function refresh(){galleryDateGeneration++;if(!selected)return;selectedFiles.clear();selectionMode=false;updateSelection();hideMenu();message('Загрузка…');const share=selected,path=dir;renderBreadcrumb();el('entries').replaceChildren();el('up').disabled=!dir;try{const data=await api('/api/list?'+qs({share,path}));if(share!==selected||path!==dir)return;items=data.items;render();if(view==='gallery')scanGalleryDates()}catch(e){message(e.message)}}
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
async function deleteItem(f){const approved=await askDialog({title:'Удалить '+(f.directory?'папку':'файл')+'?',text:'«'+f.name+'» будет удалён без возможности восстановления.'+(f.directory?' Папка должна быть пустой.':''),confirm:'Удалить',danger:true});if(approved)await mutate('delete',{path:fpath(f.name),directory:f.directory})}
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
function showUploadCenter(){
  const overlay=document.createElement('div');overlay.className='transferOverlay';
  const panel=document.createElement('div');panel.className='transferPanel';
  const title=document.createElement('h3');title.textContent='Центр загрузок';
  const list=document.createElement('div');list.className='transferList';
  const close=document.createElement('button');close.textContent='Закрыть';close.onclick=()=>dismiss();
  function paint(){
    list.replaceChildren();
    for(const job of uploadQueue.slice(-30).reverse()){
      const row=document.createElement('div');row.className='transferRow';
      const name=document.createElement('strong');name.textContent=job.name;
      const state=document.createElement('small');state.textContent=job.status+' · '+job.progress+'%';
      const meter=document.createElement('progress');meter.max=100;meter.value=job.progress;
      row.append(name,state,meter);list.append(row);
    }
  }
  const dismiss=()=>{document.removeEventListener('nas-upload-progress',refresh);overlay.remove()};
  panel.append(title,list,close);overlay.append(panel);overlay.onclick=e=>{if(e.target===overlay)dismiss()};
  document.body.append(overlay);paint();
  const refresh=()=>{if(overlay.isConnected)paint()};
  document.addEventListener('nas-upload-progress',refresh);
}
function updateUploadJob(job,status,progress){
  job.status=status;job.progress=progress;
  document.dispatchEvent(new Event('nas-upload-progress'));
}
function uploadOne(file,target,job){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();const data=new FormData();data.set('share',target.share);data.set('path',target.path);data.set('file',file);xhr.open('POST','/api/upload');xhr.withCredentials=true;xhr.setRequestHeader('X-CSRF-Token',csrf);xhr.upload.onprogress=e=>{if(e.lengthComputable){const progress=Math.round(e.loaded/e.total*100);el('progressFill').style.width=progress+'%';updateUploadJob(job,'Передача',progress)}};xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve():reject(Error('HTTP '+xhr.status));xhr.onerror=()=>reject(Error('Сетевая ошибка'));xhr.send(data)})}
async function uploadFiles(files){
  if(!shares.length||!files.length)return;
  const target=await chooseUploadDestination(files);
  if(!target)return;
  const bar=el('uploadProgress');bar.classList.remove('hidden');
  let success=0;
  const jobs=files.map(file=>({name:file.name,status:'Ожидание',progress:0}));
  uploadQueue.push(...jobs);
  document.dispatchEvent(new Event('nas-upload-progress'));
  for(let i=0;i<files.length;i++){
    const file=files[i],job=jobs[i];updateUploadJob(job,'Подготовка',0);
    message('Загрузка в '+target.share+'/'+target.path+': '+file.name);
    el('progressFill').style.width='0';
    try{await uploadOne(file,target,job);success++;updateUploadJob(job,'Готово',100)}catch(e){updateUploadJob(job,'Ошибка: '+e.message,job.progress);alert('Ошибка загрузки '+file.name+': '+e.message)}
  }
  bar.classList.add('hidden');
  const destination=target.share+'/'+target.path;
  if(allPhotosMode&&success)await loadGlobalPage(true);
  else if(target.share===selected&&target.path===dir)await refresh();
  message('Загружено '+success+' из '+files.length+' в '+destination);
  if(success){
    const open=await askDialog({
      title:'Загрузка завершена',
      text:'Загружено '+success+' из '+files.length+' в '+destination+'. Открыть папку?',
      confirm:'Открыть папку'
    });
    if(open){
      leaveGlobalGallery();
      selected=target.share;dir=target.path;
      el('search').value='';renderShares();
      await refresh();
    }
  }
}
el('togglePassword').onclick=()=>{const password=el('password'),visible=password.type==='password';password.type=visible?'text':'password';el('togglePassword').textContent=visible?'Скрыть':'Показать';password.focus()};
el('loginForm').onsubmit=async e=>{e.preventDefault();++loginGeneration;el('loginError').textContent='';const submit=el('submitLogin');submit.disabled=true;submit.textContent='Проверяем доступ…';try{const form=new FormData();form.set('username',el('username').value);form.set('password',el('password').value);form.set('remember',el('remember').checked?'true':'false');const user=await api('/api/login',{method:'POST',body:form});el('password').value='';showApp(user)}catch(e){el('loginError').textContent=e.message}finally{submit.disabled=false;submit.innerHTML='Войти в NAS Web <span aria-hidden="true">→</span>'}};
el('logout').onclick=async()=>{try{await api('/api/logout',{method:'POST'})}catch{}showLogin()};
el('up').onclick=()=>{if(dir){clearSelection();dir=dir.split('/').slice(0,-1).join('/');refresh()}};
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
  const approved=await askDialog({title:'Удалить выбранные элементы?',text:'В корзину будет перемещено '+targets.length+' элементов, включая содержимое выбранных папок.',confirm:'Удалить '+targets.length,danger:true});
  if(!approved)return;
  let removed=0,failed=0;
  for(const f of targets){
    try{await api('/api/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({share:selected,path:fpath(f.name),directory:f.directory})});removed++}
    catch(e){failed++}
  }
  clearSelection();await refresh();
  if(failed)message('Удалено: '+removed+'. Не удалось удалить: '+failed+'. Проверьте права и содержимое папок.');
};
el('galleryZoomOut').onclick=()=>setGalleryColumns(galleryColumns-1);
el('galleryZoomIn').onclick=()=>setGalleryColumns(galleryColumns+1);
el('galleryMonthJump').onchange=e=>{const [year,month]=e.target.value.split('-');if(year)galleryJumpTo(year,month)};
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
     !allPhotoPageBusy&&allPhotos.length<allPhotoTotal)loadGlobalPage(false);
},{rootMargin:'450px 0px'});
galleryNextObserver.observe(el('galleryLoadMore'));

el('galleryRetryDates').onclick=async()=>{
 const approved=await askDialog({title:'Повторная проверка дат?',text:'Проверим только фотографии без найденной даты. Существующий индекс и уже найденные даты сохранятся. Проверка может идти всю ночь.',confirm:'Начать'});
 if(!approved)return;
 const button=el('galleryRetryDates');button.disabled=true;
 try{
   const result=await api('/api/gallery/retry-dates',{method:'POST'});
   button.textContent='В очереди: '+result.queued+' фото';
   allPhotoStatus=result;
   if(allPhotosMode){const token=++allPhotoScanToken;scanAllPhotos(token)}
 }catch(e){message(e.message)}
 finally{button.disabled=false}
};
el('globalGalleryRescan').onclick=async()=>{
  const approved=await askDialog({title:'Обновить фототеку?',text:'NAS Web заново найдёт фотографии во всех доступных папках. Существующие файлы не изменятся.',confirm:'Обновить'});
  if(!approved||!allPhotosMode)return;
  allPhotoScanToken++;
  try{
    await api('/api/gallery/reindex',{method:'POST'});
    allPhotos=[];allPhotoTotal=0;allPhotoStatus=null;render();
    const token=++allPhotoScanToken;
    await loadGlobalPage(true);
    if(allPhotosMode&&token===allPhotoScanToken)scanAllPhotos(token);
  }catch(e){message(e.message)}
};
el('refresh').onclick=()=>allPhotosMode?el('globalGalleryRescan').click():refresh();el('search').oninput=render;el('sort').onchange=render;
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
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!el('mobileSheetOverlay').classList.contains('hidden'))closeMobileSheet();else if(activeDialog)activeDialog(null);else{closePreview();hideMenu()}}if(el('preview').style.display==='flex'){if(e.key==='ArrowLeft')stepPreview(-1);if(e.key==='ArrowRight')stepPreview(1);if(e.key==='0')setZoom(1);if(e.key==='+')setZoom(zoom*1.25);if(e.key==='-')setZoom(zoom/1.25)}});
document.addEventListener('pointerdown',e=>{if(!el('fileMenu').contains(e.target)&&!e.target.closest('.more'))hideMenu()});
let dragDepth=0;const work=el('workspace');work.addEventListener('dragenter',e=>{e.preventDefault();dragDepth++;work.classList.add('drop')});work.addEventListener('dragover',e=>e.preventDefault());work.addEventListener('dragleave',e=>{e.preventDefault();dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)work.classList.remove('drop')});work.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;work.classList.remove('drop');uploadFiles([...e.dataTransfer.files])});
const theme=localStorage.getItem('nas_theme')||'dark';document.documentElement.dataset.theme=theme;el('theme').onclick=()=>{const t=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=t;localStorage.setItem('nas_theme',t)};
const startupLoginGeneration=loginGeneration;
api('/api/me').then(user=>{if(loginGeneration===startupLoginGeneration)showApp(user)}).catch(()=>{if(loginGeneration===startupLoginGeneration)showLogin()});
