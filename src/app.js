'use strict';
/* global fabric */

const API = window.api || {};
const toLegacy = (t, v) => (window.LegacyMarathi?.toLegacy ?? ((x) => x))(t, v);
const hasDeva = (t) => (window.LegacyMarathi?.hasDevanagari ? window.LegacyMarathi.hasDevanagari(t) : /[\u0900-\u097F]/.test(t));
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
};
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const fmt = (s) => { s = Math.max(0, s || 0); const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`; };

// ---------- fabric setup ----------
fabric.FabricObject.customProperties = ['anim', 'textStyle', 'kind', 'sourceText', 'fontId', 'color', 'bgMode', 'bgColor', 'effect', 'caps', 'spacing', 'tStart', 'tEnd', 'isBackground', 'hidden', 'locked'];
Object.assign(fabric.InteractiveFabricObject.ownDefaults, {
  cornerStyle: 'circle', cornerColor: '#ffffff', cornerStrokeColor: '#2f81f7', transparentCorners: false,
  cornerSize: 13, borderColor: 'rgba(255,255,255,0.9)', borderScaleFactor: 1.5, padding: 10,
});
// rounded, padded box behind text (Instagram style)
fabric.FabricText.prototype._renderBackground = function (ctx) {
  if (!this.backgroundColor) return;
  const p = this.fontSize * 0.3, w = this.width + p * 2, h = this.height + p;
  ctx.fillStyle = this.backgroundColor;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, this.fontSize * 0.28);
  ctx.fill();
  this._removeShadow(ctx);
};

const baseTextRender = fabric.FabricText.prototype._render;
fabric.FabricText.prototype._render = function (ctx) {
  baseTextRender.call(this, ctx);
  if (!this._caret) return;
  const li = this._textLines.length - 1, lw = this.getLineWidth(li), w = this.width, h = this.height;
  const lh = this.getHeightOfLine(li) / this.lineHeight;
  const x = this.textAlign === 'left' ? -w / 2 + lw : this.textAlign === 'right' ? w / 2 : lw / 2;
  ctx.fillStyle = this.color || '#ffffff';
  ctx.fillRect(x + this.fontSize * 0.05, h / 2 - lh * 1.02, Math.max(2, this.fontSize * 0.06), lh * 0.95);
};

const canvas = new fabric.Canvas('c', {
  preserveObjectStacking: true, stopContextMenu: true,
  selectionColor: 'rgba(47,129,247,0.12)', selectionBorderColor: '#2f81f7',
});

const ZERO = { brightness: 0, contrast: 0, saturation: 0, hue: 0, blur: 0, grayscale: false, sepia: false };
const S = {
  W: 0, H: 0, type: '', url: '', path: '', bg: null, video: null,
  fonts: [], fontById: new Map(), legacyMap: store.get('legacyFonts', {}),
  tool: 'select', colorTarget: 'text', defaultFontId: null, fontFilter: 'all', fontQuery: '',
  recent: store.get('recentColors', []), brush: { mode: 'pen', size: 8, color: '#ffffff' },
  adjust: { ...ZERO }, trimIn: 0, trimOut: 0, history: [], hi: -1, restoring: false,
  exportT: null, animEpoch: 0, music: null, project: null, loading: false, filterName: 'Normal',
};

// ---------- helpers ----------
let toastTimer;
function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
const legacyOf = (f) => (f ? S.legacyMap[f.id] ?? f.legacy ?? null : null);
const isMr = (f) => !!legacyOf(f) || (f.lang || []).includes('mr');
const activeObj = () => canvas.getActiveObject();
const activeText = () => { const o = activeObj(); return o && o.kind === 'text' ? o : null; };
const userObjects = () => canvas.getObjects().filter((o) => !o.isBackground);
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function rgbToHex(r, g, b) { return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''); }
function mix(a, b, t) { const x = hexToRgb(a), y = hexToRgb(b); return rgbToHex(...x.map((v, i) => v + (y[i] - v) * t)); }
function withAlpha(h, a) { const [r, g, b] = hexToRgb(h); return `rgba(${r},${g},${b},${a})`; }
function contrastOf(h) { const [r, g, b] = hexToRgb(h); return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? '#000000' : '#ffffff'; }
function render() { canvas.requestRenderAll(); }

// derive everything fabric draws from the text object's own custom props
function restyle(o) {
  if (o.kind !== 'text') { o.objectCaching = false; return; }
  const f = S.fontById.get(o.fontId);
  const leg = legacyOf(f);
  const t = o.sourceText || '';
  const color = o.color || '#ffffff';
  const fs = o.fontSize;
  o.set({
    text: displayFor(o, t),
    fontFamily: f ? f.family : 'sans-serif',
    charSpacing: !leg && hasDeva(t) ? 0 : (o.spacing || 0),
    fill: o.effect === 'neon' ? mix(color, '#ffffff', 0.6) : color,
    backgroundColor: o.bgMode === 'solid' ? o.bgColor : o.bgMode === 'soft' ? withAlpha(o.bgColor, 0.55) : '',
    shadow: o.effect === 'shadow' ? new fabric.Shadow({ color: 'rgba(0,0,0,0.55)', blur: fs * 0.12, offsetX: fs * 0.03, offsetY: fs * 0.05 })
      : o.effect === 'neon' ? new fabric.Shadow({ color, blur: fs * 0.45 }) : null,
    textAlign: o.textAlign === 'justify' ? 'center' : o.textAlign,
    objectCaching: false,
  });
  o.initDimensions();
  o.setCoords();
}
function displayFor(o, s) {
  const leg = legacyOf(S.fontById.get(o.fontId));
  if (o.caps && !leg) s = s.toUpperCase();
  s = wrapLines(o, s, leg);
  return leg ? toLegacy(s, leg) : s;
}
const measureCtx = document.createElement('canvas').getContext('2d');
function wrapLines(o, s, leg) {
  if (!S.W) return s;
  const f = S.fontById.get(o.fontId);
  const max = (S.W * 0.9) / (o.scaleX || 1);
  measureCtx.font = `${o.fontStyle || 'normal'} ${o.fontWeight || 'normal'} ${o.fontSize}px "${f ? f.family : 'sans-serif'}"`;
  const width = (x) => measureCtx.measureText(leg ? toLegacy(x, leg) : x).width;
  return s.split('\n').map((line) => {
    const out = [];
    let cur = '';
    for (const word of line.split(' ')) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && width(next) > max) { out.push(cur); cur = word; } else cur = next;
    }
    out.push(cur);
    return out.join('\n');
  }).join('\n');
}

// ---------- text animations ----------
const ANIMS = [['none', 'None'], ['typewriter', 'Typewriter'], ['fade', 'Fade'], ['rise', 'Rise'], ['pop', 'Pop'], ['bounce', 'Bounce'], ['glow', 'Glow pulse'], ['shimmer', 'Shimmer'], ['sway', 'Sway']];
const LOOP = { glow: 1.6, shimmer: 2, sway: 2.4 };
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const graphemes = (s) => [...segmenter.segment(s || '')].map((x) => x.segment);
const isAnimated = (o) => o.kind === 'text' && !!o.anim && o.anim !== 'none';
const introDur = (o) => (o.anim === 'typewriter' ? Math.min(4, Math.max(0.6, graphemes(o.sourceText).length * 0.08)) : 0.8);
const cycleOf = (o) => LOOP[o.anim] || introDur(o) + 1.2;
const easeOut = (p) => 1 - (1 - p) ** 3;
const backOut = (p) => 1 + 2.7 * (p - 1) ** 3 + 1.7 * (p - 1) ** 2;
function bounceOut(p) {
  const n = 7.5625, d = 2.75;
  if (p < 1 / d) return n * p * p;
  if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
  if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
  return n * (p -= 2.625 / d) * p + 0.984375;
}
function animTime(o) {
  if (S.exportT != null) return S.exportT;
  if (S.video && !S.video.paused) return S.video.currentTime - (o.tStart ?? 0);
  if (o === activeObj() && !S.editing) return ((performance.now() - S.animEpoch) / 1000) % cycleOf(o);
  return Infinity;
}
function applyAnim(o, t) {
  const save = {};
  const set = (k, v) => { if (!(k in save)) save[k] = o[k]; o[k] = v; };
  const fs = o.fontSize, p = Math.min(1, Math.max(0, t / introDur(o))), loopT = t === Infinity ? null : t;
  switch (o.anim) {
    case 'fade': set('opacity', o.opacity * easeOut(p)); break;
    case 'rise': set('opacity', o.opacity * easeOut(p)); set('top', o.top + (1 - easeOut(p)) * fs * 0.9 * o.scaleY); break;
    case 'pop': { const k = p >= 1 ? 1 : Math.max(0.01, backOut(p)); set('scaleX', o.scaleX * k); set('scaleY', o.scaleY * k); set('opacity', o.opacity * Math.min(1, p * 4)); break; }
    case 'bounce': set('top', o.top - (1 - bounceOut(p)) * fs * 1.4 * o.scaleY); set('opacity', o.opacity * Math.min(1, p * 5)); break;
    case 'typewriter': {
      const g = graphemes(o.sourceText);
      set('text', displayFor(o, g.slice(0, Math.floor(p * g.length + 1e-6)).join('')));
      o._caret = p < 1 && Math.floor(t * 3) % 2 === 0;
      break;
    }
    case 'glow': if (loopT != null) set('shadow', new fabric.Shadow({ color: o.color, blur: fs * (0.08 + 0.42 * (0.5 - 0.5 * Math.cos((2 * Math.PI * loopT) / LOOP.glow))) })); break;
    case 'shimmer': if (loopT != null && typeof o.fill === 'string') {
      const w = o.width, c = (((loopT % LOOP.shimmer) / LOOP.shimmer) * 1.6 - 0.3) * w;
      const band = contrastOf(o.fill) === '#000000' ? '#ffe7a3' : '#ffffff';
      set('fill', new fabric.Gradient({ type: 'linear', gradientUnits: 'pixels', coords: { x1: c - w * 0.22, y1: 0, x2: c + w * 0.22, y2: 0 },
        colorStops: [{ offset: 0, color: o.fill }, { offset: 0.5, color: band }, { offset: 1, color: o.fill }] }));
    } break;
    case 'sway': if (loopT != null) set('angle', o.angle + 6 * Math.sin((2 * Math.PI * loopT) / LOOP.sway)); break;
  }
  if ('text' in save) o.initDimensions();
  return save;
}
let animSaved = [];
canvas.on('before:render', () => {
  animSaved = [];
  for (const o of userObjects()) {
    if (o.visible && isAnimated(o) && o !== S.editing) animSaved.push([o, applyAnim(o, animTime(o))]);
  }
  if (S.editing && S.exportT == null) S.editing._caret = Math.floor(performance.now() / 530) % 2 === 0;
});
canvas.on('after:render', () => {
  for (const [o, save] of animSaved) { Object.assign(o, save); o._caret = false; if ('text' in save) o.initDimensions(); }
  animSaved = [];
  if (S.editing) S.editing._caret = false;
});

function applyFlags(o) {
  o.set({ selectable: !o.locked, evented: !o.locked });
  updateVisibility(o);
}
function inWindow(o, t) {
  return (o.tStart == null || t >= o.tStart) && (o.tEnd == null || t <= o.tEnd);
}
function updateVisibility(only) {
  const t = S.video ? S.video.currentTime : 0;
  (only ? [only] : userObjects()).forEach((o) => { o.visible = !o.hidden && (!S.video || inWindow(o, t)); });
}

// ---------- history ----------
const snap = () => JSON.stringify(userObjects().map((o) => o.toObject()));
function commit() {
  if (S.restoring || !S.W) return;
  const s = snap();
  if (s === S.history[S.hi]) return;
  S.history = S.history.slice(0, S.hi + 1);
  S.history.push(s);
  if (S.history.length > 80) S.history.shift();
  S.hi = S.history.length - 1;
  syncUndo(); markDirty();
}
const commitSoon = debounce(commit, 350);
async function restore(i) {
  if (i < 0 || i >= S.history.length) return;
  S.hi = i; S.restoring = true;
  canvas.discardActiveObject();
  canvas.remove(...userObjects());
  const objs = await fabric.util.enlivenObjects(JSON.parse(S.history[i]));
  objs.forEach((o) => { restyle(o); applyFlags(o); canvas.add(o); });
  S.restoring = false;
  render(); syncUndo(); syncInspector(); markDirty();
}
const undo = () => restore(S.hi - 1);
const redo = () => restore(S.hi + 1);
function syncUndo() {
  $('#undoBtn').disabled = S.hi <= 0;
  $('#redoBtn').disabled = S.hi >= S.history.length - 1;
}

// ---------- media ----------
function fit() {
  if (!S.W) return;
  const st = $('#stage'), ed = !!S.editing;
  st.style.padding = ed ? '112px 76px 132px' : '28px';
  const cs = getComputedStyle(st);
  const aw = st.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const ah = st.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const z = Math.min(aw / S.W, ah / S.H);
  const w = Math.max(1, Math.floor(S.W * z)), h = Math.max(1, Math.floor(S.H * z));
  canvas.setDimensions({ width: w, height: h });
  canvas.setZoom(w / S.W);
  canvas.calcOffset();
  render();
}
new ResizeObserver(fit).observe($('#stage'));

function resetStage() {
  if (S.video) { S.video.pause(); S.video.removeAttribute('src'); S.video.load(); }
  if (S.url) URL.revokeObjectURL(S.url);
  canvas.discardActiveObject();
  canvas.remove(...canvas.getObjects());
  canvas.backgroundColor = '';
  Object.assign(S, { bg: null, video: null, url: '', path: '', type: '', src: null, adjust: { ...ZERO }, history: [], hi: -1 });
}
function startStory(type, w, h) {
  S.type = type; S.W = w; S.H = h;
  document.body.classList.add('has-media');
  $('#videobar').hidden = type !== 'video';
  $('#exportFormat').hidden = type === 'video';
  $('#exportFormat').value = type === 'image' && S.src?.type !== 'image/png' ? 'jpeg' : 'png';
  syncExportUI();
  fit(); commit(); syncAll();
}
async function openFile(file) {
  if (!file) return;
  if (!/^(image|video)\//.test(file.type)) return toast('That file is not a photo or video');
  await leaveProject();
  if (!(await loadMedia(file))) return;
  const kind = S.type === 'video' ? 'video' : 'photo';
  const media = kind === 'photo' ? { bytes: await file.arrayBuffer(), type: file.type, name: file.name } : { path: S.path, type: file.type, name: file.name };
  createProject(kind, file.name.replace(/\.[^.]+$/, '') || 'Untitled story', media);
}
async function loadMedia(file, path) {
  const type = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : '';
  if (!type) { toast('That file is not a photo or video'); return false; }
  const url = URL.createObjectURL(file);
  let el;
  try {
    if (type === 'image') {
      el = new Image(); el.src = url; await el.decode();
    } else {
      el = document.createElement('video');
      el.preload = 'auto'; el.playsInline = true; el.muted = true; el.src = url;
      await new Promise((res, rej) => { el.onloadeddata = res; el.onerror = () => rej(new Error('Could not read this video')); });
      el.width = el.videoWidth; el.height = el.videoHeight;
    }
  } catch (e) {
    URL.revokeObjectURL(url);
    toast(e.message || 'Could not open this file');
    return false;
  }
  const quality = type === 'image' && /jpe?g/.test(file.type) ? window.JpegInfo?.jpegInfo(await file.arrayBuffer())?.quality ?? null : null;
  resetStage();
  S.url = url;
  if (type === 'image') S.src = { type: file.type, size: file.size, quality };
  S.path = path ?? (API.pathForFile ? API.pathForFile(file) : '');
  const w = type === 'image' ? el.naturalWidth : el.videoWidth, h = type === 'image' ? el.naturalHeight : el.videoHeight;
  S.bg = new fabric.FabricImage(el, { left: w / 2, top: h / 2, selectable: false, evented: false, isBackground: true, objectCaching: false, hoverCursor: 'default' });
  canvas.add(S.bg);
  if (type === 'video') {
    S.video = el;
    el.muted = false;
    S.trimIn = 0; S.trimOut = el.duration || 0;
    el.addEventListener('seeked', drawVideoFrame);
    el.addEventListener('play', syncPlay);
    el.addEventListener('pause', syncPlay);
    el.addEventListener('ended', () => { el.currentTime = S.trimIn; el.play(); });
  }
  startStory(type, w, h);
  buildFilterThumbs(el);
  if (type === 'video') buildTimelineThumbs(url);
  return true;
}
async function startBlank(w = 1080, h = 1920, color = '#17151f', asNew = true) {
  if (asNew) await leaveProject();
  resetStage();
  canvas.backgroundColor = color;
  startStory('blank', w, h);
  buildFilterThumbs(null);
  if (asNew) createProject('blank', 'Untitled story', null);
}

// ---------- adjust (filters) ----------
const ADJ = [
  { k: 'brightness', label: 'Brightness', min: -0.5, max: 0.5, step: 0.01 },
  { k: 'contrast', label: 'Contrast', min: -0.5, max: 0.5, step: 0.01 },
  { k: 'saturation', label: 'Saturation', min: -1, max: 1, step: 0.01 },
  { k: 'hue', label: 'Hue', min: -180, max: 180, step: 1 },
  { k: 'blur', label: 'Blur', min: 0, max: 0.5, step: 0.01 },
];
const FILTER_PRESETS = {
  Normal: {},
  Vivid: { saturation: 0.35, contrast: 0.1 },
  Warm: { hue: -8, saturation: 0.15, brightness: 0.03 },
  Cool: { hue: 12, saturation: -0.1 },
  Fade: { contrast: -0.22, brightness: 0.08, saturation: -0.25 },
  Mono: { grayscale: true, contrast: 0.1 },
  Sepia: { sepia: true },
  Dramatic: { contrast: 0.35, saturation: -0.2, brightness: -0.05 },
};
function buildFilters(a) {
  const F = fabric.filters, list = [];
  if (a.brightness) list.push(new F.Brightness({ brightness: a.brightness }));
  if (a.contrast) list.push(new F.Contrast({ contrast: a.contrast }));
  if (a.saturation) list.push(new F.Saturation({ saturation: a.saturation }));
  if (a.hue) list.push(new F.HueRotation({ rotation: a.hue / 180 }));
  if (a.grayscale) list.push(new F.Grayscale());
  if (a.sepia) list.push(new F.Sepia());
  if (a.blur) list.push(new F.Blur({ blur: a.blur }));
  return list;
}
function applyAdjust(original) {
  if (!S.bg) return;
  if (!original) markDirty();
  S.bg.filters = original ? [] : buildFilters(S.adjust);
  S.bg.removeTexture(S.bg.cacheKey);
  S.bg.applyFilters();
  render();
}

function buildFilterThumbs(el) {
  const box = $('#filterPresets');
  const names = Object.keys(FILTER_PRESETS);
  let urls = names.map(() => '');
  if (el) {
    const src = document.createElement('canvas'); src.width = src.height = 120;
    const w = el.naturalWidth || el.videoWidth, h = el.naturalHeight || el.videoHeight, m = Math.min(w, h);
    src.getContext('2d').drawImage(el, (w - m) / 2, (h - m) / 2, m, m, 0, 0, 120, 120);
    urls = names.map((n) => {
      const img = new fabric.FabricImage(src);
      img.filters = buildFilters({ ...ZERO, ...FILTER_PRESETS[n] });
      img.applyFilters();
      const u = img.getElement().toDataURL('image/jpeg', 0.85);
      img.dispose();
      return u;
    });
  }
  box.replaceChildren(...names.map((n, i) => {
    const b = document.createElement('button'); b.className = 'fthumb' + (n === 'Normal' ? ' on' : ''); b.dataset.n = n;
    b.innerHTML = urls[i] ? `<img src="${urls[i]}" alt="${n} filter preview">` : '<span class="ph"></span>';
    b.append(n);
    return b;
  }));
}

// ---------- video ----------
function drawVideoFrame() {
  if (!S.video) return;
  if (S.bg.filters.length) { S.bg.removeTexture(S.bg.cacheKey); S.bg.applyFilters(); }
  updateVisibility();
  canvas.renderAll();
  syncTime();
}
function tick() {
  requestAnimationFrame(tick);
  const v = S.video;
  if (!v || v.paused) {
    const a = activeObj();
    if (S.editing || (a && isAnimated(a))) canvas.renderAll();
    return;
  }
  if (v.currentTime >= S.trimOut - 0.02 || v.currentTime < S.trimIn - 0.3) v.currentTime = S.trimIn;
  drawVideoFrame();
}
requestAnimationFrame(tick);
function togglePlay() {
  const v = S.video; if (!v) return;
  if (v.paused) {
    if (v.currentTime >= S.trimOut - 0.05 || v.currentTime < S.trimIn) v.currentTime = S.trimIn;
    v.play().catch((e) => toast(e.message));
  } else v.pause();
}
function syncPlay() {
  $('#playIcon').setAttribute('d', S.video && !S.video.paused ? 'M6 4h4v16H6zM14 4h4v16h-4z' : 'M7 4l13 8-13 8z');
}
function syncTime() {
  const v = S.video; if (!v) return;
  $('#timeLabel').textContent = fmt(v.currentTime);
  $('#playhead').style.left = `${(v.currentTime / (v.duration || 1)) * 100}%`;
}
function syncVideoUI() {
  const v = S.video; if (!v) return;
  const d = v.duration || 1, a = (S.trimIn / d) * 100, b = (S.trimOut / d) * 100;
  $('#durLabel').textContent = `/ ${fmt(d)}`;
  $('#trimLabel').textContent = `Trim ${fmt(S.trimIn)} to ${fmt(S.trimOut)}  (${(S.trimOut - S.trimIn).toFixed(1)}s)`;
  Object.assign($('#trimBox').style, { left: `${a}%`, width: `${b - a}%` });
  $('#dimL').style.width = `${a}%`;
  $('#dimR').style.width = `${100 - b}%`;
  $('#ruler').innerHTML = [0, 0.25, 0.5, 0.75, 1].map((f) => `<span style="left:${f * 100}%">${fmt(f * d)}</span>`).join('');
  $('#muteWave').style.display = v.muted ? 'none' : '';
  $('#muteBtn').classList.toggle('on', v.muted);
  syncTime(); syncPlay();
}
async function buildTimelineThumbs(url) {
  const cv = $('#thumbStrip'), dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(cv.clientWidth * dpr); cv.height = Math.round(cv.clientHeight * dpr);
  const ctx = cv.getContext('2d');
  const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = url;
  try { await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = rej; }); } catch { return; }
  const tw = cv.height * (v.videoWidth / v.videoHeight), n = Math.ceil(cv.width / tw);
  for (let i = 0; i < n && S.url === url; i++) {
    v.currentTime = Math.min(v.duration - 0.05, ((i + 0.5) * tw / cv.width) * v.duration);
    await new Promise((res) => { v.onseeked = res; });
    ctx.drawImage(v, i * tw, 0, tw, cv.height);
  }
  v.removeAttribute('src'); v.load();
}
function timelineTime(e) {
  const r = $('#timeline').getBoundingClientRect();
  return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (S.video?.duration || 0);
}
{
  const tl = $('#timeline');
  let mode = null;
  const move = (e) => {
    const t = timelineTime(e);
    if (mode === 'seek') S.video.currentTime = Math.min(Math.max(t, 0), S.video.duration);
    else { setTrim(mode, t); S.video.currentTime = mode === 'in' ? S.trimIn : S.trimOut; }
  };
  tl.addEventListener('pointerdown', (e) => {
    if (!S.video) return;
    mode = e.target.id === 'hIn' ? 'in' : e.target.id === 'hOut' ? 'out' : 'seek';
    try { tl.setPointerCapture(e.pointerId); } catch {}
    move(e);
  });
  tl.addEventListener('pointermove', (e) => { if (mode) move(e); });
  tl.addEventListener('pointerup', () => { mode = null; });
}
function setTrim(which, val) {
  const v = S.video; if (!v) return;
  val = Math.min(Math.max(0, +val || 0), v.duration);
  if (which === 'in') S.trimIn = Math.min(val, S.trimOut - 0.1);
  else S.trimOut = Math.max(val, S.trimIn + 0.1);
  syncVideoUI(); markDirty();
}

// ---------- fonts ----------
const PREVIEW_MR = 'अक्षर';
function fontPreview(f) {
  const leg = legacyOf(f);
  if (leg) return toLegacy(PREVIEW_MR, leg);
  return (f.lang || []).includes('mr') ? `Aa ${PREVIEW_MR}` : 'Aa';
}
function fontMatches(f) {
  const q = S.fontQuery.trim().toLowerCase();
  if (q && !`${f.label} ${f.family}`.toLowerCase().includes(q)) return false;
  switch (S.fontFilter) {
    case 'en': return !legacyOf(f) && (f.lang || []).includes('en');
    case 'mr': return isMr(f);
    case 'cal': return ['calligraphy', 'handwriting', 'script'].includes(f.style);
    case 'imp': return f.source === 'imported';
    default: return true;
  }
}
function renderFontGrid() {
  const grid = $('#fontGrid');
  const list = S.fonts.filter(fontMatches);
  grid.replaceChildren(...list.map((f) => {
    const b = document.createElement('button');
    b.className = 'font-card'; b.dataset.id = f.id; b.title = f.label;
    const pv = document.createElement('span'); pv.className = 'pv'; pv.textContent = fontPreview(f); pv.style.fontFamily = `"${f.family}"`;
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = f.label + (f.source === 'imported' ? ' (imported)' : '');
    b.append(pv, nm);
    return b;
  }));
  if (!list.length) grid.innerHTML = `<div class="empty">${S.fonts.length ? 'No fonts match.' : 'Loading fonts...'}</div>`;
  markActiveFont();
}
function markActiveFont() {
  const id = activeText()?.fontId ?? S.defaultFontId;
  $$('.font-card, .fchip').forEach((c) => c.classList.toggle('on', c.dataset.id === id));
}
function renderFontStrip() {
  $('#fontStrip').replaceChildren(...S.fonts.map((f) => {
    const b = document.createElement('button');
    b.className = 'fchip'; b.dataset.id = f.id; b.title = f.label;
    b.textContent = legacyOf(f) ? toLegacy(PREVIEW_MR, legacyOf(f)) : f.label;
    b.style.fontFamily = `"${f.family}"`;
    return b;
  }));
  markActiveFont();
}
function detectDevanagari(f) {
  const ctx = detectDevanagari.ctx ||= document.createElement('canvas').getContext('2d');
  const w = (font) => { ctx.font = font; return ctx.measureText('कखगघ').width; };
  if (Math.abs(w(`40px "${f.family}", monospace`) - w('40px monospace')) > 0.5) {
    f.lang = [...new Set([...(f.lang || []), 'mr'])];
  }
}
async function loadFontFace(f) {
  try {
    const buf = await API.readFont(f.file);
    const face = new FontFace(f.family, buf);
    await face.load();
    document.fonts.add(face);
    fabric.cache.clearFontCache(f.family);
    if (f.source === 'imported') detectDevanagari(f);
    userObjects().forEach((o) => { if (o.fontId === f.id) restyle(o); });
    render();
  } catch (e) {
    console.warn('Font failed to load', f.file, e);
  }
}
async function addFonts(metas, announce) {
  metas = (metas || []).filter((m) => !S.fontById.has(m.id));
  metas.forEach((m) => { S.fonts.push(m); S.fontById.set(m.id, m); });
  if (!S.defaultFontId && S.fonts.length) S.defaultFontId = (S.fonts.find((f) => f.style === 'sans' && !legacyOf(f)) || S.fonts[0]).id;
  renderFontGrid();
  await Promise.all(metas.map(loadFontFace));
  renderFontStrip();
  if (announce && !metas.length) toast('No new fonts found');
  else if (announce) {
    S.fontFilter = 'imp'; syncChips(); renderFontGrid();
    toast(`Imported ${metas.length} font${metas.length > 1 ? 's' : ''}`);
  } else renderFontGrid();
}
function syncChips() { $$('#fontChips button').forEach((b) => b.classList.toggle('on', b.dataset.f === S.fontFilter)); }
function pickFont(styles, mr) {
  const ok = (f) => styles.includes(f.style);
  return S.fonts.find((f) => ok(f) && (mr ? isMr(f) : !legacyOf(f) && (f.lang || []).includes('en')))
    || S.fonts.find(ok);
}
async function importFontPaths(paths) {
  if (!API.importFontPaths) return toast('Font import is not available');
  try { await addFonts(await API.importFontPaths(paths), true); } catch (e) { toast(e.message || 'Could not import fonts'); }
}

// ---------- text ----------
const STYLES = [
  { name: 'Classic', en: 'inter', mr: 'mukta' },
  { name: 'Modern', en: 'bebas-neue', mr: 'teko', caps: true },
  { name: 'Neon', en: 'righteous', mr: 'yatra-one', effect: 'neon' },
  { name: 'Typewriter', en: 'courier-prime', mr: 'kalam' },
  { name: 'Strong', en: 'anton', mr: 'rozha-one', caps: true },
  { name: 'Elegant', en: 'playfair-display-italic', mr: 'tiro-devanagari-marathi' },
  { name: 'Literature', en: 'playfair-display', mr: 'eczar' },
  { name: 'Directional', en: 'inter', mr: 'mukta', fontWeight: 'bold', fontStyle: 'italic', skewX: -12 },
  { name: 'Meme', en: 'anton', mr: 'palanquin-dark', caps: true, meme: true },
  { name: 'Signature', en: 'great-vibes', mr: 'amita' },
  { name: 'Editor', en: 'courier-prime', mr: 'kalam', bgMode: 'solid' },
  { name: 'Bubble', en: 'modak', mr: 'modak' },
  { name: 'Deco', en: 'monoton', mr: 'sarpanch' },
  { name: 'Poster', en: 'abril-fatface', mr: 'yatra-one' },
  { name: 'Squeeze', en: 'bebas-neue', mr: 'khand', lineHeight: 0.82 },
  { name: 'Journal', en: 'caveat', mr: 'kalam' },
];
const styleFont = (st, mr) => S.fontById.get(mr ? st.mr : st.en) || S.fontById.get(st.en);
function applyStyle(name) {
  const o = activeText(); if (!o) return;
  const st = STYLES.find((x) => x.name === name);
  const f = styleFont(st, hasDeva(o.sourceText || ''));
  o.set({
    textStyle: name, effect: st.effect || 'none', bgMode: st.bgMode || 'none', caps: !!st.caps, spacing: 0,
    fontWeight: st.fontWeight || 'normal', fontStyle: st.fontStyle || 'normal', skewX: st.skewX || 0, lineHeight: st.lineHeight || 1.15,
    stroke: st.meme ? '#000000' : null, strokeWidth: st.meme ? o.fontSize * 0.09 : 0,
  });
  if (f) o.fontId = f.id;
  if (st.meme) o.color = '#ffffff';
  if (st.bgMode) { o.bgColor = o.color || '#ffffff'; o.color = contrastOf(o.bgColor); }
  restyle(o); render(); commit(); syncInspector();
  if (S.editing) { syncEditBar(); renderDots(); $('#inlineInput').focus(); }
}
const applyPreset = applyStyle;
function renderStyleChips() {
  const mr = hasDeva(activeText()?.sourceText || '');
  const cur = activeText()?.textStyle;
  for (const box of [$('#styleStrip'), $('#presets')]) {
    box.replaceChildren(...STYLES.map((st) => {
      const b = document.createElement('button'), f = styleFont(st, mr);
      b.className = box.id === 'styleStrip' ? 'schip' : '';
      b.dataset.style = st.name; b.textContent = st.caps ? st.name.toUpperCase() : st.name;
      if (f && !legacyOf(f)) b.style.fontFamily = `"${f.family}"`;
      if (st.fontStyle) b.style.fontStyle = st.fontStyle;
      if (st.fontWeight) b.style.fontWeight = st.fontWeight;
      b.classList.toggle('on', st.name === cur);
      return b;
    }));
  }
}
function setAnim(v) {
  const o = activeText(); if (!o) return;
  o.anim = v; S.animEpoch = performance.now();
  render(); commit(); syncAnimUI();
}
function syncAnimUI() {
  const v = activeText()?.anim || 'none';
  $$('#animChips button, #animStrip button').forEach((b) => b.classList.toggle('on', b.dataset.anim === v));
  $('#eAnimLabel').textContent = v === 'none' ? 'Animate' : ANIMS.find((a) => a[0] === v)[1];
  $('#eAnim').classList.toggle('on', document.body.classList.contains('anim-open'));
}
function addText(initial) {
  if (!S.W) return toast('Open a photo or video first');
  const o = new fabric.FabricText('', {
    left: S.W / 2, top: S.H / 2, fontSize: Math.round(Math.min(S.W, S.H) * 0.09), textAlign: 'center', lineHeight: 1.15,
    strokeWidth: 0, stroke: null, strokeLineJoin: 'round', paintFirst: 'stroke',
    kind: 'text', sourceText: initial ?? 'Tap to type', fontId: S.defaultFontId, color: '#ffffff', bgMode: 'none', bgColor: '#ffffff',
    effect: 'none', caps: false, spacing: 0, tStart: null, tEnd: null, hidden: false, locked: false,
  });
  restyle(o);
  canvas.add(o); canvas.setActiveObject(o);
  setTool('text'); commit();
  if (initial == null) enterEdit(o, true);
}
function addSticker(emoji) {
  if (!S.W) return toast('Open a photo or video first');
  const o = new fabric.FabricText(emoji, {
    left: S.W / 2, top: S.H / 2, fontSize: Math.round(Math.min(S.W, S.H) * 0.16), objectCaching: false,
    kind: 'sticker', hidden: false, locked: false, tStart: null, tEnd: null,
  });
  canvas.add(o); canvas.setActiveObject(o); render(); commit(); syncLayers();
}
function enterEdit(o, selectAll) {
  if (!o || o.kind !== 'text') return;
  if (S.editing && S.editing !== o) exitEdit();
  S.editing = o;
  o.set({ hasControls: false, borderDashArray: [6, 5] });
  canvas.setActiveObject(o);
  document.body.classList.add('editing');
  if (S.tool !== 'text') setTool('text');
  document.body.classList.remove('anim-open');
  renderFontStrip(); renderDots(); renderStyleChips(); syncAnimUI(); syncEditBar(); fit();
  const ta = $('#inlineInput');
  ta.value = o.sourceText || '';
  ta.focus();
  if (selectAll) ta.select(); else ta.setSelectionRange(ta.value.length, ta.value.length);
}
function exitEdit() {
  const o = S.editing; if (!o) return;
  S.editing = null;
  o.set({ hasControls: true, borderDashArray: null });
  document.body.classList.remove('editing');
  $('#inlineInput').blur();
  if (!(o.sourceText || '').trim()) removeObjects([o]); else { commit(); render(); }
  fit(); syncInspector();
}
const ALIGN_PATHS = { left: 'M3 6h18M3 12h10M3 18h14', center: 'M3 6h18M7 12h10M5 18h14', right: 'M3 6h18M11 12h10M7 18h14' };
const fxOf = (o) => (o.effect === 'shadow' || o.effect === 'neon' ? o.effect : o.stroke && o.strokeWidth ? 'outline' : 'none');
function syncEditBar() {
  const o = S.editing; if (!o) return;
  $('#eAlignPath').setAttribute('d', ALIGN_PATHS[o.textAlign] || ALIGN_PATHS.center);
  $('#eBg').className = 'ebtn abtn ' + (o.bgMode || 'none');
  $('#eFxLabel').textContent = { none: 'Effect', shadow: 'Shadow', neon: 'Neon', outline: 'Outline' }[fxOf(o)];
  const fs = $('#sizeV'); fs.max = Math.max(400, Math.round(S.H * 0.4), o.fontSize); fs.value = o.fontSize;
}
function renderDots() {
  const cur = (S.editing && (S.colorTarget === 'bg' ? S.editing.bgColor : S.colorTarget === 'outline' ? S.editing.stroke : S.editing.color)) || '';
  const eye = document.createElement('button');
  eye.className = 'dot eye'; eye.dataset.eye = '1'; eye.setAttribute('aria-label', 'Pick a colour from the picture');
  eye.innerHTML = $('#eyedropper').innerHTML;
  $('#dotStrip').replaceChildren(eye, ...SWATCHES.map((c) => {
    const b = document.createElement('button'); b.className = 'dot' + (c === cur ? ' on' : ''); b.dataset.c = c; b.style.background = c; b.setAttribute('aria-label', c);
    return b;
  }));
}
async function addPhotoSticker(file) {
  if (!file) return;
  if (!S.W) return toast('Open a photo or video first');
  const img = new Image();
  try {
    const raw = new Image(); raw.src = URL.createObjectURL(file); await raw.decode(); URL.revokeObjectURL(raw.src);
    const k = Math.min(1, 1400 / Math.max(raw.naturalWidth, raw.naturalHeight));
    const cv = document.createElement('canvas'); cv.width = Math.round(raw.naturalWidth * k); cv.height = Math.round(raw.naturalHeight * k);
    cv.getContext('2d').drawImage(raw, 0, 0, cv.width, cv.height);
    img.src = /jpe?g/.test(file.type) ? cv.toDataURL('image/jpeg', 0.9) : cv.toDataURL('image/png');
    await img.decode();
  } catch { return toast('Could not read that image'); }
  const o = new fabric.FabricImage(img, { left: S.W / 2, top: S.H / 2, kind: 'photo', hidden: false, locked: false, tStart: null, tEnd: null, objectCaching: false });
  o.scale((Math.min(S.W, S.H) * 0.45) / Math.max(img.naturalWidth, img.naturalHeight));
  canvas.add(o); canvas.setActiveObject(o); render(); commit(); syncLayers();
}
function toArrow(p) {
  const cmds = p.path, first = cmds[0], last = cmds[cmds.length - 1];
  const x1 = first[1], y1 = first[2], x2 = last[last.length - 2], y2 = last[last.length - 1];
  const a = Math.atan2(y2 - y1, x2 - x1), h = Math.max(p.strokeWidth * 3.5, Math.hypot(x2 - x1, y2 - y1) * 0.12);
  const hx = (d) => x2 - h * Math.cos(a + d), hy = (d) => y2 - h * Math.sin(a + d);
  return new fabric.Path(`M ${x1} ${y1} L ${x2} ${y2} M ${hx(0.5)} ${hy(0.5)} L ${x2} ${y2} L ${hx(-0.5)} ${hy(-0.5)}`, {
    stroke: p.stroke, strokeWidth: p.strokeWidth, fill: '', strokeLineCap: 'round', strokeLineJoin: 'round', shadow: p.shadow, objectCaching: false,
  });
}
function editText(fn) {
  const o = activeText(); if (!o) return;
  const wasMr = hasDeva(o.sourceText || '');
  fn(o);
  const st = o.textStyle && STYLES.find((x) => x.name === o.textStyle), mr = hasDeva(o.sourceText || '');
  if (st && mr !== wasMr) { const f = styleFont(st, mr); if (f) o.fontId = f.id; renderStyleChips(); }
  restyle(o); updateVisibility(o); render(); commitSoon(); syncTextHints(o);
  if (S.editing) syncEditBar();
}

// ---------- colours ----------
const SWATCHES = ['#ffffff', '#000000', '#8e8e93', '#ff3b30', '#ff2d55', '#e1306c', '#c13584', '#833ab4',
  '#5851db', '#0095f6', '#00c7be', '#34c759', '#a8e063', '#ffcc00', '#ff9933', '#ff6a00',
  '#d4af37', '#f5d76e', '#b8860b', '#ffd1dc', '#cdb4db', '#bde0fe', '#b9fbc0', '#fff1a8'];
function swatchBtn(c) { const b = document.createElement('button'); b.className = 'sw'; b.style.background = c; b.dataset.c = c; b.title = c; return b; }
function renderRecent() { $('#recentColors').replaceChildren(...S.recent.map(swatchBtn)); }
function pickColor(c, keepRecent) {
  if (!keepRecent) {
    S.recent = [c, ...S.recent.filter((x) => x !== c)].slice(0, 8);
    store.set('recentColors', S.recent); renderRecent();
  }
  $('#customColor').value = c;
  if (S.tool === 'draw') { S.brush.color = c; updateBrush(); return; }
  const o = activeObj();
  if (!recolorable(o)) return;
  setObjColor(o, c); render(); commit();
  if (o.kind !== 'text') return;
  syncInspector();
  if (S.editing) { renderDots(); $('#inlineInput').focus(); }
}
const recolorable = (o) => !!o && ['text', 'drawing', 'fill'].includes(o.kind);
function setObjColor(o, c) {
  if (o.kind === 'drawing') return o.set('stroke', c);
  if (o.kind === 'fill') return o.set('fill', c);
  if (S.colorTarget === 'text') o.color = c;
  else if (S.colorTarget === 'bg') { o.bgColor = c; if (o.bgMode === 'none') o.bgMode = 'solid'; }
  else { o.stroke = c; if (!o.strokeWidth) o.strokeWidth = o.fontSize * 0.04; }
  restyle(o);
}

// eyedropper: sample a snapshot taken without the target, previewing the colour live on it
const EYE_PROPS = ['color', 'bgColor', 'bgMode', 'stroke', 'strokeWidth', 'fill'];
let eyeColor = null, eyeSnap = null, eyeTarget = null, eyeOrig = null;
function startEyedropper() {
  if (!S.W) return;
  canvas.skipControlsDrawing = true;
  const o = S.tool === 'draw' ? null : S.editing || activeObj();
  eyeTarget = recolorable(o) ? o : null;
  if (eyeTarget) { eyeOrig = Object.fromEntries(EYE_PROPS.map((k) => [k, eyeTarget[k]])); eyeTarget.visible = false; }
  canvas.renderAll();
  eyeSnap = canvas.getContext().getImageData(0, 0, canvas.lowerCanvasEl.width, canvas.lowerCanvasEl.height);
  if (eyeTarget) { eyeTarget.visible = true; canvas.renderAll(); }
  $('#eyeLayer').hidden = false;
  $('#eyedropper').classList.add('on');
  toast('Press and drag over the picture, release to pick', 2500);
}
function restoreEyeTarget() {
  if (!eyeTarget) return;
  eyeTarget.set(eyeOrig);
  restyle(eyeTarget);
}
function sampleAt(e) {
  const el = canvas.lowerCanvasEl, r = el.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) * (el.width / r.width)), y = Math.floor((e.clientY - r.top) * (el.height / r.height));
  const loupe = $('#loupe');
  loupe.hidden = false; loupe.style.left = e.clientX + 'px'; loupe.style.top = e.clientY + 'px';
  if (x < 0 || y < 0 || x >= el.width || y >= el.height) {
    eyeColor = null; loupe.style.background = 'transparent'; loupe.firstChild.textContent = '';
    restoreEyeTarget(); render(); return;
  }
  const i = (y * eyeSnap.width + x) * 4, d = eyeSnap.data;
  eyeColor = rgbToHex(d[i], d[i + 1], d[i + 2]);
  loupe.style.background = eyeColor; loupe.firstChild.textContent = eyeColor;
  if (eyeTarget) { setObjColor(eyeTarget, eyeColor); render(); }
}
function endEyedropper(apply) {
  $('#eyeLayer').hidden = true; $('#loupe').hidden = true;
  $('#eyedropper').classList.remove('on');
  canvas.skipControlsDrawing = false;
  restoreEyeTarget();
  eyeTarget = eyeSnap = null;
  if (S.editing) $('#inlineInput').focus();
  if (apply && eyeColor) pickColor(eyeColor);
  render();
}
{
  const layer = $('#eyeLayer');
  let down = false;
  layer.addEventListener('pointerdown', (e) => { down = true; try { layer.setPointerCapture(e.pointerId); } catch {} sampleAt(e); });
  layer.addEventListener('pointermove', (e) => { if (down) sampleAt(e); });
  layer.addEventListener('pointerup', (e) => { if (!down) return; down = false; sampleAt(e); endEyedropper(true); });
}

// ---------- draw ----------
function updateBrush() {
  if (!S.W) return;
  const b = canvas.freeDrawingBrush instanceof fabric.PencilBrush ? canvas.freeDrawingBrush : (canvas.freeDrawingBrush = new fabric.PencilBrush(canvas));
  const unit = Math.max(S.W, S.H) / 600;
  const { size, color } = S.brush, mode = S.brush.mode === 'arrow' ? 'pen' : S.brush.mode;
  b.width = size * unit * (mode === 'marker' ? 2 : 1);
  b.color = mode === 'marker' ? withAlpha(color, 0.5) : mode === 'neon' ? mix(color, '#ffffff', 0.6) : color;
  b.shadow = mode === 'neon' ? new fabric.Shadow({ color, blur: size * unit * 2.5 }) : null;
  b.strokeLineCap = 'round'; b.strokeLineJoin = 'round';
}

// ---------- tools / inspector ----------
function setTool(t) {
  S.tool = t;
  $$('#rail button').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  $$('.panel').forEach((p) => p.classList.toggle('on', p.dataset.panel === t));
  canvas.isDrawingMode = t === 'draw' && !!S.W;
  if (t === 'draw') { canvas.discardActiveObject(); render(); updateBrush(); $('#drawColorSlot').append($('#colorPanel')); }
  else $('#textColorSlot').append($('#colorPanel'));
  $('#colorPanel').hidden = !(t === 'draw' || t === 'text');
  syncInspector();
}
function syncTextHints(o) {
  const f = S.fontById.get(o?.fontId ?? S.defaultFontId);
  const leg = legacyOf(f);
  $('#legacyHint').hidden = !(leg && /[A-Za-z]/.test(o?.sourceText || ''));
  $('#legacyRow').hidden = !(f && f.source === 'imported');
  $('#legacyToggle').checked = !!leg;
  const noSpacing = o && !leg && hasDeva(o.sourceText || '');
  $('#spacing').disabled = !!noSpacing;
  $('#spacingRow').classList.toggle('disabled', !!noSpacing);
  $('#spacingRow').title = noSpacing ? 'Letter spacing breaks Marathi letters in Unicode fonts' : '';
}
function setSeg(sel, v) { $$(`${sel} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === v)); }
function syncInspector() {
  const o = activeText();
  if (o !== S.lastText || document.activeElement !== $('#textInput')) $('#textInput').value = o ? o.sourceText || '' : '';
  S.lastText = o;
  if (o) {
    const fs = $('#fontSize');
    fs.max = Math.max(400, Math.round(S.H * 0.4), o.fontSize);
    fs.value = o.fontSize;
    $('#lineHeight').value = o.lineHeight;
    $('#spacing').value = o.spacing || 0;
    $('#outline').value = o.stroke && o.strokeWidth ? (o.strokeWidth / o.fontSize) * 100 : 0;
    $('#bgModeBtn').textContent = { none: 'None', solid: 'Solid box', soft: 'See-through box' }[o.bgMode || 'none'];
    setSeg('#alignSeg', o.textAlign);
    setSeg('#effectSeg', o.effect || 'none');
    $('#timeRow').hidden = !S.video;
    $('#tStart').value = o.tStart ?? '';
    $('#tEnd').value = o.tEnd ?? '';
  }
  syncTextHints(o);
  markActiveFont();
  renderStyleChips(); syncAnimUI();
  syncLayers();
}
function syncAll() { setTool(S.tool); syncUndo(); syncVideoUI(); }

