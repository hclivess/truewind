// Movable HUD: the player can drag each panel where they want it (Shift+L, or "Arrange HUD" in the menu). A moved
// panel is kept as an anchor — the nearest horizontal side (left / centre / right) and vertical side (top / middle /
// bottom) of the window — plus pixels from it, so a layout survives a resize: a panel parked bottom-right stays
// bottom-right. It is kept on screen as the window shrinks, snaps to the window's edges and to the other panels while
// dragged, and can be hidden. Saved per device (localStorage), separately for a narrow (phone) window and a wide one,
// so a phone keeps the default layout until something is moved on it. Unmoved panels keep their CSS positions and the
// responsive rules (the rig panel above the instruments in a narrow window, the touch layout).

// ------------------------------------------------------------ pure layout math (test/hudlayout.mjs)
// the anchor for a rect {x, y, w, h} (px, top-left) in a W x H window: the third its centre falls in, each axis
export function anchorOf(r, W, H) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const ax = cx < W / 3 ? 'l' : cx > 2 * W / 3 ? 'r' : 'c', ay = cy < H / 3 ? 't' : cy > 2 * H / 3 ? 'b' : 'm';
  const dx = ax === 'l' ? r.x : ax === 'r' ? W - (r.x + r.w) : cx - W / 2;
  const dy = ay === 't' ? r.y : ay === 'b' ? H - (r.y + r.h) : cy - H / 2;
  return { ax, ay, dx: Math.round(dx), dy: Math.round(dy) };
}
// where an anchored w x h panel sits in a W x H window (top-left, px), kept on screen (a panel larger than the
// window keeps its top-left corner in view)
export function placeOf(a, w, h, W, H) {
  const x = a.ax === 'l' ? a.dx : a.ax === 'r' ? W - w - a.dx : W / 2 + a.dx - w / 2;
  const y = a.ay === 't' ? a.dy : a.ay === 'b' ? H - h - a.dy : H / 2 + a.dy - h / 2;
  return { x: Math.max(0, Math.min(W - w, x)), y: Math.max(0, Math.min(H - h, y)) };
}
// the same anchor with its offsets pulled in so the panel is on screen (placeOf's clamping, kept as an anchor)
export function clampAnchor(a, w, h, W, H) {
  const p = placeOf(a, w, h, W, H);
  return { ...a, dx: fromPlace(a.ax, p.x, w, W), dy: fromPlace(a.ay, p.y, h, H) };
}
function fromPlace(ax, x, w, W) {
  return Math.round(ax === 'l' || ax === 't' ? x : ax === 'r' || ax === 'b' ? W - x - w : x + w / 2 - W / 2);
}
// a dragged rect snapped to the window's edges (a margin m in), its centre lines, and the other panels' edges
// (aligned with them, or side by side a gap g apart), each axis on its own, within th px. Returns {x, y, gx, gy}:
// the snapped position and the guide lines it snapped to (screen px, or null)
export function snapRect(r, others, W, H, th = 10, m = 12, g = 8) {
  const xs = [[m, m], [W - m - r.w, W - m], [W / 2 - r.w / 2, W / 2]];
  const ys = [[m, m], [H - m - r.h, H - m], [H / 2 - r.h / 2, H / 2]];
  for (const o of others) {
    xs.push([o.x, o.x], [o.x + o.w - r.w, o.x + o.w], [o.x + o.w + g, o.x + o.w + g], [o.x - g - r.w, o.x - g]);
    ys.push([o.y, o.y], [o.y + o.h - r.h, o.y + o.h], [o.y + o.h + g, o.y + o.h + g], [o.y - g - r.h, o.y - g]);
  }
  const best = (v, cands) => { let b = null; for (const c of cands) if (Math.abs(c[0] - v) <= th && (!b || Math.abs(c[0] - v) < Math.abs(b[0] - v))) b = c; return b; };
  const bx = best(r.x, xs), by = best(r.y, ys);
  return { x: bx ? bx[0] : r.x, y: by ? by[0] : r.y, gx: bx ? bx[1] : null, gy: by ? by[1] : null };
}
// the inline style for an anchor (the panel's CSS left / right / top / bottom / transform replaced)
export function cssOf(a) {
  const s = { left: 'auto', right: 'auto', top: 'auto', bottom: 'auto' };
  if (a.ax === 'l') s.left = a.dx + 'px'; else if (a.ax === 'r') s.right = a.dx + 'px'; else s.left = `calc(50% + ${a.dx}px)`;
  if (a.ay === 't') s.top = a.dy + 'px'; else if (a.ay === 'b') s.bottom = a.dy + 'px'; else s.top = `calc(50% + ${a.dy}px)`;
  s.transform = `translate(${a.ax === 'c' ? '-50%' : '0'}, ${a.ay === 'm' ? '-50%' : '0'})`;
  return s;
}
// a stored layout, checked: anything malformed is dropped (it came from storage)
export function cleanLayout(L) {
  const out = {};
  if (!L || typeof L !== 'object') return out;
  for (const id in L) {
    const e = L[id]; if (!e || typeof e !== 'object') continue;
    const o = {};
    if ('lcr'.includes(e.ax) && e.ax.length === 1 && 'tmb'.includes(e.ay) && e.ay.length === 1 && Number.isFinite(e.dx) && Number.isFinite(e.dy)) Object.assign(o, { ax: e.ax, ay: e.ay, dx: e.dx, dy: e.dy });
    if (e.off === true) o.off = true;
    if (Object.keys(o).length) out[id] = o;
  }
  return out;
}

