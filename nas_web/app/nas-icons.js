/* NAS Web UI icons: self-hosted stroke icon set, no font/CDN.
 * Geometry adapted from Lucide (ISC); see ICONS.md. */
'use strict';
window.NASIcons=(()=>{
 const paths={
  folder:'<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z"/>',
  'folder-plus':'<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z"/><path d="M12 12v6m-3-3h6"/>',
  'folder-open':'<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v3"/><path d="M4 20 7 11h15l-4 9H4z"/>',
  file:'<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
  image:'<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m3 17 5-5 4 4 3-3 6 6"/>',
  images:'<rect x="5" y="6" width="16" height="15" rx="2"/><path d="M3 16V5a2 2 0 0 1 2-2h12"/><path d="m5 17 5-5 4 4 2-2 5 5"/>',
  video:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 8 6 4-6 4z"/>',
  play:'<path d="m8 5 12 7-12 7V5z"/>',
  music:'<path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  disk:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M6 15h12M8 18h.01"/>',
  'hard-drive':'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 13h18M7 16h.01M11 16h.01"/>',
  trash:'<path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13M10 11v6m4-6v6"/>',
  'trash-2':'<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  'arrow-left':'<path d="m12 19-7-7 7-7M5 12h14"/>',
  'arrow-right':'<path d="m12 5 7 7-7 7M19 12H5"/>',
  'arrow-up':'<path d="m12 19 0-14m-7 7 7-7 7 7"/>',
  'arrow-down':'<path d="m12 5 0 14m-7-7 7 7 7-7"/>',
  'chevron-left':'<path d="m15 18-6-6 6-6"/>',
  'chevron-right':'<path d="m9 18 6-6-6-6"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  upload:'<path d="M12 16V4m-5 5 5-5 5 5M4 17v4h16v-4"/>',
  'upload-cloud':'<path d="M17.7 18H19a4 4 0 0 0 .4-8 7 7 0 0 0-13.6-1.5A4.6 4.6 0 0 0 6 18h1"/><path d="M12 20V11m-4 4 4-4 4 4"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  minus:'<path d="M5 12h14"/>',
  x:'<path d="M18 6 6 18M6 6l12 12"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  settings:'<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/><path d="M19.4 15a2 2 0 0 0 .4 2.2l-1.6 1.6a2 2 0 0 0-2.2-.4 2 2 0 0 0-1.4 1.8H9.4A2 2 0 0 0 8 18.4a2 2 0 0 0-2.2.4l-1.6-1.6a2 2 0 0 0 .4-2.2A2 2 0 0 0 2.8 13.6v-3.2A2 2 0 0 0 4.6 9a2 2 0 0 0-.4-2.2l1.6-1.6A2 2 0 0 0 8 5.6 2 2 0 0 0 9.4 3.8h5.2A2 2 0 0 0 16 5.6a2 2 0 0 0 2.2-.4l1.6 1.6A2 2 0 0 0 19.4 9a2 2 0 0 0 1.8 1.4v3.2a2 2 0 0 0-1.8 1.4z"/>',
  'more-horizontal':'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  'more-vertical':'<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  refresh:'<path d="M3 11a9 9 0 0 1 15-6l2 2M20 3v4h-4M21 13a9 9 0 0 1-15 6l-2-2M4 21v-4h4"/>',
  'sort-vertical':'<path d="m7 17-4 4-4-4M3 21V4m14 3 4-4 4 4M21 3v17" transform="translate(2 0)"/>',
  'arrow-up-down':'<path d="m7 4 4 4-4 4M11 8H3m14 12-4-4 4-4m-4 4h8"/>',
  'layout-grid':'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  'check-square':'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m7 12 3 3 7-7"/>',
  square:'<rect x="3" y="3" width="18" height="18" rx="2"/>',
  copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  move:'<path d="M12 3v18M3 12h18m-13-5 4-4 4 4m-8 10 4 4 4-4m1-9 4 4-4 4M7 8l-4 4 4 4"/>',
  'file-archive':'<path d="M6 3h8l5 5v13H6zM14 3v5h5M10 11h4m-4 4h4m-4 4h4"/>',
  star:'<path d="m12 2 3.1 6.3 7 1-5.1 5 .9 7-5.9-3.3-5.9 3.3.9-7-5.1-5 7-1z"/>',
  'star-off':'<path d="m12 2 3.1 6.3 7 1-5.1 5 .9 7-5.9-3.3-5.9 3.3.9-7-5.1-5 7-1z"/><path d="M3 3l18 18"/>',
  pencil:'<path d="m3 17 11-11 4 4L7 21H3v-4zM14 6l3-3 4 4-3 3"/>',
  info:'<circle cx="12" cy="12" r="10"/><path d="M12 11v6M12 7h.01"/>',
  alert:'<path d="m12 3 10 18H2L12 3zM12 10v4M12 17h.01"/>',
  'circle-help':'<circle cx="12" cy="12" r="10"/><path d="M9.5 9a3 3 0 1 1 5 2.4c-1.6 1-2.5 1.6-2.5 3M12 17h.01"/>',
  undo:'<path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2"/>',
  home:'<path d="m3 10 9-7 9 7v11h-7v-7h-4v7H3z"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  eye:'<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off':'<path d="m3 3 18 18M10 5.2A12 12 0 0 1 12 5c6.4 0 10 7 10 7a16 16 0 0 1-3.1 3.8M6 6.1C3.5 8.2 2 12 2 12s3.6 7 10 7c1.2 0 2.3-.2 3.4-.6M10 10a3 3 0 0 0 4 4"/>',
  moon:'<path d="M20.5 13A9 9 0 0 1 11 3.5 9 9 0 1 0 20.5 13z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2m10-10h-2M4 12H2m17-7-1.5 1.5M6.5 17.5 5 19m14 0-1.5-1.5M6.5 6.5 5 5"/>',
  link:'<path d="M10 13a5 5 0 0 0 7 .2l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7-.2l-2 2a5 5 0 1 0 7 7l1-1"/>',
  'external-link':'<path d="M15 3h6v6M21 3l-9 9M21 13v7H4V4h7"/>',
  'shield-check':'<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z"/><path d="m9 12 2 2 4-4"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
  'panel-top':'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/>',
  'log-out':'<path d="M10 17l5-5-5-5M15 12H3M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7"/>',
  pause:'<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  'zoom-in':'<circle cx="10.5" cy="10.5" r="7"/><path d="M10.5 7v7m-3.5-3.5h7m7 10-5-5"/>',
  'zoom-out':'<circle cx="10.5" cy="10.5" r="7"/><path d="M7 10.5h7m7 10-5-5"/>'
 };
 const ns='http://www.w3.org/2000/svg';
 function create(name,size=20){
   const svg=document.createElementNS(ns,'svg');
   svg.setAttribute('viewBox','0 0 24 24');
   svg.setAttribute('width',String(size));
   svg.setAttribute('height',String(size));
   svg.setAttribute('fill','none');
   svg.setAttribute('stroke','currentColor');
   svg.setAttribute('stroke-width','1.85');
   svg.setAttribute('stroke-linecap','round');
   svg.setAttribute('stroke-linejoin','round');
   svg.setAttribute('aria-hidden','true');
   svg.setAttribute('focusable','false');
   svg.classList.add('nasIcon');
   svg.innerHTML=paths[name]||paths.file;
   return svg;
 }
 function set(node,name,label){
   if(!node)return node;
   node.replaceChildren();
   node.classList.add('hasNasIcon');
   node.dataset.nasIcon=name;
   node.append(create(name));
   if(label!==null&&label!==undefined&&String(label).length){
     const text=document.createElement('span');
     text.className='nasIconLabel';
     text.textContent=String(label);
     node.append(text);
   }
   return node;
 }
 const prefixes={
  '★':'star','☆':'star-off','＋':'plus','↑':'upload','⇧':'upload','↓':'download','←':'arrow-left',
  '→':'arrow-right','▱':'folder-open','▣':'image','▦':'layout-grid','▧':'images',
  '☰':'list','☑':'check-square','⟳':'refresh','✎':'pencil','□':'square',
  '×':'trash-2','↶':'undo','✓':'check','○':'square','📁':'folder','▶':'play',
  '⋮':'more-vertical','⋯':'more-horizontal'
 };
 function decorateLabel(node,label,fallback='file'){
   const text=String(label);
   const prefix=[...text][0];
   const key=prefixes[prefix];
   const clean=key?text.slice(prefix.length).trimStart():text;
   return set(node,key||fallback,clean);
 }
 const staticButtons={
  togglePassword:['eye','Показать'],submitLogin:['log-out','Войти в NAS Web'],
  desktopFilesNav:['folder','Файлы'],desktopPhotosNav:['images','Фото'],
  theme:['moon',null],logout:['log-out','Выйти'],
  desktopGalleryBack:['arrow-left','Вернуться к файлам'],
  gallerySearchToggle:['search',null],gallerySettingsToggle:['settings',null],gallerySettingsClose:['x',null],
  galleryRetryDates:['refresh','Повторно проверить даты (без сброса)'],
  filesSearchToggle:['search',null],filesSortToggle:['arrow-up-down',null],filesSettingsToggle:['more-vertical',null],
  up:['arrow-left','Назад'],folder:['folder-plus','Папка'],uploadStart:['upload','Загрузить'],
  selectionModeButton:['check-square','Выбрать'],refresh:['refresh',null],
  gridView:['layout-grid',null],listView:['list',null],galleryView:['images',null],
  selectAll:['check-square','Выбрать все'],selectionDownload:['download','Скачать файл'],
  selectionCopy:['copy','Копировать'],selectionMove:['move','Переместить'],
  selectionZip:['file-archive','Скачать ZIP'],selectionDelete:['trash-2','Удалить'],
  selectionCancel:['x','Отмена'],
  galleryStatusToggle:['info','Индексация'],globalGalleryRescan:['refresh','Обновить фототеку'],
  globalGalleryBack:['arrow-left','К файлам'],galleryZoomOut:['zoom-out',null],
  galleryZoomIn:['zoom-in',null],galleryPickDownload:['file-archive','Скачать ZIP'],
  galleryPickDone:['check','Готово'],galleryDatePrev:['chevron-left',null],
  galleryDateNext:['chevron-right',null],galleryYearReset:['arrow-left','Все фото'],
  uploadCenterButton:['upload','Центр загрузок'],galleryLoadMore:['plus','Показать ещё'],
  mobileHome:['home','Файлы'],mobileSearch:['search','Поиск'],mobileAdd:['plus','Добавить'],
  mobilePhotos:['images','Фото'],mobileMore:['more-horizontal','Ещё'],
  mobileSheetClose:['x',null],profileClose:['x',null],profileSave:['check','Сохранить профиль'],
  profileBindFolder:['folder-plus','Привязать папку'],profilePickerClose:['x',null],
  profilePickCancel:['x','Отмена'],profilePickConfirm:['check','Привязать эту папку'],
  profileImportChoose:['folder-open','Выбрать папку'],profileGoogleConnect:['link','Подключить Google'],
  profileGoogleDisconnect:['x','Отключить'],
  profileGooglePickerStart:['images','Выбрать фотографии в Google'],
  profileGoogleImportPicked:['download','Импортировать выбранное'],
  destinationCancel:['x','Отмена'],destinationApply:['check','Копировать сюда'],
  dialogCancel:['x','Отмена'],dialogAccept:['check','Продолжить'],
  previewPhotoMenu:['more-horizontal',null],previewDownload:['download',null],closePreview:['x',null]
 };
 function applyStatic(){
   for(const [id,[name,label]] of Object.entries(staticButtons)){
     const node=document.getElementById(id);
     if(node)set(node,name,label);
   }
   document.querySelectorAll('.logo').forEach(el=>set(el,'hard-drive',null));
   const dialogs=document.getElementById('dialogIcon');
   if(dialogs)set(dialogs,'folder',null);
   const takeout=document.querySelector('.profileImportUpload');
   if(takeout){
     const input=takeout.querySelector('input');
     if(input){
       const text=document.createElement('span');
       text.textContent='Загрузить ZIP-архивы';
       takeout.classList.add('hasNasIcon');
       takeout.replaceChildren(create('upload'),text,input);
     }
   }
   const googlePicker=document.getElementById('profileGooglePickerLink');
   if(googlePicker)set(googlePicker,'external-link','Открыть окно выбора Google Фото');
 }
 function applyAdmin(){
   for(const [id,name,label] of [
      ['create','shield-check','Создать администратора'],
      ['enter','log-out','Войти'],
      ['cacheClean','trash-2','Очистить устаревший кэш'],
      ['retryDates','refresh','Продолжить обработку ожидающих EXIF'],
      ['changePassword','shield-check','Сменить пароль'],
      ['refresh','refresh','Обновить'],
      ['logout','log-out','Выйти']
   ])set(document.getElementById(id),name,label);
   const back=document.getElementById('adminBackToFiles');
   if(back)set(back,'arrow-left','Вернуться к файлам');
 }
 return {create,set,decorateLabel,applyStatic,applyAdmin,paths};
})();