// ---------- layers ----------
const ICON = {
  up: '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  unlock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>',
  del: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
};
function layerName(o) {
  if (o.kind === 'text') return 'Text: ' + (o.sourceText || '').replace(/\s+/g, ' ').slice(0, 28);
  if (o.kind === 'sticker') return 'Sticker ' + o.text;
  if (o.kind === 'photo') return 'Photo';
  if (o.kind === 'fill') return 'Colour fill';
  return o.kind === 'drawing' ? 'Drawing' : o.type;
}
function syncLayers() {
  if (S.tool !== 'layers') return;
  const list = userObjects().reverse(), act = activeObj();
  const box = $('#layerList');
  if (!list.length) { box.innerHTML = '<p class="hint">No layers yet. Add text, stickers or a drawing.</p>'; return; }
  box.replaceChildren(...list.map((o) => {
    const row = document.createElement('div');
    row.className = 'layer' + (o === act ? ' on' : '') + (o.hidden ? ' dim' : '');
    const name = document.createElement('span'); name.className = 'name'; name.textContent = layerName(o);
    row.append(name);
    row.insertAdjacentHTML('beforeend', `<button data-a="up" title="Bring forward">${ICON.up}</button><button data-a="down" title="Send back">${ICON.down}</button>`
      + `<button data-a="hide" title="${o.hidden ? 'Show' : 'Hide'}">${o.hidden ? ICON.eyeOff : ICON.eye}</button>`
      + `<button data-a="lock" title="${o.locked ? 'Unlock' : 'Lock'}">${o.locked ? ICON.lock : ICON.unlock}</button><button data-a="del" title="Delete">${ICON.del}</button>`);
    row.obj = o;
    return row;
  }));
}
$('#layerList').addEventListener('click', (e) => {
  const row = e.target.closest('.layer'); if (!row) return;
  const o = row.obj, a = e.target.closest('button')?.dataset.a;
  if (a === 'up') canvas.bringObjectForward(o);
  else if (a === 'down') { if (canvas.getObjects().indexOf(o) > (S.bg ? 1 : 0)) canvas.sendObjectBackwards(o); }
  else if (a === 'hide') { o.hidden = !o.hidden; if (o.hidden && activeObj() === o) canvas.discardActiveObject(); applyFlags(o); }
  else if (a === 'lock') { o.locked = !o.locked; if (o.locked && activeObj() === o) canvas.discardActiveObject(); applyFlags(o); }
  else if (a === 'del') removeObjects([o]);
  else if (!o.locked && !o.hidden) canvas.setActiveObject(o);
  render(); commit(); syncInspector();
});

