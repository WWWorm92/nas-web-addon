'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('nas_web/app/app.js','utf8');

function extract(start,end,returnValues,globals={}){
 const from=source.indexOf(start),to=source.indexOf(end,from+start.length);
 assert.ok(from>=0&&to>from,'source anchors '+start);
 return new Function(...Object.keys(globals),source.slice(from,to)+'\nreturn {'+returnValues+'};')(...Object.values(globals));
}
const {filePathWithinTrash,fileDropAllowed}=extract(
 'function filePathWithinTrash(', 'function captureFileEntries()',
 'filePathWithinTrash,fileDropAllowed');
const src={share:'Public',folder:'Work',files:[
 {name:'report.pdf',directory:false},{name:'Pictures',directory:true}]};
const allowed={share:'Public',path:'Archive'};
const forbidden=[
 {share:'Private',path:'Archive'},   // no implicit cross-share move
 {share:'Public',path:'Work'},       // no move to source folder
 {share:'Public',path:'Work/Pictures'}, // not inside dragged directory
 {share:'Public',path:'Work/Pictures/2026'},
 {share:'Public',path:'.recycle'},   // trash records must not be bypassed
 {share:'Public',path:'.recycle/old'}
];
assert.equal(fileDropAllowed(src,allowed),true);
for(const target of forbidden)assert.equal(fileDropAllowed(src,target),false,JSON.stringify(target));
assert.equal(fileDropAllowed({share:'Public',folder:'.recycle',files:src.files},allowed),false);
assert.equal(fileDropAllowed({share:'Public',folder:'Work',files:[{name:'.recycle',directory:true}]},allowed),false);
assert.equal(fileDropAllowed({share:'Public',folder:'Work',files:[]},allowed),false);
assert.equal(filePathWithinTrash('.recycle_old'),false);
assert.equal(filePathWithinTrash('.recycle/file'),true);
const {fileKeyboardAction}=extract(
 'function fileKeyboardAction(event){','function fileShortcutsAvailable(event){','fileKeyboardAction');
function event(key,extra={}){return{key,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,isComposing:false,...extra};}
for(const [key,action] of [['a','selectAll'],['c','copy'],['x','cut'],['v','paste']]){
 assert.equal(fileKeyboardAction(event(key,{ctrlKey:true})),action);
 assert.equal(fileKeyboardAction(event(key,{metaKey:true})),action);
 assert.equal(fileKeyboardAction(event(key,{ctrlKey:true,shiftKey:true})),null);
}
for(const [key,action] of [['F2','rename'],['Delete','delete'],['Escape','unselect']]){
 assert.equal(fileKeyboardAction(event(key)),action);
 assert.equal(fileKeyboardAction(event(key,{altKey:true})),null);
}
assert.equal(fileKeyboardAction(event('c')),null);
assert.equal(fileKeyboardAction(event('F2',{isComposing:true})),null);
assert.equal(fileKeyboardAction(event('Backspace')),null);
assert.ok(source.includes("window.matchMedia('(pointer:fine)').matches"),'drag is desktop only');
assert.ok(source.includes("Array.from(e.dataTransfer?.types||[]).includes('Files')"),'external uploads differentiated');
assert.ok(source.includes("folderScrollPositions.get(targetKey)"),'scroll restoration available');
console.log('File-manager shortcuts, same-share drop rules and upload separation OK');
