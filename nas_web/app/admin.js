const $=id=>document.getElementById(id);
let csrf='';
const fmt=n=>n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':n<1073741824?(n/1048576).toFixed(1)+' MB':(n/1073741824).toFixed(2)+' GB';
async function req(url,data,token='',method='POST'){
 const r=await fetch(url,{method:data===undefined?'GET':method,credentials:'same-origin',headers:{'Content-Type':'application/json',...(token?{'X-CSRF-Token':token}:{})},body:data===undefined?undefined:JSON.stringify(data)});
 const d=await r.json();if(!r.ok)throw Error(d.detail||'Ошибка '+r.status);return d;
}
function msg(s){$('message').textContent=s}
async function init(){try{const s=await req('/api/admin/status');$('setup').hidden=s.configured;$('login').hidden=!s.configured;$('dashboard').hidden=true;if(!s.configured&&!s.setup_key_ready)msg('Ключ недоступен. Диагностика: '+JSON.stringify(s.options_diagnostic)+'. Скопируйте это сообщение для проверки.');else if(s.authenticated)msg('Для управления войдите с паролем администратора')}catch(e){msg(e.message)}}
$('create').onclick=async()=>{try{await req('/api/admin/setup',{setup_key:$('key').value,password:$('setupPassword').value});$('key').value='';$('setupPassword').value='';msg('Администратор создан');init()}catch(e){msg(e.message)}};
$('enter').onclick=async()=>{try{const r=await req('/api/admin/login',{password:$('password').value});csrf=r.csrf;$('password').value='';$('login').hidden=true;$('dashboard').hidden=false;msg('');await load()}catch(e){msg(e.message)}};
async function load(){try{
 const s=await req('/api/admin/diagnostics');
 $('stats').textContent='Уникальных файлов по SMB-пути: '+s.unique_photo_files.toLocaleString('ru')+
 '\nЗаписей по пользователям: '+s.gallery_index_rows.toLocaleString('ru')+
 '\nОбщий размер записей: '+fmt(s.gallery_index_bytes)+' (возможны дубли)'+
 '\nЗаписей с EXIF-датой: '+s.gallery_dated.toLocaleString('ru')+
 '\nЗаписей проверено без даты: '+s.checked_exif_without_date.toLocaleString('ru')+
 '\nEXIF ждут проверки (все пользователи): '+s.pending_exif_available.toLocaleString('ru')+
 '\nEXIF недоступны по SMB (пауза 24 ч): '+s.pending_exif_denied.toLocaleString('ru')+
 '\nВсего ещё без проверки: '+s.pending_exif.toLocaleString('ru')+
 '\nПользователей в индексе: '+s.indexed_users+
 '\nЗадач обхода папок: '+s.scan_jobs+' (завершено: '+s.completed_jobs+')'+
 '\nОжидающих папок: '+s.pending_folders+
 '\nКэш миниатюр: '+s.thumbnail_cache.files+' файлов · '+s.thumbnail_cache.size_mb+' МБ'+
 '\nСвободно в хранилище аддона: '+fmt(s.data_disk.free)+
 '\nВремя сервера: '+s.server_time;
 $('userStats').textContent=(s.user_indexes||[]).map((u,i)=>
   (u.current?'Текущий SMB-пользователь':u.label||('Индекс '+(i+1)))+
   ': '+u.photos.toLocaleString('ru')+' фото'+
   '\n  с EXIF-датой: '+u.dated.toLocaleString('ru')+
   '\n  проверено без даты: '+u.checked_without_date.toLocaleString('ru')+
   '\n  ожидают EXIF: '+u.actionable.toLocaleString('ru')+
   (u.blocked?' (нет SMB-доступа: '+u.blocked.toLocaleString('ru')+')':'')
 ).join('\n\n')||'Нет пользовательских индексов';
 await events();
 }catch(e){msg(e.message)}
}
async function events(){try{const d=await req('/api/admin/events');$('events').textContent=d.events.length?d.events.map(x=>new Date(x.time*1000).toLocaleString('ru')+' · '+x.level+' · '+x.message).join('\n'):'Событий обслуживания пока нет'}catch(e){msg(e.message)}}
$('refresh').onclick=load;
$('cacheClean').onclick=async()=>{if(!confirm('Удалить только устаревшие и лишние миниатюры? Фотографии не затрагиваются.'))return;try{await req('/api/admin/cache-maintenance',{},csrf);msg('Обслуживание кэша завершено');await load()}catch(e){msg(e.message)}};
$('retryDates').onclick=async()=>{if(!confirm('Продолжить обработку только ожидающих EXIF-даты для текущего SMB-пользователя? Ранее проверенные фотографии не возвращаются в очередь.'))return;try{const r=await req('/api/admin/retry-dates',{},csrf);msg('Ожидают обработки для этого пользователя: '+r.queued+' фото. Файлы с отказом SMB временно пропускаются.');await load()}catch(e){msg(e.message)}};
$('changePassword').onclick=async()=>{try{await req('/api/admin/password',{old_password:$('oldPassword').value,new_password:$('newPassword').value},csrf);$('oldPassword').value='';$('newPassword').value='';msg('Пароль изменён, другие административные сессии завершены')}catch(e){msg(e.message)}};
$('logout').onclick=async()=>{try{await req('/api/admin/logout',{},csrf);csrf='';msg('Вы вышли');init()}catch(e){msg(e.message)}};
NASIcons.applyAdmin();
init();