// ---------- object ops ----------
function removeObjects(objs) {
  canvas.discardActiveObject();
  canvas.remove(...objs.filter((o) => !o.isBackground));
  render(); commit(); syncInspector();
}
async function duplicate() {
  const o = activeObj(); if (!o || o instanceof fabric.ActiveSelection) return;
  const c = await o.clone();
  const d = Math.min(S.W, S.H) * 0.03;
  c.set({ left: o.left + d, top: o.top + d });
  restyle(c); applyFlags(c);
  canvas.add(c); canvas.setActiveObject(c); render(); commit(); syncInspector();
}
function nudge(dx, dy) {
  const o = activeObj(); if (!o) return;
  o.set({ left: o.left + dx, top: o.top + dy }); o.setCoords(); render(); commitSoon();
}

// ---------- export ----------
function renderPng(filter, format = 'png', quality = 0.95) {
  const z = canvas.getZoom();
  // +0.5 so the canvas size truncates to exactly the native size despite float error
  return canvas.toDataURL({ format, quality, multiplier: 1 / z, width: (S.W + 0.5) * z, height: (S.H + 0.5) * z, filter });
}
const dataUrlBytes = (u) => Math.round(((u.length - u.indexOf(',') - 1) * 3) / 4);
const fmtBytes = (n) => (n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
// match the source JPEG's quality, then step down (at most 0.1) until within 10% of its file size
function encodeStill(fmt) {
  const keep = (o) => !o.hidden;
  if (fmt === 'png') return renderPng(keep, 'png');
  if (fmt === 'jpeg-max') return renderPng(keep, 'jpeg', 0.95);
  if (!S.src) return renderPng(keep, 'jpeg', 0.9);
  let q = Math.min(0.95, Math.max(0.6, (S.src.quality || 90) / 100));
  const floor = q - 0.1, limit = S.src.size * 1.1;
  let url = renderPng(keep, 'jpeg', q);
  while (dataUrlBytes(url) > limit && q - 0.03 >= floor) { q -= 0.03; url = renderPng(keep, 'jpeg', q); }
  return url;
}
function buildOverlays() {
  const live = userObjects().filter((o) => !o.hidden);
  live.forEach((o) => { o.visible = true; });
  const items = [];
  for (const o of live) {
    const k = `${o.tStart ?? ''}|${o.tEnd ?? ''}`, last = items[items.length - 1];
    if (isAnimated(o)) items.push({ anim: o });
    else if (last && last.k === k) last.objs.add(o);
    else items.push({ k, start: o.tStart ?? null, end: o.tEnd ?? null, objs: new Set([o]) });
  }
  const overlays = [];
  for (const it of items) {
    if (!it.anim) { overlays.push({ png: renderPng((o) => it.objs.has(o)), start: it.start, end: it.end }); continue; }
    const a = it.anim, loop = !!LOOP[a.anim], n = loop ? Math.round(LOOP[a.anim] * 30) : Math.ceil(introDur(a) * 30) + 1;
    const frames = [];
    for (let i = 0; i < n; i++) { S.exportT = i / 30; frames.push(renderPng((o) => o === a)); }
    overlays.push({ frames, fps: 30, start: a.tStart ?? null, end: a.tEnd ?? null, loop });
  }
  S.exportT = null;
  updateVisibility();
  return overlays;
}
async function exportStory() {
  if (!S.W) return toast('Open a photo or video first');
  if (S.editing) exitEdit();
  await saveNow();
  canvas.discardActiveObject(); canvas.renderAll();
  const fmtSel = $('#exportFormat').value, still = S.type !== 'video';
  if (still && fmtSel !== 'mp4') {
    S.exportT = Infinity;
    const url = encodeStill(fmtSel);
    S.exportT = null;
    try {
      const p = await API.saveImage(url, `story.${fmtSel === 'png' ? 'png' : 'jpg'}`);
      if (p) toast(`Saved ${fmtBytes(dataUrlBytes(url))}${S.src ? ` (original ${fmtBytes(S.src.size)})` : ''} to ${p}`, 7000);
    } catch (e) { toast('Export failed: ' + e.message, 8000); }
    return;
  }
  if (!still) { S.video.pause(); if (!S.path) return toast('Could not find the video file on disk'); }
  toast('Preparing export', 2000);
  const bgc = canvas.backgroundColor;
  const background = still ? renderPng((o) => o.isBackground) : null;
  canvas.backgroundColor = '';
  let overlays;
  try { overlays = buildOverlays(); } finally { canvas.backgroundColor = bgc; render(); }
  const music = S.music ? { path: S.music.path, offset: S.music.offset } : undefined;
  const job = still
    ? { still: true, background, duration: +$('#stillDur').value, width: S.W, height: S.H, overlays, music }
    : { input: S.path, trimStart: S.trimIn, trimEnd: S.trimOut, muted: S.video.muted, adjust: { ...S.adjust }, overlays, width: S.W, height: S.H, music };
  setProgress(0);
  $('#exportBtn').disabled = true;
  try {
    const out = await API.exportVideo(job);
    if (out) toast(`Saved to ${out}`, 6000);
  } catch (e) {
    toast('Export failed: ' + (e.message || e), 9000);
  } finally {
    $('#progress').hidden = true;
    $('#exportBtn').disabled = false;
  }
}
function setProgress(f) {
  $('#progress').hidden = false;
  $('#progressFill').style.width = `${Math.round(f * 100)}%`;
  $('#progressText').textContent = `Exporting ${Math.round(f * 100)}%`;
}
API.onExportProgress?.((f) => setProgress(f));

// ---------- wire up UI ----------
$('#openBtn').onclick = $('#welcomeOpen').onclick = () => $('#fileInput').click();
$('#fileInput').onchange = (e) => { openFile(e.target.files[0]); e.target.value = ''; };
$$('.ratio').forEach((b) => { b.onclick = () => startBlank(+b.dataset.w, +b.dataset.h); });
$('#inlineInput').addEventListener('input', (e) => editText((o) => {
  o.sourceText = e.target.value;
  restyle(o);
  const over = (o.width * o.scaleX) / (S.W * 0.9);
  if (over > 1) o.fontSize = Math.max(8, Math.floor(o.fontSize / over));
}));
$('#eDone').onclick = exitEdit;
$('#eAlign').onclick = () => editText((o) => { o.textAlign = { center: 'left', left: 'right', right: 'center' }[o.textAlign] || 'center'; });
$('#eBg').onclick = () => $('#bgModeBtn').click();
$('#eFx').onclick = () => editText((o) => {
  const next = { none: 'shadow', shadow: 'neon', neon: 'outline', outline: 'none' }[fxOf(o)];
  o.effect = next === 'shadow' || next === 'neon' ? next : 'none';
  if (next === 'outline') { o.stroke = contrastOf(o.color || '#ffffff'); o.strokeWidth = o.fontSize * 0.05; } else o.strokeWidth = 0;
});
$('#sizeV').addEventListener('input', (e) => editText((o) => { o.fontSize = +e.target.value; }));
$('#fontStrip').onclick = (e) => { const id = e.target.closest('.fchip')?.dataset.id; if (id) { pickFontId(id); $('#inlineInput').focus(); } };
$('#fontStrip').addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.currentTarget.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
$('#dotStrip').onclick = (e) => {
  const b = e.target.closest('.dot'); if (!b) return;
  if (b.dataset.eye) startEyedropper(); else pickColor(b.dataset.c);
};
$('#editBar').addEventListener('mousedown', (e) => { if (e.target !== $('#sizeV')) e.preventDefault(); });
$('#editDock').addEventListener('mousedown', (e) => e.preventDefault());
$('#undoBtn').onclick = undo;
$('#redoBtn').onclick = redo;
$('#exportBtn').onclick = exportStory;
$$('#rail button').forEach((b) => { b.onclick = () => setTool(b.dataset.tool); });

$('#addText').onclick = () => addText();
$('#textInput').addEventListener('input', (e) => {
  if (!activeText()) return addText(e.target.value);
  editText((o) => { o.sourceText = e.target.value; });
});
$('#fontSize').addEventListener('input', (e) => editText((o) => { o.fontSize = +e.target.value; }));
$('#lineHeight').addEventListener('input', (e) => editText((o) => { o.lineHeight = +e.target.value; }));
$('#spacing').addEventListener('input', (e) => editText((o) => { o.spacing = +e.target.value; }));
$('#outline').addEventListener('input', (e) => editText((o) => {
  o.strokeWidth = (+e.target.value / 100) * o.fontSize;
  if (!o.stroke) o.stroke = '#000000';
}));
$('#alignSeg').onclick = (e) => { const v = e.target.dataset.v; if (v) { editText((o) => { o.textAlign = v; }); setSeg('#alignSeg', v); } };
$('#effectSeg').onclick = (e) => { const v = e.target.dataset.v; if (v) { editText((o) => { o.effect = v; }); setSeg('#effectSeg', v); } };
$('#bgModeBtn').onclick = () => {
  editText((o) => {
    const next = { none: 'solid', solid: 'soft', soft: 'none' }[o.bgMode || 'none'];
    if (o.bgMode === 'none' && next === 'solid' && (o.bgColor || '#ffffff') === o.color) o.color = contrastOf(o.bgColor || '#ffffff');
    o.bgMode = next;
  });
  syncInspector();
};
$('#colorTarget').onclick = (e) => { const v = e.target.dataset.v; if (v) { S.colorTarget = v; setSeg('#colorTarget', v); } };
for (const id of ['#presets', '#styleStrip']) $(id).addEventListener('click', (e) => { const n = e.target.closest('[data-style]')?.dataset.style; if (n) applyStyle(n); });
for (const id of ['#animChips', '#animStrip']) {
  $(id).append(...ANIMS.map(([v, label]) => { const b = document.createElement('button'); b.dataset.anim = v; b.textContent = label; if (id === '#animStrip') b.className = 'schip'; return b; }));
  $(id).addEventListener('click', (e) => { const v = e.target.closest('[data-anim]')?.dataset.anim; if (v) { setAnim(v); if (S.editing) $('#inlineInput').focus(); } });
}
$('#eAnim').onclick = () => { document.body.classList.toggle('anim-open'); syncAnimUI(); };
$('#exportFormat').onchange = () => { syncExportUI(); markDirty(); };
$('#stillDur').onchange = markDirty;
function syncExportUI() { $('#stillDur').hidden = S.type === 'video' || $('#exportFormat').value !== 'mp4'; }
$('#musicBtn').onclick = () => $('#musicInput').click();
$('#musicInput').onchange = (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  const path = API.pathForFile ? API.pathForFile(f) : '';
  if (!path) return toast('Could not find that song on disk');
  S.music = { path, name: f.name, offset: 0 }; syncMusic();
};
$('#musicOffset').onchange = (e) => { if (S.music) { S.music.offset = Math.max(0, +e.target.value || 0); markDirty(); } };
$('#musicRemove').onclick = () => { S.music = null; syncMusic(); };
function syncMusic() {
  $('#musicBtn').hidden = !!S.music; $('#musicPill').hidden = !S.music;
  if (S.music) { $('#musicName').textContent = S.music.name.replace(/\.[^.]+$/, ''); $('#musicPill').title = S.music.name; $('#musicOffset').value = S.music.offset; }
  markDirty();
}
$('#photoBtn').onclick = () => $('#photoInput').click();
$('#photoInput').onchange = (e) => { addPhotoSticker(e.target.files[0]); e.target.value = ''; };
document.addEventListener('paste', (e) => {
  if (/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (item) { e.preventDefault(); addPhotoSticker(item.getAsFile()); }
});
$('#fillBtn').onclick = () => {
  if (!S.W) return toast('Open a photo or video first');
  const r = new fabric.Rect({ left: S.W / 2, top: S.H / 2, width: S.W, height: S.H, fill: S.brush.color, kind: 'fill', hidden: false, locked: false, tStart: null, tEnd: null, objectCaching: false });
  canvas.add(r); canvas.moveObjectTo(r, S.bg ? 1 : 0); render(); commit(); syncLayers();
};

$('#fontChips').onclick = (e) => { const f = e.target.dataset.f; if (f) { S.fontFilter = f; syncChips(); renderFontGrid(); } };
$('#fontSearch').addEventListener('input', (e) => { S.fontQuery = e.target.value; renderFontGrid(); });
function pickFontId(id) {
  S.defaultFontId = id;
  const o = activeText();
  if (o) { o.fontId = id; o.textStyle = null; restyle(o); render(); commit(); }
  syncInspector();
}
$('#fontGrid').onclick = (e) => { const id = e.target.closest('.font-card')?.dataset.id; if (id) pickFontId(id); };
async function runImport(fn) {
  if (!fn) return toast('Font import is not available');
  try {
    const metas = await fn();
    if (metas) await addFonts(metas, true);
  } catch (e) { toast(e.message || 'Could not import fonts'); }
}
$('#importFonts').onclick = () => runImport(API.importFonts);
$('#importFolder').onclick = () => runImport(API.importFontFolder);
$('#legacyToggle').onchange = (e) => {
  const f = S.fontById.get(activeText()?.fontId ?? S.defaultFontId); if (!f) return;
  if (e.target.checked) S.legacyMap[f.id] = 'ams'; else delete S.legacyMap[f.id];
  store.set('legacyFonts', S.legacyMap);
  userObjects().forEach((o) => { if (o.fontId === f.id) restyle(o); });
  render(); renderFontGrid(); renderFontStrip(); syncInspector();
};
$('#tStart').onchange = (e) => editText((o) => { o.tStart = e.target.value === '' ? null : +e.target.value; });
$('#tEnd').onchange = (e) => editText((o) => { o.tEnd = e.target.value === '' ? null : +e.target.value; });
$('#tStartNow').onclick = () => { editText((o) => { o.tStart = +S.video.currentTime.toFixed(2); }); syncInspector(); };
$('#tEndNow').onclick = () => { editText((o) => { o.tEnd = +S.video.currentTime.toFixed(2); }); syncInspector(); };
$('#tClear').onclick = () => { editText((o) => { o.tStart = o.tEnd = null; }); updateVisibility(); syncInspector(); };

$('#swatches').append(...SWATCHES.map(swatchBtn));
renderRecent();
$('#colorPanel').addEventListener('click', (e) => { const c = e.target.dataset?.c; if (c) pickColor(c); });
$('#customColor').addEventListener('change', (e) => pickColor(e.target.value));
$('#eyedropper').onclick = startEyedropper;

$('#brushMode').onclick = (e) => { const v = e.target.dataset.v; if (v) { S.brush.mode = v; setSeg('#brushMode', v); updateBrush(); } };
$('#brushSize').addEventListener('input', (e) => { S.brush.size = +e.target.value; updateBrush(); });

const STICKERS = ['🙏', '🌸', '🚩', '🪔', '✨', '❤️', '🔥', '😍', '🎉', '⭐', '🌼', '🕉️', '🎶', '💐', '👑', '🌟', '🎂', '🎁', '💛', '🥳', '🌺', '🙌', '💯', '😊', '🌙'];
$('#stickerGrid').append(...STICKERS.map((s) => { const b = document.createElement('button'); b.textContent = s; b.onclick = () => addSticker(s); return b; }));

$('#adjustSliders').append(...ADJ.map((a) => {
  const l = document.createElement('label'); l.className = 'slider';
  l.innerHTML = `<span>${a.label}</span><input type="range" min="${a.min}" max="${a.max}" step="${a.step}" value="0" data-k="${a.k}">`;
  return l;
}));
$('#adjustSliders').addEventListener('input', (e) => { const k = e.target.dataset.k; if (k) { S.adjust[k] = +e.target.value; applyAdjust(); } });
function syncAdjust() { $$('#adjustSliders input').forEach((i) => { i.value = S.adjust[i.dataset.k]; }); }
$('#filterPresets').onclick = (e) => {
  const b = e.target.closest('.fthumb'); if (!b) return;
  if (!S.bg) return toast('Open a photo or video first');
  S.filterName = b.dataset.n;
  S.adjust = { ...ZERO, ...FILTER_PRESETS[b.dataset.n] }; syncAdjust(); applyAdjust();
  $$('.fthumb').forEach((x) => x.classList.toggle('on', x === b));
};
buildFilterThumbs(null);
{
  const cmp = $('#compareBtn');
  const off = () => { if (cmp.classList.contains('on')) { cmp.classList.remove('on'); applyAdjust(); } };
  cmp.addEventListener('pointerdown', () => { if (S.bg) { cmp.classList.add('on'); applyAdjust(true); } });
  cmp.addEventListener('pointerup', off);
  cmp.addEventListener('pointerleave', off);
}
$('#adjustReset').onclick = () => { S.adjust = { ...ZERO }; S.filterName = 'Normal'; syncAdjust(); applyAdjust(); markFilterThumb(); };

$('#playBtn').onclick = togglePlay;
$('#setIn').onclick = () => setTrim('in', S.video?.currentTime);
$('#setOut').onclick = () => setTrim('out', S.video?.currentTime);
$('#muteBtn').onclick = () => { if (S.video) { S.video.muted = !S.video.muted; syncVideoUI(); markDirty(); } };

// canvas events
canvas.on('selection:created', onSelect);
canvas.on('selection:updated', onSelect);
canvas.on('selection:cleared', () => { if (S.editing) exitEdit(); syncInspector(); });
function onSelect() {
  S.animEpoch = performance.now();
  if (S.editing && activeObj() !== S.editing) { const t = activeText(); exitEdit(); if (t) enterEdit(t); return; }
  if (activeText() && S.tool !== 'text' && S.tool !== 'layers') setTool('text');
  else syncInspector();
}
canvas.on('object:modified', (e) => { guides.v = guides.h = false; if (e.target?.kind === 'text') restyle(e.target); commit(); syncInspector(); });
canvas.on('path:created', (e) => {
  if (S.brush.mode === 'arrow' && e.path.path.length > 1) { canvas.remove(e.path); e.path = toArrow(e.path); canvas.add(e.path); }
  Object.assign(e.path, { kind: 'drawing', hidden: false, locked: false, tStart: null, tEnd: null }); commit(); syncLayers(); });
canvas.on('mouse:dblclick', (e) => {
  if (e.target?.kind === 'text') enterEdit(e.target);
});
canvas.on('mouse:up', () => {
  if (S.editing) setTimeout(() => $('#inlineInput').focus());
  if (guides.v || guides.h) { guides.v = guides.h = false; render(); }
});

// snapping
const guides = { v: false, h: false };
canvas.on('object:moving', (e) => {
  const t = e.target, th = 6 / canvas.getZoom(), c = t.getCenterPoint();
  guides.v = Math.abs(c.x - S.W / 2) < th;
  guides.h = Math.abs(c.y - S.H / 2) < th;
  if (guides.v || guides.h) { t.setPositionByOrigin(new fabric.Point(guides.v ? S.W / 2 : c.x, guides.h ? S.H / 2 : c.y), 'center', 'center'); t.setCoords(); }
});
canvas.on('object:rotating', (e) => {
  const t = e.target, a = ((t.angle % 360) + 360) % 360;
  const s = [0, 45, 90, 180, 270, 315, 360].find((x) => Math.abs(a - x) < 4);
  if (s !== undefined) { t.rotate(s % 360); t.setCoords(); }
});
canvas.on('after:render', ({ ctx }) => {
  if ((!guides.v && !guides.h) || ctx !== canvas.getContext()) return;
  const r = canvas.getRetinaScaling(), z = canvas.getZoom() * r;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.strokeStyle = '#ff2bd6'; ctx.lineWidth = 1.5 * r;
  ctx.beginPath();
  if (guides.v) { ctx.moveTo((S.W / 2) * z, 0); ctx.lineTo((S.W / 2) * z, S.H * z); }
  if (guides.h) { ctx.moveTo(0, (S.H / 2) * z); ctx.lineTo(S.W * z, (S.H / 2) * z); }
  ctx.stroke(); ctx.restore();
});

// keyboard
document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) && document.activeElement.type !== 'range';
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (e.key === 'Escape' && !$('#eyeLayer').hidden) return endEyedropper(false);
  if (S.editing && (e.key === 'Escape' || (mod && e.key === 'Enter'))) { e.preventDefault(); return exitEdit(); }
  if (mod && k === 'o') { e.preventDefault(); return $('#fileInput').click(); }
  if (mod && k === 's') { e.preventDefault(); if (S.project) saveNow().then(() => toast('Saved', 1500)); return; }
  if (mod && k === 'e') { e.preventDefault(); return exportStory(); }
  if (mod && k === 'z' && !typing) { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
  if (mod && k === 'y' && !typing) { e.preventDefault(); return redo(); }
  if (typing) return;
  if (mod && k === 'd') { e.preventDefault(); return duplicate(); }
  if (e.key === 'Delete' || e.key === 'Backspace') { const a = canvas.getActiveObjects(); if (a.length) { e.preventDefault(); removeObjects(a); } return; }
  if (e.key === ' ' && S.video) { e.preventDefault(); return togglePlay(); }
  if (!mod && !e.altKey) {
    const tool = { v: 'select', t: 'text', d: 'draw', s: 'stickers', a: 'adjust', l: 'layers' }[k];
    if (tool) return setTool(tool);
    if (S.video && k === 'i') return setTrim('in', S.video.currentTime);
    if (S.video && k === 'o') return setTrim('out', S.video.currentTime);
    if (S.video && k === 'm') return $('#muteBtn').click();
  }
  const step = (e.shiftKey ? 10 : 1) / canvas.getZoom();
  const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (arrows[e.key] && activeObj()) { e.preventDefault(); nudge(...arrows[e.key]); }
});

