'use strict';
// Test real gallery virtualization functions without requiring the browser DOM.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('nas_web/app/app.js','utf8');
const start = source.indexOf('function galleryVirtualLayout(');
const end = source.indexOf('function galleryVirtualScrollTo(',start);
assert.ok(start>0&&end>start, 'gallery virtual layout and viewport functions found');

function getVirtual(){
  const deps={
    photoDay:f=>new Date(f.taken||f.modified*1000).toISOString().slice(0,10),
    photoYear:f=>new Date(f.taken||f.modified*1000).toISOString().slice(0,4),
    photoDate:f=>new Date(f.taken||f.modified*1000),
  };
  return new Function(...Object.keys(deps),source.slice(start,end)+
    '\nreturn {galleryVirtualLayout,galleryVirtualWindow};')(...Object.values(deps));
}
function photo(day,i){return {name:'p'+i+'.jpg',share:'Photos',path:'p'+i+'.jpg',taken:day};}
const {galleryVirtualLayout:layout,galleryVirtualWindow:windowFor}=getVirtual();
const small=[
  photo('2020-06-21T14:00:00',0),photo('2020-06-21T13:00:00',1),
  photo('2020-06-20T12:00:00',2),photo('2020-06-20T11:00:00',3),
  photo('2020-06-20T10:00:00',4),photo('2020-06-20T09:00:00',5)
];
const simple=layout(small,3,120,3,true);
assert.deepEqual(simple.rows.map(row=>row.kind==='header'?'H':row.photos.length),['H',2,'H',3,1]);
assert.equal(simple.rows[4].headerAt,2);
assert.equal(simple.rows[0].height,40);
assert.equal(simple.rows.filter(r=>r.kind==='photos').reduce((n,r)=>n+r.photos.length,0),small.length);

const all=Array.from({length:10500},(_,i)=>{
  const day=String(1+Math.floor(i/100)%28).padStart(2,'0');
  const month=String(1+Math.floor(i/2800)%12).padStart(2,'0');
  return photo('2020-'+month+'-'+day+'T12:00:00',i);
});
const virtual=layout(all,3,120,3,false);
assert.equal(virtual.rows.filter(r=>r.kind==='header').length,105);
assert.equal(virtual.rows.filter(r=>r.kind==='photos').reduce((n,r)=>n+r.photos.length,0),10500);
assert.equal(virtual.offsets.length,virtual.rows.length+1);
assert.equal(virtual.rows[0].height,44);
const sampleScrolls=[0,500,2200,20000,100000,virtual.offsets.at(-1)-900];
for(const scroll of sampleScrolls){
  const visible=windowFor(virtual.rows,virtual.offsets,150,800,scroll);
  assert.ok(visible.from>=0&&visible.to<=virtual.rows.length&&visible.from<visible.to);
  assert.ok(visible.anchor<=visible.from);
  assert.equal(virtual.rows[visible.anchor].kind,'header');
  assert.ok(visible.to-visible.from<65, 'DOM window is bounded');
  const indices=[...(visible.anchor<visible.from?[visible.anchor]:[]),
    ...Array.from({length:visible.to-visible.from},(_,i)=>i+visible.from)];
  let measured=0,cursor=0,nodes=0;
  for(const index of indices){
    if(index>cursor){
      measured+=virtual.offsets[index]-virtual.offsets[cursor]-3;
      if(nodes)measured+=3;
      nodes++;
    }
    if(nodes)measured+=3;
    measured+=virtual.rows[index].height;nodes++;cursor=index+1;
  }
  if(cursor<virtual.rows.length){
    if(nodes)measured+=3;
    measured+=virtual.offsets[virtual.rows.length]-virtual.offsets[cursor]-3;
    nodes++;
  }
  assert.ok(Math.abs(measured-(virtual.offsets.at(-1)-3))<0.001,
    'virtual placeholders preserve the full gallery height');
}
const wide=layout(all,5,86,2,false);
assert.ok(wide.rows.length<virtual.rows.length);
assert.equal(wide.rows.filter(r=>r.kind==='photos').reduce((n,r)=>n+r.photos.length,0),all.length);
const mixed=[
  photo('2020-06-21T14:00:00',0),
  {...photo(null,1),modified:Date.parse('2020-06-21T12:00:00Z')/1000},
  photo('2020-06-20T12:00:00',2)
];
const mixedRows=layout(mixed,3,120,3,false).rows;
assert.deepEqual(mixedRows.map(row=>row.kind==='header'?'H':row.photos.length),['H',2,'H',1]);
assert.equal(mixedRows[0].label,'2020-06-21');
assert.equal(mixedRows[0].year,'2020');
assert.equal(mixedRows[0].month,'06');
console.log('Virtual gallery dates, 10500 photos, viewport, spacers and column changes OK');
