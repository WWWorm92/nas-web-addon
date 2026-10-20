let csrf='', selected='', dir='', currentUser='', shares=[];
const el=id=>document.getElementById(id);
const message=s=>el('status').textContent=s;
async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',...options,headers:{...(options.headers||{}),'X-CSRF-Token':csrf}});if(!r.ok){let m='HTTP '+r.status;try{m=(await r.json()).detail||m}catch{}throw Error(m)}return r.json()}
function qs(o){return new URLSearchParams(o).toString()}
function showLogin(){el('login').classList.remove('hidden');el('app').classList.add('hidden')}
function showApp(user){csrf=user.csrf;currentUser=user.username;shares=user.shares;el('who').textContent=currentUser;el('login').classList.add('hidden');el('app').classList.remove('hidden');renderShares();if(shares.length)choose(shares[0]);else message('Нет доступных SMB-шар. Проверьте разрешения в Simple NAS.')}
function renderShares(){el('shares').replaceChildren();for(const share of shares){const b=document.createElement('button');b.textContent='📁 '+share;b.className=share===selected?'selected':'';b.onclick=()=>choose(share);el('shares').append(b)}}
function choose(share){selected=share;dir='';renderShares();refresh()}
function path(name){return [dir,name].filter(Boolean).join('/')}
function fileUrl(name,inline=false){return '/api/file?'+qs({share:selected,path:path(name),inline:String(inline)})}
function sz(n){return n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(1)+' MB'}
function type(name){return (name.split('.').pop()||'').toLowerCase()}
function preview(name){const ext=type(name),link=fileUrl(name,true),box=el('previewBody');box.replaceChildren();let node;if(['jpg','jpeg','png','gif','webp'].includes(ext)){node=document.createElement('img');node.src=link}else if(ext==='pdf'){node=document.createElement('iframe');node.src=link}else if(['mp4','webm','mp3','ogg'].includes(ext)){node=document.createElement(ext==='mp3'||ext==='ogg'?'audio':'video');node.src=link;node.controls=true;node.autoplay=true}else if(ext==='txt'){window.open(link,'_blank','noopener');return}else{return download(name)}box.append(node);el('preview').style.display='flex'}
function download(name){const a=document.createElement('a');a.href=fileUrl(name);a.download=name;a.click()}
async function refresh(){if(!selected)return;message('');el('crumb').textContent='📁 '+selected+(dir?' / '+dir.split('/').join(' / '):'');el('entries').replaceChildren();try{const data=await api('/api/list?'+qs({share:selected,path:dir}));const items=data.items.sort((a,b)=>Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name,'ru'));for(const f of items){const tile=document.createElement('div');tile.className='tile';const icon=document.createElement('div');icon.className='icon';if(f.directory){icon.textContent='📁'}else if(['jpg','jpeg','png','gif','webp'].includes(type(f.name))){const img=document.createElement('img');img.src=fileUrl(f.name,true);img.loading='lazy';icon.append(img)}else{icon.textContent=type(f.name)==='pdf'?'📕':'📄'}const title=document.createElement('div');title.className='name';title.textContent=f.name;tile.append(icon,title);const meta=document.createElement('div');meta.className='meta';meta.textContent=f.directory?'Папка':sz(f.size);tile.append(meta);tile.ondblclick=()=>openItem(f);const actions=document.createElement('div');actions.className='actions';if(!f.directory){actions.append(action('👁',()=>preview(f.name)),action('↓',()=>download(f.name)))}else actions.append(action('Открыть',()=>openItem(f)));actions.append(action('✎',()=>renameItem(f)),action('×',()=>deleteItem(f)));tile.append(actions);el('entries').append(tile)}if(!items.length)message('Папка пуста')}catch(e){message(e.message)}}
function action(text,cb){const b=document.createElement('button');b.textContent=text;b.onclick=e=>{e.stopPropagation();cb()};return b}
function openItem(f){if(f.directory){dir=path(f.name);refresh()}else preview(f.name)}
async function mutate(endpoint,payload){try{await api('/api/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({share:selected,...payload})});await refresh()}catch(e){alert(e.message)}}
function renameItem(f){const name=prompt('Новое имя',f.name);if(name&&name!==f.name)mutate('rename',{path:path(f.name),name})}
function deleteItem(f){if(confirm('Удалить «'+f.name+'»? Удаление необратимо.'))mutate('delete',{path:path(f.name),directory:f.directory})}
el('loginForm').onsubmit=async e=>{e.preventDefault();el('loginError').textContent='';try{const body=new FormData();body.set('username',el('username').value);body.set('password',el('password').value);const data=await api('/api/login',{method:'POST',body});el('password').value='';showApp(data)}catch(e){el('loginError').textContent=e.message}};
el('logout').onclick=async()=>{try{await api('/api/logout',{method:'POST'})}catch{}showLogin()};
el('up').onclick=()=>{dir=dir.split('/').slice(0,-1).join('/');refresh()};
el('refresh').onclick=refresh;
el('folder').onclick=()=>{if(!selected)return;const name=prompt('Имя новой папки');if(name)mutate('mkdir',{path:dir,name})};
el('upload').onchange=async e=>{const files=[...e.target.files];for(const file of files){message('Загрузка: '+file.name);const data=new FormData();data.set('share',selected);data.set('path',dir);data.set('file',file);try{await api('/api/upload',{method:'POST',body:data})}catch(ex){alert(file.name+': '+ex.message)}}e.target.value='';refresh()};
el('closePreview').onclick=()=>{el('previewBody').replaceChildren();el('preview').style.display='none'};
api('/api/me').then(showApp).catch(showLogin);