// drag and drop media and fonts
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('#dropHint').hidden = false; });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropHint').hidden = true; } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; $('#dropHint').hidden = true;
  const files = [...e.dataTransfer.files];
  const fonts = files.filter((f) => /\.(ttf|otf|woff2?)$/i.test(f.name) || (!f.type && !/\.[^./\\]+$/.test(f.name)));
  if (fonts.length) importFontPaths(fonts.map((f) => API.pathForFile(f)));
  const media = files.find((f) => /^(image|video)\//.test(f.type));
  if (media) openFile(media);
  else if (!fonts.length && files.length) toast('Drop a photo, video or font file');
});

// ---------- projects ----------
const KIND = { image: 'photo', video: 'video', blank: 'blank' };
let saveTimer = null, saveChain = Promise.resolve();
function setSaveStatus(t) { $('#saveStatus').textContent = t; }
function markDirty() {
  if (!S.project || S.loading || S.restoring) return;
  setSaveStatus('Saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 800);
}
function projectState() {
  return {
    v: 2, W: S.W, H: S.H, type: S.type, objects: JSON.parse(snap()),
    adjust: { ...S.adjust }, filterName: S.filterName,
    trimIn: S.trimIn, trimOut: S.trimOut, muted: !!S.video?.muted, music: S.music,
    bgColor: S.type === 'blank' ? canvas.backgroundColor : null,
    exportFormat: $('#exportFormat').value, stillDur: $('#stillDur').value,
  };
}
function makeThumb() {
  if (!S.W || !canvas.getWidth()) return null;
  S.exportT = Infinity;
  try { return canvas.toDataURL({ format: 'jpeg', quality: 0.75, multiplier: 360 / canvas.getWidth() }); } finally { S.exportT = null; }
}
function queueSave(extra) {
  const p = S.project;
  saveChain = saveChain.then(async () => {
    if (p !== S.project || S.loading) return;
    const r = await API.saveProject({ id: p.id || undefined, name: p.name, state: projectState(), thumb: makeThumb(), ...extra });
    p.id = r.id; p.name = r.name;
    if (p === S.project) { setSaveStatus('Saved'); syncProjectName(); }
  }).catch((e) => { setSaveStatus('Not saved'); toast('Could not save: ' + (e.message || e)); });
  return saveChain;
}
function saveNow() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!S.project || !API.saveProject) return saveChain;
  return queueSave();
}
function createProject(kind, name, media) {
  if (!API.saveProject) return;
  S.project = { id: null, name };
  syncProjectName(); setSaveStatus('Saving');
  queueSave({ kind, ...(media ? { media } : {}) });
}
async function leaveProject() {
  if (S.editing) exitEdit();
  await saveNow();
  S.project = null;
}
function syncProjectName() { if (document.activeElement !== $('#projName')) $('#projName').value = S.project?.name || ''; }
function renameCurrent() {
  const p = S.project; if (!p) return;
  const name = $('#projName').value.trim() || 'Untitled story';
  $('#projName').value = name;
  if (name !== p.name) { p.name = name; saveNow(); }
}
$('#projName').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { e.target.value = S.project?.name || ''; e.target.blur(); } });
$('#projName').addEventListener('blur', renameCurrent);
async function goHome() {
  await leaveProject();
  resetStage();
  S.W = S.H = 0; S.music = null; S.type = '';
  syncMusic();
  document.body.classList.remove('has-media');
  $('#videobar').hidden = true;
  syncUndo();
  return refreshProjects();
}
$('#homeBtn').onclick = goHome;
function markFilterThumb() { $$('.fthumb').forEach((x) => x.classList.toggle('on', x.dataset.n === S.filterName)); }
function pickFile(input) {
  return new Promise((res) => {
    input.onchange = () => { const f = input.files[0] || null; input.value = ''; res(f); };
    input.oncancel = () => res(null);
    input.click();
  });
}
function ask(text, ok = 'OK', cancel = 'Cancel') {
  $('#dlgText').textContent = text; $('#dlgOk').textContent = ok; $('#dlgCancel').textContent = cancel;
  $('#dialog').hidden = false; $('#dlgOk').focus();
  return new Promise((res) => {
    const done = (v) => { $('#dialog').hidden = true; document.removeEventListener('keydown', key, true); res(v); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
    $('#dlgOk').onclick = () => done(true);
    $('#dlgCancel').onclick = () => done(false);
    document.addEventListener('keydown', key, true);
  });
}
async function openProject(id) {
  if (!API.loadProject) return;
  await leaveProject();
  let p;
  try { p = await API.loadProject(id); } catch (e) { toast('Could not open project: ' + (e.message || e)); return goHome(); }
  if (p.missing) {
    if (!(await ask(`This video was moved or deleted: ${p.missing}`, 'Locate video', 'Cancel'))) return goHome();
    const file = await pickFile($('#locateInput'));
    if (!file) return goHome();
    try {
      await API.saveProject({ id, media: { path: API.pathForFile(file), type: file.type, name: file.name } });
      p = await API.loadProject(id);
    } catch (e) { toast('Could not relink the video: ' + (e.message || e)); return goHome(); }
    if (p.missing) { toast('That video could not be opened'); return goHome(); }
  }
  const st = p.state || {};
  await fontsReady;
  S.loading = true;
  try {
    if (p.kind === 'blank' || !p.media) await startBlank(st.W || 1080, st.H || 1920, st.bgColor || '#17151f', false);
    else if (!(await loadMedia(new File([p.media.bytes], p.media.name || 'media', { type: p.media.type }), p.media.path || ''))) return goHome();
    S.adjust = { ...ZERO, ...st.adjust }; S.filterName = st.filterName || 'Normal';
    syncAdjust(); applyAdjust(); markFilterThumb();
    if (S.video) {
      S.trimIn = st.trimIn ?? 0; S.trimOut = Math.min(st.trimOut ?? S.video.duration, S.video.duration);
      S.video.muted = !!st.muted; S.video.currentTime = S.trimIn; syncVideoUI();
    }
    S.music = st.music || null; syncMusic();
    if (st.exportFormat && !(st.v < 2 && st.exportFormat === 'png')) $('#exportFormat').value = st.exportFormat;
    if (st.stillDur) $('#stillDur').value = st.stillDur;
    syncExportUI();
    const objs = await fabric.util.enlivenObjects(st.objects || []);
    objs.forEach((o) => { restyle(o); applyFlags(o); canvas.add(o); });
    S.history = []; S.hi = -1; commit();
    S.project = { id: p.id, name: p.name };
  } finally { S.loading = false; }
  syncProjectName(); setSaveStatus('Saved');
  render(); syncInspector(); syncLayers();
}
function ago(ms) {
  const s = (Date.now() - ms) / 1000, d = new Date(ms), y = new Date(); y.setDate(y.getDate() - 1);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (d.toDateString() === new Date().toDateString()) return `${Math.floor(s / 3600)} h ago`;
  if (d.toDateString() === y.toDateString()) return 'yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === y.getFullYear() ? undefined : 'numeric' });
}
const PICON = {
  rename: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.4 3.6a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  dup: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
  del: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
};
let projectList = [];
async function refreshProjects() {
  if (!API.listProjects) return;
  try { projectList = await API.listProjects(); } catch (e) { projectList = []; toast('Could not list projects: ' + (e.message || e)); }
  $('#projSearch').hidden = projectList.length <= 8;
  renderProjects();
}
function renderProjects() {
  const q = $('#projSearch').hidden ? '' : $('#projSearch').value.trim().toLowerCase();
  const list = projectList.filter((p) => !q || p.name.toLowerCase().includes(q));
  $('#projEmpty').hidden = projectList.length > 0;
  $('#projGrid').replaceChildren(...list.map((p) => {
    const c = document.createElement('div');
    c.className = 'pcard'; c.dataset.id = p.id; c.tabIndex = 0;
    const img = p.thumb ? `<img class="pthumb" src="${p.thumb}" alt="">` : '<div class="pthumb"></div>';
    c.innerHTML = `${img}<div class="pmeta"><span class="pname"></span><span class="pbadge">${{ photo: 'Photo', video: 'Video', blank: 'Blank' }[p.kind] || 'Story'}</span><span class="ptime">${ago(p.updatedAt)}</span></div>`
      + `<div class="pmenu"><button data-act="rename" data-tip="Rename" aria-label="Rename">${PICON.rename}</button><button data-act="dup" data-tip="Duplicate" aria-label="Duplicate">${PICON.dup}</button><button data-act="del" class="danger" data-tip="Delete" aria-label="Delete">${PICON.del}</button></div>`;
    c.querySelector('.pname').textContent = p.name;
    return c;
  }));
}
$('#projSearch').addEventListener('input', renderProjects);
function renameCard(card) {
  const p = projectList.find((x) => x.id === card.dataset.id), span = card.querySelector('.pname');
  const input = document.createElement('input');
  input.className = 'pname-input'; input.value = p.name; span.replaceWith(input); input.focus(); input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return; done = true;
    const name = input.value.trim();
    if (save && name && name !== p.name) {
      try { await API.saveProject({ id: p.id, name }); } catch (e) { toast('Could not rename: ' + (e.message || e)); }
    }
    refreshProjects();
  };
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
}
$('#projGrid').addEventListener('click', async (e) => {
  const card = e.target.closest('.pcard'); if (!card) return;
  const act = e.target.closest('[data-act]')?.dataset.act, id = card.dataset.id;
  if (!act) return openProject(id);
  if (act === 'rename') return renameCard(card);
  if (act === 'dup') {
    try { await API.duplicateProject(id); } catch (err) { toast('Could not duplicate: ' + (err.message || err)); }
    return refreshProjects();
  }
  const name = projectList.find((x) => x.id === id)?.name || 'this project';
  if (!(await ask(`Delete "${name}"? It will be moved to the Trash.`, 'Delete', 'Cancel'))) return;
  try { toast((await API.deleteProject(id)) === 'deleted-projects' ? 'Project deleted' : 'Moved to Trash'); } catch (err) { toast('Could not delete: ' + (err.message || err)); }
  refreshProjects();
});
$('#projGrid').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('pcard')) openProject(e.target.dataset.id); });
window.addEventListener('beforeunload', () => { if (saveTimer) saveNow(); });

// boot
setTool('select');
syncUndo();
renderFontGrid();
const fontsReady = API.listFonts ? API.listFonts().then((l) => addFonts(l)).catch((e) => toast('Could not load fonts: ' + e.message)) : Promise.resolve();

// test hook for smoke runs
refreshProjects();
window.__editor = { S, canvas, encodeStill, openFile, startBlank, openProject, goHome, saveNow, projectState, refreshProjects, addText, addSticker, setTool, applyPreset, exportStory, importFontPaths, enterEdit, exitEdit };
