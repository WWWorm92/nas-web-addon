let csrf='',selected='',dir='',shares=[],items=[],view=localStorage.getItem('nas_view')||'grid',previewIndex=-1;
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
async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',...options,headers:{...(options.headers||{}),'X-CSRF-Token':csrf}});if(!r.ok){let m='HTTP '+r.status;try{m=(await r.json()).detail||m}catch{}if(r.status===401&&url!=='/api/login')showLogin();throw Error(m)}return r.json()}
function showLogin(){hideMenu();closePreview();el('login').classList.remove('hidden');el('app').classList.add('hidden')}
function showApp(user){csrf=user.csrf;shares=user.shares;el('who').textContent=user.username;el('login').classList.add('hidden');el('app').classList.remove('hidden');renderShares();if(shares.length)choose(shares[0]);else message('У пользователя нет доступных SMB-шар.')}
function renderShares(){el('shares').replaceChildren();for(const share of shares){const b=document.createElement('button');b.className='share'+(share===selected?' selected':'');b.append(icon('disk'),document.createTextNode(' '+share));b.onclick=()=>choose(share);el('shares').append(b)}}
function choose(share){hideMenu();selected=share;dir='';el('search').value='';renderShares();refresh()}
function enterFolder(name){hideMenu();dir=fpath(name);el('search').value='';refresh()}
function download(f){const a=document.createElement('a');a.href=fileUrl(f.name);a.download=f.name;a.click()}
const isPhoto=f=>!f.directory&&imageExt.includes(ext(f.name));
let gallery=[],zoom=1,panX=0,panY=0,preloadTimer=null,viewerSerial=0,shownShare='',shownDir='',filmNodes=new Map();
const imageURL=(f,large=false,folder=shownDir,share=shownShare)=>'/api/thumb?'+qs({share,path:[folder,f.name].filter(Boolean).join('/'),v:String(f.modified||0)+'-'+String(f.size||0),large:String(large)});
function previewable(){return items.filter(canPreview)}
function resetZoom(){zoom=1;panX=0;panY=0}
function setZoom(scale,cx=0,cy=0){const img=el('previewBody').querySelector('img');if(!img)return;const prev=zoom;zoom=Math.max(1,Math.min(5,scale));if(zoom===1){panX=panY=0}else if(prev!==zoom){panX+=(cx-panX)*(1-prev/zoom);panY+=(cy-panY)*(1-prev/zoom)}drawZoom()}
function drawZoom(){const img=el('previewBody').querySelector('img');if(!img)return;const bound=el('photoStage').getBoundingClientRect(),w=(img.naturalWidth||bound.width),h=(img.naturalHeight||bound.height),fit=Math.min(bound.width/w,bound.height/h),cw=w*fit,ch=h*fit;panX=Math.max(-Math.max(0,(cw*zoom-bound.width)/2),Math.min(Math.max(0,(cw*zoom-bound.width)/2),panX));panY=Math.max(-Math.max(0,(ch*zoom-bound.height)/2),Math.min(Math.max(0,(ch*zoom-bound.height)/2),panY));img.style.transform='translate('+panX+'px,'+panY+'px) scale('+zoom+')'}
function openPreview(f){if(f.directory)return enterFolder(f.name);filmNodes.clear();if(!canPreview(f))return download(f);shownShare=selected;shownDir=dir;const photos=isPhoto(f);gallery=photos?items.filter(isPhoto):[f];previewIndex=Math.max(0,gallery.findIndex(x=>x.name===f.name));el('preview').style.display='flex';document.body.style.overflow='hidden';showPreview(0)}
function closePreview(){viewerSerial++;clearTimeout(preloadTimer);el('previewBody').replaceChildren();el('preview').style.display='none';el('filmstrip').replaceChildren();previewIndex=-1;gallery=[];filmNodes.clear();resetZoom();document.body.style.overflow=''}
function showPreview(direction=0){if(previewIndex<0||!gallery.length)return;const serial=++viewerSerial,f=gallery[previewIndex],box=el('previewBody');clearTimeout(preloadTimer);resetZoom();box.replaceChildren();el('viewerSpinner').textContent='Загрузка…';el('previewCounter').textContent=(previewIndex+1)+' / '+gallery.length;el('previewTitle').textContent=f.name;el('viewerSpinner').classList.toggle('hidden',!isPhoto(f));el('photoStage').style.touchAction=isPhoto(f)?'none':'auto';let node;if(isPhoto(f)){node=document.createElement('img');node.alt=f.name;node.draggable=false;node.className='arriving';node.style.setProperty('--slide',direction>0?'30px':direction<0?'-30px':'0px');node.onload=()=>{if(serial!==viewerSerial)return;el('viewerSpinner').classList.add('hidden');drawZoom()};node.onerror=()=>{if(serial===viewerSerial)el('viewerSpinner').textContent='Изображение недоступно'};node.src=imageURL(f,false);const high=new Image();high.onload=()=>{if(serial!==viewerSerial)return;node.src=high.src;preloadTimer=setTimeout(preloadNext,400)};high.onerror=()=>{if(serial===viewerSerial)preloadTimer=setTimeout(preloadNext,600)};high.src=imageURL(f,true)}else if(ext(f.name)==='pdf'){node=document.createElement('iframe');node.title=f.name;node.src=fileUrl(f.name,true)}else{node=document.createElement(['mp3','ogg'].includes(ext(f.name))?'audio':'video');node.controls=true;node.playsInline=true;node.preload='metadata';node.src='/api/video?'+qs({share:shownShare,path:[shownDir,f.name].filter(Boolean).join('/')})}box.append(node);renderFilmstrip()}
function renderFilmstrip(){const strip=el('filmstrip');if(gallery.length<2){strip.classList.add('hidden');return}strip.classList.remove('hidden');const from=Math.max(0,previewIndex-5),to=Math.min(gallery.length,previewIndex+6),fragment=document.createDocumentFragment();for(let i=from;i<to;i++){const f=gallery[i];let b=filmNodes.get(i);if(!b){b=document.createElement('button');b.type='button';b.setAttribute('aria-label','Фотография '+(i+1)+' из '+gallery.length);if(isPhoto(f)){const img=document.createElement('img');img.loading='lazy';img.alt='';img.src=imageURL(f);b.append(img)}else{const mark=document.createElement('span');mark.textContent='▣';b.append(mark)}b.onclick=()=>{if(previewIndex!==i){const movement=i>previewIndex?1:-1;previewIndex=i;showPreview(movement)}};filmNodes.set(i,b)}b.classList.toggle('active',i===previewIndex);fragment.append(b)}strip.replaceChildren(fragment);const active=strip.querySelector('button.active');if(active)requestAnimationFrame(()=>active.scrollIntoView({block:'nearest',inline:'center',behavior:'smooth'}))}
function preloadNext(){if(previewIndex<0||!gallery.length||zoom>1)return;const next=gallery[previewIndex+1];if(next&&isPhoto(next)){const image=new Image();image.decoding='async';image.src=imageURL(next,true)}}
function stepPreview(offset){if(zoom>1||!gallery.length)return;const next=previewIndex+offset;if(next<0||next>=gallery.length)return;previewIndex=next;showPreview(offset)}
function hideMenu(){el('fileMenu').classList.add('hidden');el('fileMenu').replaceChildren()}
function menuButton(text,fn,danger=false){const btn=document.createElement('button');btn.textContent=text;if(danger)btn.classList.add('danger');btn.onclick=()=>{hideMenu();fn()};return btn}
function openMenu(f,button){const menu=el('fileMenu');menu.replaceChildren();if(f.directory)menu.append(menuButton('Открыть',()=>enterFolder(f.name)));else{if(canPreview(f))menu.append(menuButton('Просмотреть',()=>openPreview(f)));menu.append(menuButton('Скачать',()=>download(f)))}menu.append(menuButton('Переименовать',()=>renameItem(f)));menu.append(menuButton('Удалить',()=>deleteItem(f),true));menu.classList.remove('hidden');const rect=button.getBoundingClientRect(),mw=200,mh=190;menu.style.left=Math.max(8,Math.min(rect.left,innerWidth-mw-8))+'px';menu.style.top=(rect.bottom+mh>innerHeight?Math.max(8,rect.top-mh):rect.bottom+5)+'px'}
function sortedFiltered(){let a=items.filter(f=>f.name.toLocaleLowerCase().includes(el('search').value.trim().toLocaleLowerCase()));const sort=el('sort').value;a.sort((x,y)=>Number(y.directory)-Number(x.directory)||(sort==='new'?Number(y.modified||0)-Number(x.modified||0):sort==='size'?Number(y.size)-Number(x.size):x.name.localeCompare(y.name,'ru')));return a}
// Limit simultaneous thumbnail requests so phones don't saturate the NAS.
const thumbQueue=[];let activeThumbs=0;const THUMB_CONCURRENCY=3;
function pumpThumbs(){
  while(activeThumbs<THUMB_CONCURRENCY && thumbQueue.length){
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
},{root:null,rootMargin:'100px 0px',threshold:0});
function render(){thumbQueue.length=0;photoObserver.takeRecords();const grid=el('entries');for(const img of grid.querySelectorAll('img[data-src]'))photoObserver.unobserve(img);grid.replaceChildren();grid.classList.toggle('list',view==='list');el('gridView').classList.toggle('active',view==='grid');el('listView').classList.toggle('active',view==='list');const shown=sortedFiltered();for(const f of shown){const tile=document.createElement('article');tile.className='item';tile.tabIndex=0;tile.role='button';tile.title=f.name;tile.onclick=()=>openPreview(f);tile.onkeydown=e=>{if(e.target===tile&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openPreview(f)}};const thumb=document.createElement('div');thumb.className='thumb';thumb.role='button';thumb.tabIndex=0;thumb.title=f.directory?'Открыть папку':'Просмотреть файл';thumb.onclick=()=>openPreview(f);thumb.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openPreview(f)}};if(f.directory)thumb.append(icon('folder'));else if(imageExt.includes(ext(f.name))){const img=document.createElement('img');img.loading='lazy';img.decoding='async';img.alt='';img.dataset.src=imageURL(f,false,dir,selected);photoObserver.observe(img);img.onerror=()=>{img.remove();thumb.replaceChildren(icon('image'))};thumb.append(img)}else thumb.append(icon(fileKind(f)));tile.append(thumb);const details=document.createElement('div');details.className='details';const title=document.createElement('div');title.className='filename';title.textContent=f.name;title.title=f.name;details.append(title);const meta=document.createElement('div');meta.className='filemeta';meta.textContent=f.directory?'Папка':size(f.size);details.append(meta);tile.append(details);const more=document.createElement('button');more.className='more';more.textContent='⋯';more.title='Действия с файлом';more.setAttribute('aria-label','Действия: '+f.name);more.onclick=event=>{event.stopPropagation();openMenu(f,more)};more.onkeydown=event=>event.stopPropagation();tile.append(more);grid.append(tile)}if(!shown.length)message(el('search').value?'Ничего не найдено':'Папка пуста');else message(shown.length+' элементов')}
async function refresh(){if(!selected)return;hideMenu();message('Загрузка…');const share=selected,path=dir;el('crumb').textContent=share+(path?' / '+path.split('/').join(' / '):'');el('entries').replaceChildren();el('up').disabled=!dir;try{const data=await api('/api/list?'+qs({share,path}));if(share!==selected||path!==dir)return;items=data.items;render()}catch(e){message(e.message)}}
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
function uploadOne(file){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();const data=new FormData();data.set('share',selected);data.set('path',dir);data.set('file',file);xhr.open('POST','/api/upload');xhr.withCredentials=true;xhr.setRequestHeader('X-CSRF-Token',csrf);xhr.upload.onprogress=e=>{if(e.lengthComputable)el('progressFill').style.width=(e.loaded/e.total*100).toFixed(0)+'%'};xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve():reject(Error('HTTP '+xhr.status));xhr.onerror=()=>reject(Error('Сетевая ошибка'));xhr.send(data)})}
async function uploadFiles(files){if(!selected||!files.length)return;const bar=el('uploadProgress');bar.classList.remove('hidden');for(const file of files){message('Загрузка: '+file.name);el('progressFill').style.width='0';try{await uploadOne(file)}catch(e){alert('Ошибка загрузки '+file.name+': '+e.message)}}bar.classList.add('hidden');refresh()}
el('togglePassword').onclick=()=>{const password=el('password'),visible=password.type==='password';password.type=visible?'text':'password';el('togglePassword').textContent=visible?'Скрыть':'Показать';password.focus()};
el('loginForm').onsubmit=async e=>{e.preventDefault();el('loginError').textContent='';const submit=el('submitLogin');submit.disabled=true;submit.textContent='Проверяем доступ…';try{const form=new FormData();form.set('username',el('username').value);form.set('password',el('password').value);const user=await api('/api/login',{method:'POST',body:form});el('password').value='';showApp(user)}catch(e){el('loginError').textContent=e.message}finally{submit.disabled=false;submit.innerHTML='Войти в NAS Web <span aria-hidden="true">→</span>'}};
el('logout').onclick=async()=>{try{await api('/api/logout',{method:'POST'})}catch{}showLogin()};
el('up').onclick=()=>{if(dir){dir=dir.split('/').slice(0,-1).join('/');refresh()}};
el('folder').onclick=async()=>{const name=await askDialog({title:'Новая папка',text:'Папка будет создана в текущем расположении.',input:true,confirm:'Создать'});if(name)await mutate('mkdir',{path:dir,name})};
el('refresh').onclick=refresh;el('search').oninput=render;el('sort').onchange=render;
el('gridView').onclick=()=>{view='grid';localStorage.setItem('nas_view',view);render()};
el('listView').onclick=()=>{view='list';localStorage.setItem('nas_view',view);render()};
el('upload').onchange=e=>{uploadFiles([...e.target.files]);e.target.value=''};
el('closePreview').onclick=closePreview;
el('previewDownload').onclick=()=>{if(previewIndex>=0){const f=gallery[previewIndex];const a=document.createElement('a');a.href='/api/file?'+qs({share:shownShare,path:[shownDir,f.name].filter(Boolean).join('/')});a.download=f.name;a.click()}};
let gesture=null,lastTap=0;
const previewArea=el('previewBody');
const dist=(a,b)=>Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
previewArea.addEventListener('touchstart',event=>{
  if(!previewArea.querySelector('img'))return;
  if(event.touches.length===2){
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
    }
  }
},{passive:false});
previewArea.addEventListener('touchend',event=>{
  if(!gesture)return;
  if(gesture.mode==='pinch'){if(event.touches.length===0)gesture=null;else gesture={mode:'finished'};return}
  if(gesture.mode!=='single'||event.changedTouches.length!==1){gesture=null;return}
  const t=event.changedTouches[0],dx=t.clientX-gesture.x,dy=t.clientY-gesture.y;
  const tapped=Math.abs(dx)<12&&Math.abs(dy)<12&&Date.now()-gesture.when<320;
  gesture=null;
  if(tapped){
    const now=Date.now();if(now-lastTap<330){setZoom(zoom>1?1:2.5);lastTap=0}else lastTap=now;
  }else if(zoom===1&&Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.25){
    stepPreview(dx<0?1:-1);
  }
},{passive:true});
previewArea.addEventListener('touchcancel',()=>{gesture=null});
previewArea.addEventListener('dblclick',event=>{if(!previewArea.querySelector('img'))return;setZoom(zoom>1?1:2.5)});
previewArea.addEventListener('wheel',event=>{if(!previewArea.querySelector('img')||!(event.ctrlKey||event.metaKey))return;event.preventDefault();setZoom(zoom*(event.deltaY<0?1.18:.85))},{passive:false});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(activeDialog)activeDialog(null);else{closePreview();hideMenu()}}if(el('preview').style.display==='flex'){if(e.key==='ArrowLeft')stepPreview(-1);if(e.key==='ArrowRight')stepPreview(1);if(e.key==='0')setZoom(1);if(e.key==='+')setZoom(zoom*1.25);if(e.key==='-')setZoom(zoom/1.25)}});
document.addEventListener('pointerdown',e=>{if(!el('fileMenu').contains(e.target)&&!e.target.closest('.more'))hideMenu()});
let dragDepth=0;const work=el('workspace');work.addEventListener('dragenter',e=>{e.preventDefault();dragDepth++;work.classList.add('drop')});work.addEventListener('dragover',e=>e.preventDefault());work.addEventListener('dragleave',e=>{e.preventDefault();dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)work.classList.remove('drop')});work.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;work.classList.remove('drop');uploadFiles([...e.dataTransfer.files])});
const theme=localStorage.getItem('nas_theme')||'dark';document.documentElement.dataset.theme=theme;el('theme').onclick=()=>{const t=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=t;localStorage.setItem('nas_theme',t)};
api('/api/me').then(showApp).catch(showLogin);
