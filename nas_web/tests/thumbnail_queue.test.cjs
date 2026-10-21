'use strict';
// Regression tests for the actual browser thumbnail scheduler in app.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('nas_web/app/app.js', 'utf8');
const start = source.indexOf('// Limit simultaneous thumbnail requests');
const end = source.indexOf("let galleryRenderSignature='';", start);
assert.ok(start !== -1 && end > start, 'scheduler markers present');
const starts = [];
class MockIntersectionObserver {
  constructor(callback) { this.callback = callback; this.observed = new Set(); }
  observe(img) { this.observed.add(img); }
  unobserve(img) { this.observed.delete(img); }
  takeRecords() { return []; }
  fire(img) { if (this.observed.has(img)) this.callback([{isIntersecting:true,target:img}]); }
}
const context = { previewIndex:-1, innerHeight:600, IntersectionObserver:MockIntersectionObserver };
vm.createContext(context);
vm.runInContext(source.slice(start,end) +
  '\nthis.testing = { thumbQueue, thumbInflight, photoObserver, pumpThumbs, stopDetachedThumbnail, active:()=>activeThumbs };',
  context);
const q = context.testing;
function img(name, top, bottom=top+100) {
  const events = new Map();
  const element = {
    name, dataset:{src:'/thumb/'+name}, isConnected:true, rect:{top,bottom,width:100,height:100},
    getBoundingClientRect() { return this.rect; },
    addEventListener(kind, fn) { events.set(kind, fn); },
    fire(kind) { events.get(kind)?.(); },
    removeAttribute(attr) { if(attr==='src') this._src=''; },
    set src(value) { this._src=value; starts.push(name); },
    get src() { return this._src; },
  };
  return element;
}
// Prefer visible thumbnails over nearby ones; do not request distant tiles.
const far = img('far', 1600), justBelow = img('below', 720),
  visibleTop = img('top', 60), visibleBottom = img('bottom', 440),
  visibleMiddle = img('middle', 250);
q.thumbQueue.push(far, justBelow, visibleBottom, visibleMiddle, visibleTop);
q.pumpThumbs();
assert.deepEqual(starts, ['top', 'middle', 'bottom']);
assert.equal(q.active(), 3);
assert.equal(q.thumbQueue.length, 1);
assert.equal(q.photoObserver.observed.has(far), true);
assert.equal(far.src, undefined);
// A completed request must continue the queued nearby image.
visibleTop.fire('load');
assert.deepEqual(starts, ['top', 'middle', 'bottom', 'below']);
assert.equal(q.active(), 3);
// If a queued image becomes distant before its slot is free, re-observe it.
const stale = img('stale', 280);
q.thumbQueue.push(stale);
stale.rect.top=2200; stale.rect.bottom=2300;
visibleMiddle.fire('load');
assert.equal(stale.src, undefined);
assert.equal(q.photoObserver.observed.has(stale), true);
// Start only after the distant tile re-enters the viewport.
stale.rect.top=100; stale.rect.bottom=200;
q.photoObserver.fire(stale);
assert.equal(stale.src,'/thumb/stale');
// Give the viewer priority while it is open.
const paused=img('paused',30);
context.previewIndex=0;
q.thumbQueue.push(paused);
q.pumpThumbs();
assert.equal(paused.src, undefined);
context.previewIndex=-1;
q.pumpThumbs();
assert.equal(paused.src, undefined); // still 3 in flight
// Cancelled detached tiles free a slot once and don't restart fetching them.
q.stopDetachedThumbnail(stale);
assert.equal(stale.src, '');
assert.equal(q.thumbInflight.has(stale),false);
assert.equal(paused.src, '/thumb/paused');
stale.fire('load');
assert.equal(q.active(), 3);
console.log('Thumbnail visibility, priority, cancellation and viewer bandwidth tests passed');
