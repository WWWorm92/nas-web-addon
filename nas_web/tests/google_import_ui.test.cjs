'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('nas_web/app/index.html','utf8');
const js=fs.readFileSync('nas_web/app/app.js','utf8');
const profileStart=html.indexOf('<div id="profileOverlay"');
const profileEnd=html.indexOf('<div id="destinationOverlay"',profileStart);
assert.ok(profileStart>=0&&profileEnd>profileStart);
const profile=html.slice(profileStart,profileEnd);
const shell=html.slice(0,profileStart);
for(const id of [
  'profileImportTitle','profileImportPath','profileImportChoose','profileTakeoutFiles',
  'profileImportUploadProgress','profileGoogleState','profileGoogleConnect',
  'profileGoogleDisconnect','profileGooglePickerStart','profileGooglePickerLink',
  'profileGoogleImportPicked','profileImportJobsList','profileImportMessage'
]){
  assert.ok(profile.includes('id="'+id+'"'),'missing '+id+' in profile');
  assert.ok(!shell.includes('id="'+id+'"'),'import control leaked into main navigation');
}
assert.ok(js.includes("el('profileImportChoose').onclick=()=>openProfilePicker('import')"),
  'import destination reuses SMB folder picker');
assert.ok(js.includes("new XMLHttpRequest()"),'archive upload reports bytes to profile');
assert.ok(js.includes("xhr.setRequestHeader('X-CSRF-Token',csrf)"),'takeout requires SMB session CSRF');
assert.ok(js.includes("'/api/import/google/takeout?'"),'Takeout endpoint used');
assert.ok(js.includes("'/api/import/google/picker/start'"),'Picker session used');
assert.ok(js.includes("'/api/import/google/picker/import'"),'Picker selected files imported');
assert.ok(js.includes("'/api/import/google/oauth/start'"),'OAuth starts inside profile');
assert.ok(js.includes("googlePickerWaiting"),'Picker status polling available');
console.log('Google Takeout and Google Picker are profile-only; destination, OAuth and progress UI wired OK');