// the movable widgets: [element id, name, can be hidden] (the map card carries the toolbar, the rig panel has its
// own Hide; the engine throttle rides in the rig panel on a desktop, beside the touch pad on a phone)
export const WIDGETS = [
  ['race-card', 'Race card', true],
  ['map-card', 'Map · nav · toolbar', false],
  ['rig', 'Rig panel', false],
  ['polar-card', 'Polar', true],
  ['instruments', 'Instruments', true],
  ['compass-tape', 'Compass', true],
  ['coach', 'Coach line', true],
  ['engine-card', 'Engine readout', true],
  ['physics', 'Physics', true],
];
const KEY = 'tw-hud-layout';
const STYLE_KEYS = ['left', 'right', 'top', 'bottom', 'transform'];

export class HudLayout {
  constructor(onChange = null) {
    this.onChange = onChange;
    this.narrowQ = typeof matchMedia === 'function' ? matchMedia('(max-width: 720px)') : { matches: false, addEventListener() {} };
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; }
    this.store = { wide: cleanLayout(s && s.wide), narrow: cleanLayout(s && s.narrow) };
    this.editing = false;
    this._raf = 0;
    const later = () => this.schedule();
    window.addEventListener('resize', later);
    this.narrowQ.addEventListener('change', later);
    if (typeof ResizeObserver === 'function') {
      this.ro = new ResizeObserver(later);
      for (const [id] of WIDGETS) { const el = document.getElementById(id); if (el) this.ro.observe(el); }
    }
    this.apply();
  }
  get form() { return this.narrowQ.matches ? 'narrow' : 'wide'; }
  get L() { return this.store[this.form]; }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.store)); } catch (e) { /* private mode: this session only */ } }
  // the anchor a moved panel has (null: its CSS default)
  placed(id) { const e = this.L[id]; return e && e.ax ? e : null; }
  moved() { return Object.keys(this.L).length > 0; }
  schedule() { if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = 0; this.apply(); }); }

  // put every widget where its layout says (or back to its CSS), then pull any that hang off the window back in
  apply() {
    const W = innerWidth, H = innerHeight, rigOpen = document.body.classList.contains('rig-open');
    for (const [id] of WIDGETS) {
      const el = document.getElementById(id); if (!el) continue;
      const e = this.L[id] || {};
      el.classList.toggle('hud-off', !!e.off);
      const a = e.ax && !(id === 'rig' && rigOpen) ? e : null;   // (the phone's full-screen rig panel is its own)
      el.classList.toggle('hud-placed', !!a);
      if (!a) { if (el._hudStyled) { for (const k of STYLE_KEYS) el.style.removeProperty(k); el._hudStyled = false; } continue; }
      this._style(el, a);
      const R = el.getBoundingClientRect();
      if (R.width > 0 && R.height > 0) {
        const c = clampAnchor(a, R.width, R.height, W, H);
        if (c.dx !== a.dx || c.dy !== a.dy) this._style(el, c);     // (shown on screen; the saved place is kept)
      }
    }
    if (this.onChange) this.onChange();
  }
  _style(el, a) {
    const s = cssOf(a);
    for (const k of STYLE_KEYS) if (el.style[k] !== s[k]) el.style.setProperty(k, s[k]);
    el._hudStyled = true;
  }
  set(id, patch) {
    const L = this.L, e = { ...(L[id] || {}), ...patch };
    for (const k in e) if (e[k] === undefined || e[k] === false) delete e[k];
    if (Object.keys(e).length) L[id] = e; else delete L[id];
    this.save(); this.apply();
  }
  reset() { this.store[this.form] = {}; this.save(); this.apply(); if (this.editing) this._frames(); }

  // ------------------------------------------------------------ arranging
  toggleEdit(on = !this.editing) {
    if (on === this.editing) return;
    this.editing = on;
    document.body.classList.toggle('hud-edit', on);
    if (on) {
      document.body.classList.remove('rig-open');
      this._build();
      const tick = () => { if (!this.editing) return; this._place(); this._tick = requestAnimationFrame(tick); };
      tick();
    } else {
      cancelAnimationFrame(this._tick);
      if (this.layer) { this.layer.remove(); this.layer = null; }
    }
    if (this.onChange) this.onChange();
  }
  _build() {
    const layer = this.layer = document.createElement('div');
    layer.id = 'hud-edit';
    layer.innerHTML = `<div class="he-bar panel" role="toolbar" aria-label="Arrange the HUD"><span class="eyebrow">Arrange HUD</span><span class="he-tip">Drag a panel · it snaps to the edges and the other panels</span><button class="chip" id="he-reset" title="Every panel back where it started (this ${this.form === 'narrow' ? 'phone-size' : 'desktop-size'} layout)">Reset layout</button><button class="chip on" id="he-done" title="Done (Esc, Shift+L)">Done</button></div><i class="he-gx"></i><i class="he-gy"></i>`;
    document.body.appendChild(layer);
    layer.querySelector('#he-reset').addEventListener('click', () => this.reset());
    layer.querySelector('#he-done').addEventListener('click', () => this.toggleEdit(false));
    this._frames();
  }
  _frames() {
    if (!this.layer) return;
    for (const f of this.layer.querySelectorAll('.he-frame')) f.remove();
    this.frames = [];
    for (const [id, name, canHide] of WIDGETS) {
      const el = document.getElementById(id); if (!el) continue;
      const f = document.createElement('div');
      f.className = 'he-frame';
      f.innerHTML = `<span class="he-name">${name}</span>${canHide ? '<button class="he-hide" type="button"></button>' : ''}`;
      this.layer.appendChild(f);
      const fr = { id, el, f, hide: f.querySelector('.he-hide') };
      if (fr.hide) {
        fr.hide.addEventListener('pointerdown', (e) => e.stopPropagation());
        fr.hide.addEventListener('click', (e) => { e.stopPropagation(); this.set(id, { off: !(this.L[id] && this.L[id].off) }); });
      }
      this._drag(fr);
      this.frames.push(fr);
    }
  }
  // each frame over its panel (panels move and change size while the game runs)
  _place() {
    for (const fr of this.frames || []) {
      const R = fr.el.getBoundingClientRect(), vis = R.width > 4 && R.height > 4 && getComputedStyle(fr.el).display !== 'none';
      fr.f.hidden = !vis;
      if (!vis) continue;
      const st = fr.f.style, px = (v) => Math.round(v) + 'px';
      if (st.left !== px(R.left)) st.left = px(R.left);
      if (st.top !== px(R.top)) st.top = px(R.top);
      if (st.width !== px(R.width)) st.width = px(R.width);
      if (st.height !== px(R.height)) st.height = px(R.height);
      const off = !!(this.L[fr.id] && this.L[fr.id].off);
      fr.f.classList.toggle('off', off); fr.f.classList.toggle('moved', !!this.placed(fr.id));
      if (fr.hide && fr.hide.textContent !== (off ? 'Show' : 'Hide')) fr.hide.textContent = off ? 'Show' : 'Hide';
    }
  }
  _drag(fr) {
    let d = null;
    const gx = () => this.layer.querySelector('.he-gx'), gy = () => this.layer.querySelector('.he-gy');
    fr.f.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      fr.f.setPointerCapture(e.pointerId);
      const R = fr.el.getBoundingClientRect();
      // the others to snap to: every other visible widget
      const others = [];
      for (const o of this.frames) if (o !== fr && !o.f.hidden) { const Q = o.el.getBoundingClientRect(); others.push({ x: Q.left, y: Q.top, w: Q.width, h: Q.height }); }
      d = { id: e.pointerId, x0: e.clientX, y0: e.clientY, r: { x: R.left, y: R.top, w: R.width, h: R.height }, others, moved: false };
      fr.f.classList.add('drag');
    });
    fr.f.addEventListener('pointermove', (e) => {
      if (!d || e.pointerId !== d.id) return;
      const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      const W = innerWidth, H = innerHeight, r = d.r;
      const s = snapRect({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }, d.others, W, H);
      const p = placeOf(anchorOf({ x: s.x, y: s.y, w: r.w, h: r.h }, W, H), r.w, r.h, W, H);
      d.a = anchorOf({ x: p.x, y: p.y, w: r.w, h: r.h }, W, H);
      this._style(fr.el, d.a); fr.el.classList.add('hud-placed');
      const X = gx(), Y = gy();
      X.style.display = s.gx == null ? 'none' : 'block'; X.style.left = Math.round(s.gx) + 'px';
      Y.style.display = s.gy == null ? 'none' : 'block'; Y.style.top = Math.round(s.gy) + 'px';
    });
    const end = (e) => {
      if (!d || e.pointerId !== d.id) return;
      if (d.moved && d.a) { const { ax, ay, dx, dy } = d.a; this.set(fr.id, { ax, ay, dx, dy }); }
      d = null; fr.f.classList.remove('drag');
      gx().style.display = 'none'; gy().style.display = 'none';
    };
    fr.f.addEventListener('pointerup', end); fr.f.addEventListener('pointercancel', end);
  }
}
