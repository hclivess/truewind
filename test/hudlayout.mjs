// The movable HUD's layout math (js/hudlayout.js) and the mixer's gains (js/audio.js): a panel kept as an anchor
// (nearest side + px) survives a resize and stays on screen; dragging snaps to the edges and the other panels;
// stored layouts and mixes are checked.
import { anchorOf, placeOf, clampAnchor, snapRect, cssOf, cleanLayout } from '../js/hudlayout.js';
import { volGain, cleanVol, CHANNELS } from '../js/audio.js';
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const near = (a, b, e = 0.51) => Math.abs(a - b) <= e;

// anchors: the third the centre falls in
const W = 1920, H = 1080;
let a = anchorOf({ x: 12, y: 12, w: 230, h: 200 }, W, H);
ok(a.ax === 'l' && a.ay === 't' && a.dx === 12 && a.dy === 12, 'top-left panel: anchored top-left, 12 px in');
a = anchorOf({ x: W - 252, y: H - 310, w: 240, h: 300 }, W, H);
ok(a.ax === 'r' && a.ay === 'b' && a.dx === 12 && a.dy === 10, 'bottom-right panel: anchored bottom-right');
a = anchorOf({ x: W / 2 - 276 + 40, y: H - 130, w: 552, h: 120 }, W, H);
ok(a.ax === 'c' && a.ay === 'b' && a.dx === 40 && a.dy === 10, 'bottom-middle panel: centre anchor, offset from the middle');
// round trip at the same size
for (const r of [{ x: 12, y: 12, w: 230, h: 200 }, { x: 900, y: 500, w: 100, h: 40 }, { x: 1600, y: 900, w: 300, h: 170 }]) {
  const p = placeOf(anchorOf(r, W, H), r.w, r.h, W, H);
  ok(near(p.x, r.x) && near(p.y, r.y), `anchor round trip (${r.x}, ${r.y})`);
}
// a resize keeps the panel at its side: bottom-right stays 12 px from the corner
a = anchorOf({ x: W - 252, y: H - 310, w: 240, h: 300 }, W, H);
let p = placeOf(a, 240, 300, 1280, 720);
ok(p.x === 1280 - 252 && p.y === 720 - 310, 'bottom-right panel after 1920x1080 -> 1280x720: still 12 / 10 px from the corner');
a = anchorOf({ x: W / 2 - 50, y: 100, w: 100, h: 30 }, W, H);
p = placeOf(a, 100, 30, 412, 915);
ok(p.x === 156 && p.y === 100, 'centred panel stays centred on a phone');
// kept on screen: a panel far right on a big screen, then a small window
a = { ax: 'l', ay: 't', dx: 1700, dy: 900 };
p = placeOf(a, 240, 300, 1280, 720);
ok(p.x === 1040 && p.y === 420, 'off-screen anchor clamped into the window');
const c = clampAnchor(a, 240, 300, 1280, 720);
ok(c.ax === 'l' && c.dx === 1040 && c.dy === 420, 'clampAnchor keeps the sides, pulls the offsets in');
ok(JSON.stringify(clampAnchor({ ax: 'c', ay: 'm', dx: 10, dy: -20 }, 100, 50, W, H)) === JSON.stringify({ ax: 'c', ay: 'm', dx: 10, dy: -20 }), 'an on-screen anchor is left alone');
p = placeOf({ ax: 'r', ay: 'b', dx: 0, dy: 0 }, 2000, 1200, 1280, 720);
ok(p.x === 0 && p.y === 0, 'a panel bigger than the window keeps its top-left corner in view');
// snapping
let s = snapRect({ x: 17, y: 300, w: 200, h: 100 }, [], W, H);
ok(s.x === 12 && s.gx === 12 && s.y === 300 && s.gy === null, 'snaps to the window margin within 10 px, not on the other axis');
s = snapRect({ x: 403, y: 300, w: 200, h: 100 }, [{ x: 100, y: 200, w: 292, h: 50 }], W, H);
ok(s.x === 400 && s.gx === 400, 'snaps beside another panel (8 px gap)');
s = snapRect({ x: 103, y: 254, w: 200, h: 100 }, [{ x: 100, y: 200, w: 292, h: 50 }], W, H);
ok(s.x === 100 && s.y === 258, 'snaps left-aligned with, and just under, another panel');
s = snapRect({ x: W / 2 - 100 + 6, y: 600, w: 200, h: 100 }, [], W, H);
ok(s.x === W / 2 - 100 && s.gx === W / 2, 'snaps to the centre line');
s = snapRect({ x: 500, y: 600, w: 200, h: 100 }, [], W, H);
ok(s.x === 500 && s.y === 600 && s.gx === null, 'no snap far from everything');
// css
const css = cssOf({ ax: 'c', ay: 'b', dx: -30, dy: 10 });
ok(css.left === 'calc(50% + -30px)' && css.bottom === '10px' && css.top === 'auto' && css.right === 'auto' && css.transform === 'translate(-50%, 0)', 'css for a centre-bottom anchor');
ok(cssOf({ ax: 'r', ay: 'm', dx: 5, dy: 0 }).transform === 'translate(0, -50%)', 'css for a right-middle anchor');
// stored layouts are checked
const L = cleanLayout({ rig: { ax: 'r', ay: 't', dx: 12, dy: 40 }, polar: { off: true }, bad: { ax: 'x', ay: 't', dx: 1, dy: 1 }, nan: { ax: 'l', ay: 't', dx: NaN, dy: 1 }, junk: 5, two: { ax: 'lc', ay: 't', dx: 1, dy: 1 } });
ok(JSON.stringify(L) === JSON.stringify({ rig: { ax: 'r', ay: 't', dx: 12, dy: 40 }, polar: { off: true } }), 'cleanLayout keeps good entries, drops bad ones');
ok(JSON.stringify(cleanLayout(null)) === '{}' && JSON.stringify(cleanLayout('x')) === '{}', 'cleanLayout of nothing is empty');

// the mixer
ok(volGain(1) === 1 && volGain(0) === 0 && near(volGain(0.5), 0.25, 1e-9), 'volGain: full is the level as made, half way -12 dB');
ok(volGain(2) === 1 && volGain(-1) === 0 && volGain('x') === 0, 'volGain clamps');
const v = cleanVol({ master: 0.5, amb: 7, eng: 'loud' });
ok(v.master === 0.5 && v.amb === 1 && v.eng === 1 && v.gear === 1 && v.sig === 1 && Object.keys(v).length === CHANNELS.length, 'cleanVol: clamped, a missing or bad channel at full');

console.log(fails ? `${fails} FAILED` : 'all hudlayout tests pass');
process.exit(fails ? 1 : 0);
