const $=id=>document.getElementById(id);
let csrf='';
const fmt=n=>n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':n<1073741824?(n/1048576).toFixed(1)+' MB':(n/1073741824).toFixed(2)+' GB';
async function req(url,data,token='',method='POST'){
 const r=await fetch(url,{method:data===undefined?'GET':method,credentials:'same-origin',headers:{'Content-Type':'application/json',...(token?{'X-CSRF-Token':token}:{})},body:data===undefined?undefined:JSON.stringify(data)});
 const d=await r.json();if(!r.ok)throw Error(d.detail||'Ошибка '+r.status);return d;
}
function msg(s){$('message').textContent=s}
async function init(){try{const s=await req('/api/admin/status');$('setup').hidden=s.configured;$('login').hidden=!s.configured;$('dashboard').hidden=true;if(!s.configured&&!s.setup_key_ready)msg('Ключ настройки недоступен серверу. Файл /data/options.json: '+(s.options_file_present?'есть':'отсутствует')+'. Проверьте настройки аддона.');else if(s.authenticated)msg('Для управления войдите с паролем администратора')}catch(e){msg(e.message)}}
$('create').onclick=async()=>{try{await req('/api/admin/setup',{setup_key:$('key').value,password:$('setupPassword').value});$('key').value='';$('setupPassword').value='';msg('Администратор создан');init()}catch(e){msg(e.message)}};
$('enter').onclick=async()=>{try{const r=await req('/api/admin/login',{password:$('password').value});csrf=r.csrf;$('password').value='';$('login').hidden=true;$('dashboard').hidden=false;msg('');await load()}catch(e){msg(e.message)}};
async function load(){try{
 const s=await req('/api/admin/diagnostics');
 $('stats').textContent='Фото в индексе: '+s.gallery_index_rows.toLocaleString('ru')+
 '\nОбщий размер фото: '+fmt(s.gallery_index_bytes)+
 '\nС EXIF-датой: '+s.gallery_dated.toLocaleString('ru')+
 '\nПользователей в индексе: '+s.indexed_users+
 '\nЗадач сканирования: '+s.scan_jobs+' (завершено: '+s.completed_jobs+')'+
 '\nОжидающих папок: '+s.pending_folders+
 '\nОжидающих EXIF: '+s.pending_exif+
 '\nКэш миниатюр: '+s.thumbnail_cache.files+' файлов · '+s.thumbnail_cache.size_mb+' МБ'+
 '\nСвободно в /data: '+fmt(s.data_disk.free)+
 '\nВремя сервера: '+s.server_time;
 await events();
 }catch(e){msg(e.message)}
}
async function events(){try{const d=await req('/api/admin/events');$('events').textContent=d.events.length?d.events.map(x=>new Date(x.time*1000).toLocaleString('ru')+' · '+x.level+' · '+x.message).join('\n'):'Событий обслуживания пока нет'}catch(e){msg(e.message)}}
$('refresh').onclick=load;
$('cacheClean').onclick=async()=>{if(!confirm('Удалить только устаревшие и лишние миниатюры? Фотографии не затрагиваются.'))return;try{await req('/api/admin/cache-maintenance',{},csrf);msg('Обслуживание кэша завершено');await load()}catch(e){msg(e.message)}};
$('retryDates').onclick=async()=>{if(!confirm('Проверить отсутствующие EXIF-даты для текущего SMB-пользователя? Найденные даты и индекс сохраняются.'))return;try{const r=await req('/api/admin/retry-dates',{},csrf);msg('В очередь поставлено: '+r.queued+' фото');await load()}catch(e){msg(e.message)}};
$('changePassword').onclick=async()=>{try{await req('/api/admin/password',{old_password:$('oldPassword').value,new_password:$('newPassword').value},csrf);$('oldPassword').value='';$('newPassword').value='';msg('Пароль изменён, другие административные сессии завершены')}catch(e){msg(e.message)}};
$('logout').onclick=async()=>{try{await req('/api/admin/logout',{},csrf);csrf='';msg('Вы вышли');init()}catch(e){msg(e.message)}};
init();