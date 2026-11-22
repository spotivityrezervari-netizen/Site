// Generates the "Arena" background: one composed scene per screen shape (the layer is fixed
// to the viewport, so it is designed as a picture, not as a repeating wallpaper).
//   - a football pitch in perspective, lit by floodlights and fading into the dark (the product:
//     courts you can book), with mowing stripes;
//   - silk-like bundles of thin light lines sweeping across the scene;
//   - a few real 3D balls (projected spheres), back-lit with a rim light, some out of focus;
//   - soft floodlight glows and a fine grain that removes gradient banding.
// Writes --design-bg-arena (wide screens), --design-bg-arena-phone (portrait) and
// --design-bg-grain into Idee Site/css/design-background.css. Never edit those lines by hand.
// Run: node scripts/design/fundal-arena.mjs [--svg <prefix>]   (--svg also saves the SVGs)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = '#011012';
const LINE = '#1f8f72';      // court lines
const GLOW = '#19b38a';      // emerald light
const SEAM = '#33c49c';      // ball seams (back-lit)

const f = (n) => Number(n.toFixed(1));
const P = (x, y) => `${f(x)} ${f(y)}`;
const polyline = (pts) => (pts.length < 2 ? '' : `M${pts.map(([x, y]) => P(x, y)).join('L')}`);
const poly = (pts) => `${polyline(pts)}Z`;

// ---------------------------------------------------------------- spheres (balls)
const norm = ([x, y, z]) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function rotator(yaw, pitch, roll) {
  const r = (d) => d * Math.PI / 180;
  const [cy, sy, cp, sp, cr, sr] = [Math.cos(r(yaw)), Math.sin(r(yaw)), Math.cos(r(pitch)), Math.sin(r(pitch)), Math.cos(r(roll)), Math.sin(r(roll))];
  return ([x, y, z]) => {
    const X = x * cy + z * sy; let Z = -x * sy + z * cy;
    const Y = y * cp - Z * sp; Z = y * sp + Z * cp;
    return [X * cr - Y * sr, X * sr + Y * cr, Z];
  };
}
const arc = (a, b, n = 10) => Array.from({ length: n + 1 }, (_, i) => norm(a.map((v, k) => v + (b[k] - v) * i / n)));
// front (visible) half of 3D polylines on a sphere of radius 50
function frontPath(lines, rot) {
  let d = '';
  for (const line of lines) {
    let open = false;
    for (const p of line) {
      const [x, y, z] = rot(p);
      if (z > 0.01) { d += `${open ? 'L' : 'M'}${P(x * 50, -y * 50)}`; open = true; } else open = false;
    }
  }
  return d;
}
const PHI = (1 + Math.sqrt(5)) / 2;
function cyclicSigned(base) {
  const out = new Map();
  for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) {
    const v = [base[0] * sx, base[1] * sy, base[2] * sz];
    for (const q of [v, [v[1], v[2], v[0]], [v[2], v[0], v[1]]]) out.set(q.map((n) => (n + 0).toFixed(4)).join(), q);
  }
  return [...out.values()];
}
const TI = [[0, 1, 3 * PHI], [1, 2 + PHI, 2 * PHI], [PHI, 2, 2 * PHI + 1]].flatMap(cyclicSigned);
const TI_EDGES = [];
TI.forEach((a, i) => TI.forEach((b, j) => { if (j > i && Math.abs(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) - 2) < 1e-6) TI_EDGES.push([norm(a), norm(b)]); }));
const TI_PENTS = cyclicSigned([0, 1, PHI]).map((c) => {
  const n = norm(c);
  const near = TI.map(norm).sort((a, b) => dot(b, n) - dot(a, n)).slice(0, 5);
  const u = norm(near[0].map((v, k) => v - n[k]));
  const w = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const ang = (p) => Math.atan2(dot(p, w), dot(p, u));
  return { n, ring: near.sort((a, b) => ang(a) - ang(b)) };
});
const circle3 = (fn, N = 96) => Array.from({ length: N + 1 }, (_, i) => fn(i / N * 2 * Math.PI));

const seams = {
  soccer(rot) {
    let panels = '';
    for (const { n, ring } of TI_PENTS) {
      if (rot(n)[2] < -0.3) continue;
      const pts = ring.flatMap((a, i) => arc(a, ring[(i + 1) % 5], 5)).map((p) => {
        const [x, y, z] = rot(p);
        if (z >= 0) return [x * 50, -y * 50];
        const l = Math.hypot(x, y); return [x / l * 50, -y / l * 50];
      });
      panels += poly(pts);
    }
    return { panels, lines: frontPath(TI_EDGES.map(([a, b]) => arc(a, b, 8)), rot) };
  },
  basketball(rot) {
    const k = 0.6; const s = Math.sqrt(1 - k * k);
    return { lines: frontPath([
      circle3((t) => [Math.cos(t), 0, Math.sin(t)]),
      circle3((t) => [0, Math.cos(t), Math.sin(t)]),
      circle3((t) => [k, s * Math.cos(t), s * Math.sin(t)]),
      circle3((t) => [-k, s * Math.cos(t), s * Math.sin(t)]),
    ], rot) };
  },
  volleyball(rot) {
    const lines = [];
    const corners = [];
    for (const x of [1, -1]) for (const y of [1, -1]) for (const z of [1, -1]) corners.push([x, y, z]);
    corners.forEach((a, i) => corners.forEach((b, j) => { if (j > i && a.filter((v, q) => v !== b[q]).length === 1) lines.push(arc(norm(a), norm(b), 20)); }));
    for (let ax = 0; ax < 3; ax++) for (const sg of [1, -1]) for (const u of [-1 / 3, 1 / 3]) {
      const pts = [];
      for (let i = 0; i <= 20; i++) { const p = [0, 0, 0]; p[ax] = sg; p[(ax + 1) % 3] = u; p[(ax + 2) % 3] = -1 + i / 10; pts.push(norm(p)); }
      lines.push(pts);
    }
    return { lines: frontPath(lines, rot) };
  },
  tennis(rot) {
    const a = 0.7; const b = 0.3; const c = 2 * Math.sqrt(a * b);
    return { lines: frontPath([circle3((t) => norm([a * Math.cos(t) + b * Math.cos(3 * t), a * Math.sin(t) - b * Math.sin(3 * t), c * Math.sin(2 * t)]), 160)], rot) };
  },
};

// A ball: opaque dark body (hides what is behind), seams, form shadow, top rim light.
// [kind, cx, cy, r, yaw, pitch, roll, blur, contactShadow]
function ball([kind, cx, cy, r, yaw, pitch, roll, blur = 0, shadow = false]) {
  const s = r / 50;
  const { panels = '', lines } = seams[kind](rotator(yaw, pitch, roll));
  const sw = (px) => f(px / s * 100) / 100;     // screen px -> local units
  const body = `<circle r='50' fill='url(#ballBody)'/>`
    + (panels ? `<path d='${panels}' fill='#000' fill-opacity='.42'/>` : '')
    + `<path d='${lines}' fill='none' stroke='${SEAM}' stroke-opacity='.62' stroke-width='${sw({ tennis: 1.8, basketball: 2, soccer: 1.3, volleyball: 1.3 }[kind])}' stroke-linecap='round' stroke-linejoin='round'/>`
    + `<circle r='50' fill='url(#ballShade)'/>`
    + `<circle r='${f(50 - sw(0.6))}' fill='none' stroke='url(#ballRim)' stroke-width='${sw(2.2)}'/>`
    + `<circle r='50' fill='url(#ballSheen)'/>`;
  const contact = shadow ? `<ellipse cx='${f(cx + r * 0.1)}' cy='${f(cy + r * 0.96)}' rx='${f(r * 1.05)}' ry='${f(r * 0.2)}' fill='url(#contact)'/>` : '';
  const filter = blur ? ` filter='url(#blur${blur})'` : '';
  return `${contact}<g transform='translate(${f(cx)} ${f(cy)}) scale(${f(s * 1000) / 1000})'${filter}>${body}</g>`;
}

// ---------------------------------------------------------------- the pitch in perspective
// Ground coordinates in metres: x across the pitch, z along it (centre spot = 0,0).
// cam: { cx, horizon, focal, height, x, z, yaw } -> the camera stands at (x, z) looking down +z.
function pitch(cam, H) {
  const yaw = cam.yaw * Math.PI / 180;
  const project = ([x, z]) => {
    const dx = x - cam.x; const dz = z - cam.z;
    const X = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const Z = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    return Z < 1.5 ? null : [cam.cx + cam.focal * X / Z, cam.horizon + cam.focal * cam.height / Z];
  };
  const path = (pts, closed) => {
    let d = ''; let open = false;
    for (const p of pts) {
      const q = project(p);
      if (q && q[1] < H + 400) { d += `${open ? 'L' : 'M'}${P(...q)}`; open = true; } else open = false;
    }
    return closed && open ? `${d}Z` : d;
  };
  const seg = (a, b, n = 8) => Array.from({ length: n + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
  const rect = (x0, z0, x1, z1) => [...seg([x0, z0], [x1, z0]), ...seg([x1, z0], [x1, z1]), ...seg([x1, z1], [x0, z1]), ...seg([x0, z1], [x0, z0])];
  const circ = (x, z, r, a0 = 0, a1 = 360, n = 72) => Array.from({ length: n + 1 }, (_, i) => { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; return [x + r * Math.cos(a), z + r * Math.sin(a)]; });
  const L = 52.5; const Wd = 34;
  let lines = '';
  lines += path(rect(-Wd, -L, Wd, L));
  lines += path(seg([-Wd, 0], [Wd, 0]));
  lines += path(circ(0, 0, 9.15));
  for (const e of [1, -1]) {
    lines += path(rect(-20.16, e * L, 20.16, e * (L - 16.5)));
    lines += path(rect(-9.16, e * L, 9.16, e * (L - 5.5)));
    lines += path(circ(0, e * (L - 11), 9.15, 0, 360, 160).filter(([, z]) => Math.abs(z) < L - 16.5));   // penalty arc
    lines += path(rect(-3.66, e * L, 3.66, e * (L + 2)));   // goal
    for (const sx of [1, -1]) lines += path(circ(sx * Wd, e * L, 1, 0, 360, 24).filter(([x, z]) => Math.abs(x) <= Wd && Math.abs(z) <= L));
  }
  // spots
  let spots = '';
  for (const [x, z] of [[0, 0], [0, L - 11], [0, -L + 11]]) {
    const q = project([x, z]); if (!q) continue;
    const rr = Math.max(1.2, cam.focal * 0.25 / Math.hypot(x - cam.x, z - cam.z));
    spots += `<ellipse cx='${f(q[0])}' cy='${f(q[1])}' rx='${f(rr * 1.6)}' ry='${f(rr * 0.7)}'/>`;
  }
  // mowing stripes (every other band slightly lighter)
  let stripes = '';
  const n = 18; const step = 2 * L / n;
  for (let i = 0; i < n; i += 2) stripes += path([...seg([-Wd, -L + i * step], [Wd, -L + i * step], 6), ...seg([Wd, -L + (i + 1) * step], [-Wd, -L + (i + 1) * step], 6)], true);
  const fade = `<linearGradient id='pitchFade' gradientUnits='userSpaceOnUse' x1='0' y1='${cam.horizon}' x2='0' y2='${H}'><stop offset='0' stop-color='${LINE}' stop-opacity='0'/><stop offset='.25' stop-color='${LINE}' stop-opacity='.2'/><stop offset='.7' stop-color='${LINE}' stop-opacity='.42'/><stop offset='1' stop-color='${LINE}' stop-opacity='.55'/></linearGradient>`;
  const svg = `<path d='${stripes}' fill='url(#pitchFade)' fill-opacity='.11'/>`
    + `<path d='${lines}' fill='none' stroke='${GLOW}' stroke-opacity='.05' stroke-width='7' stroke-linejoin='round'/>`
    + `<path d='${lines}' fill='none' stroke='url(#pitchFade)' stroke-width='1.3' stroke-linejoin='round' stroke-linecap='round'/>`
    + `<g fill='url(#pitchFade)'>${spots}</g>`;
  return { defs: fade, svg };
}

// ---------------------------------------------------------------- silk light ribbons
// Two edge curves (cubic beziers); the strands between them twist (their control points are
// blended with different easings), which gives the folded silk look.
// { a: [p0,p1,p2,p3], b: [p0,p1,p2,p3], n, strength, peak, width }
function ribbon(rb, id) {
  const { a, b, strength = 1, peak = 0.5 } = rb; const n = Math.round((rb.n || 34) * 0.6);
  const mix = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  const g = `<linearGradient id='${id}' gradientUnits='userSpaceOnUse' x1='${a[0][0]}' y1='${a[0][1]}' x2='${a[3][0]}' y2='${a[3][1]}'><stop offset='0' stop-color='${GLOW}' stop-opacity='0'/><stop offset='${f(peak * 0.55 * 100) / 100}' stop-color='${GLOW}' stop-opacity='${f(0.35 * strength * 100) / 100}'/><stop offset='${peak}' stop-color='#4fe0b6' stop-opacity='${f(0.9 * strength * 100) / 100}'/><stop offset='${f((peak + (1 - peak) * 0.5) * 100) / 100}' stop-color='${GLOW}' stop-opacity='${f(0.3 * strength * 100) / 100}'/><stop offset='1' stop-color='#4fe0b6' stop-opacity='${f((rb.endOp || 0) * strength * 100) / 100}'/></linearGradient>`;
  const gh = g.replace(`id='${id}'`, `id='${id}h'`).replace(/stop-opacity='[^']*'\/><\/linearGradient>$/, "stop-opacity='0'/></linearGradient>");
  let strands = '';
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const tw = rb.twist ?? 0.75;                                   // 0 = flat band, 1 = full fold
    const c = [mix(a[0], b[0], s), mix(a[1], b[1], s), mix(a[2], b[2], s + (1 - 2 * s) * tw), mix(a[3], b[3], s)];
    const edge = 1 - Math.abs(2 * s - 1);
    const op = 0.06 + 0.34 * edge ** 0.8;   // one bright strand
    strands += `<path d='M${P(...c[0])}C${P(...c[1])} ${P(...c[2])} ${P(...c[3])}' stroke-opacity='${f(op * 100) / 100}'/>`;
  }
  const m = [mix(a[0], b[0], 0.5), mix(a[1], b[1], 0.5), mix(a[2], b[2], 0.5), mix(a[3], b[3], 0.5)];
  const cub = (c) => `M${P(...c[0])}C${P(...c[1])} ${P(...c[2])} ${P(...c[3])}`;
  const spine = cub(m);
  const w = rb.width || 70;
  // the folded sheet: a filled band between the two edges, its lit crest, and a soft halo
  const sheet = `${cub(a)}L${P(...b[3])}C${P(...b[2])} ${P(...b[1])} ${P(...b[0])}Z`;
  const halo = `<g stroke-linecap='butt' stroke='url(#${id}h)'><path d='${spine}' stroke-width='${w}' stroke-opacity='.06'/><path d='${spine}' stroke-width='${f(w * 0.4)}' stroke-opacity='.08'/></g>`;
  const crest = `<path d='${cub(a)}' stroke-width='6' stroke-opacity='.18'/><path d='${cub(a)}' stroke-width='1.6' stroke-opacity='.95'/>`;
  return { defs: g + gh, svg: `<g fill='none' stroke='url(#${id})' stroke-linecap='round'><path d='${sheet}' fill='url(#${id})' fill-opacity='.22' stroke='none'/>${halo}<g stroke-width='1'>${strands}</g>${crest}</g>` };
}

// ---------------------------------------------------------------- scenes
const commonDefs = `
<radialGradient id='ballBody' cx='.36' cy='.3' r='.78'><stop offset='0' stop-color='#1a6a57'/><stop offset='.45' stop-color='#0b3a33'/><stop offset='1' stop-color='#031b18'/></radialGradient>
<radialGradient id='ballShade' cx='.34' cy='.28' r='.85'><stop offset='.45' stop-color='#000' stop-opacity='0'/><stop offset='1' stop-color='#000' stop-opacity='.6'/></radialGradient>
<linearGradient id='ballRim' x1='.2' y1='0' x2='.55' y2='1'><stop offset='0' stop-color='#8dffdc' stop-opacity='1'/><stop offset='.35' stop-color='${GLOW}' stop-opacity='.55'/><stop offset='.7' stop-color='${GLOW}' stop-opacity='0'/></linearGradient>
<radialGradient id='ballSheen' cx='.3' cy='.22' r='.32'><stop offset='0' stop-color='#b5ffe8' stop-opacity='.26'/><stop offset='1' stop-color='#9ff5dc' stop-opacity='0'/></radialGradient>
<radialGradient id='contact'><stop offset='0' stop-color='#000' stop-opacity='.75'/><stop offset='1' stop-color='#000' stop-opacity='0'/></radialGradient>
<filter id='blur2' x='-30%' y='-30%' width='160%' height='160%'><feGaussianBlur stdDeviation='2'/></filter>
<filter id='blur5' x='-30%' y='-30%' width='160%' height='160%'><feGaussianBlur stdDeviation='5'/></filter>
<filter id='blur9' x='-40%' y='-40%' width='180%' height='180%'><feGaussianBlur stdDeviation='9'/></filter>`.replace(/\n/g, '');

const glow = (id, cx, cy, rx, ry, color, op) => ({
  defs: `<radialGradient id='${id}' cx='${cx}' cy='${cy}' r='1' gradientUnits='userSpaceOnUse' gradientTransform='translate(${cx} ${cy}) scale(${rx} ${ry}) translate(${-cx} ${-cy})'><stop offset='0' stop-color='${color}' stop-opacity='${op}'/><stop offset='.45' stop-color='${color}' stop-opacity='${f(op * 0.35 * 1000) / 1000}'/><stop offset='1' stop-color='${color}' stop-opacity='0'/></radialGradient>`,
  svg: (W, H) => `<rect width='${W}' height='${H}' fill='url(#${id})'/>`,
});

function scene({ W, H, glows, beams = [], cam, ribbons, balls, calm }) {
  let defs = commonDefs; let body = `<rect width='${W}' height='${H}' fill='${BASE}'/>`;
  glows.forEach((g, i) => { const gl = glow(`gl${i}`, ...g); defs += gl.defs; body += gl.svg(W, H); });
  // floodlight beams: soft cones from lights above the screen
  beams.forEach(([ax, ay, deg, spread, len, op], i) => {
    const pt2 = (d, l) => [ax + l * Math.cos(d * Math.PI / 180), ay + l * Math.sin(d * Math.PI / 180)];
    const [ex, ey] = pt2(deg, len);
    defs += `<linearGradient id='bm${i}' gradientUnits='userSpaceOnUse' x1='${ax}' y1='${ay}' x2='${f(ex)}' y2='${f(ey)}'><stop offset='0' stop-color='#7dffd6' stop-opacity='${op}'/><stop offset='.5' stop-color='${GLOW}' stop-opacity='${f(op * 0.4 * 1000) / 1000}'/><stop offset='1' stop-color='${GLOW}' stop-opacity='0'/></linearGradient>`;
    body += `<path d='${poly([[ax, ay], pt2(deg - spread / 2, len), pt2(deg + spread / 2, len)])}' fill='url(#bm${i})' filter='url(#blur9)'/>`;
  });
  const pt = pitch(cam, H); defs += pt.defs;
  // floodlight pool on the grass
  defs += `<radialGradient id='pool' gradientUnits='userSpaceOnUse' cx='${cam.poolX}' cy='${H}' r='1' gradientTransform='translate(${cam.poolX} ${H}) scale(${W * 0.55} ${(H - cam.horizon) * 1.1}) translate(${-cam.poolX} ${-H})'><stop offset='0' stop-color='${GLOW}' stop-opacity='.09'/><stop offset='1' stop-color='${GLOW}' stop-opacity='0'/></radialGradient>`;
  body += `<rect y='${cam.horizon}' width='${W}' height='${H - cam.horizon}' fill='url(#pool)'/>` + pt.svg;
  // a calm zone behind the main text: ribbons are dimmed there
  defs += `<radialGradient id='calmG' gradientUnits='userSpaceOnUse' cx='${calm[0]}' cy='${calm[1]}' r='1' gradientTransform='translate(${calm[0]} ${calm[1]}) scale(${calm[2]} ${calm[3]}) translate(${-calm[0]} ${-calm[1]})'><stop offset='0' stop-color='#000' stop-opacity='.62'/><stop offset='1' stop-color='#000' stop-opacity='0'/></radialGradient><mask id='calm' maskUnits='userSpaceOnUse' x='0' y='0' width='${W}' height='${H}'><rect width='${W}' height='${H}' fill='#fff'/><rect width='${W}' height='${H}' fill='url(#calmG)'/></mask>`;
  let rib = '';
  ribbons.forEach((r, i) => { const rb = ribbon(r, `rb${i}`); defs += rb.defs; rib += rb.svg; });
  body += `<g mask='url(#calm)'>${rib}</g>`;
  body += balls.map(ball).join('');
  // vignette: edges sink into the base colour
  defs += `<radialGradient id='vig' cx='.5' cy='.45' r='.75'><stop offset='.6' stop-color='${BASE}' stop-opacity='0'/><stop offset='1' stop-color='${BASE}' stop-opacity='.55'/></radialGradient>`;
  body += `<rect width='${W}' height='${H}' fill='url(#vig)'/>`;
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}' preserveAspectRatio='xMidYMid slice'><defs>${defs}</defs>${body}</svg>`;
}

// Wide screens (drawn at 1600x1000, shown with background-size: cover).
const wide = scene({
  W: 1600, H: 1000,
  glows: [[140, -80, 950, 720, '#11936f', 0.24], [1480, -60, 760, 620, '#0e8064', 0.16], [1180, 640, 620, 380, '#0a5e4b', 0.1]],
  beams: [[-120, -160, 52, 15, 1250, 0.07], [-40, -200, 63, 9, 1200, 0.05], [1720, -180, 128, 13, 1200, 0.06]],
  cam: { cx: 930, horizon: 455, focal: 860, height: 15, x: 5, z: -30, yaw: 13, poolX: 980 },
  calm: [450, 470, 500, 300],
  ribbons: [
    // the tennis ball's light trail (it ends under the ball)
    { a: [[-80, 700], [380, 560], [900, 470], [1320, 244]], b: [[-80, 900], [520, 760], [1060, 390], [1334, 288]], n: 46, strength: 1, peak: 0.9, endOp: 0.75, width: 110, twist: 0.8 },
    { a: [[-60, 200], [240, 110], [520, 90], [840, -60]], b: [[-60, 290], [320, 200], [580, 110], [880, -10]], n: 26, strength: 0.6, peak: 0.42, width: 60, twist: 0.7 },
    { a: [[1700, 450], [1440, 580], [1360, 820], [1230, 1070]], b: [[1700, 590], [1520, 720], [1480, 900], [1400, 1070]], n: 30, strength: 0.75, peak: 0.45, width: 70, twist: 0.75 },
  ],
  balls: [
    ['volleyball', 1540, 470, 40, 45, 35, 0, 2],
    ['tennis', 1338, 264, 30, 20, 30, 10],
    ['basketball', 70, 215, 135, -40, 15, -50],
    ['soccer', 1445, 840, 150, 18, -12, 8, 0, true],
  ],
});
// Portrait screens (drawn at 600x1400, shown full width from the top).
const phone = scene({
  W: 600, H: 1400,
  glows: [[540, -60, 560, 560, '#11936f', 0.26], [40, 1360, 520, 400, '#0e8064', 0.14]],
  beams: [[700, -120, 118, 14, 1300, 0.07], [640, -160, 108, 8, 1250, 0.05]],
  cam: { cx: 340, horizon: 860, focal: 520, height: 15, x: 3, z: -22, yaw: 16, poolX: 330 },
  calm: [300, 650, 380, 420],
  ribbons: [
    // the basketball's light trail (it ends under the ball)
    { a: [[-60, 960], [170, 820], [360, 560], [482, 296]], b: [[-60, 1120], [260, 940], [470, 520], [494, 396]], n: 40, strength: 1, peak: 0.88, endOp: 0.7, width: 90, twist: 0.8 },
    { a: [[-40, 250], [120, 190], [260, 130], [430, -40]], b: [[-40, 320], [170, 260], [310, 160], [470, -10]], n: 22, strength: 0.55, peak: 0.45, width: 50, twist: 0.7 },
  ],
  balls: [
    ['volleyball', 588, 905, 36, 45, 35, 0, 2],
    ['basketball', 585, 330, 112, -40, 15, -50],
    ['soccer', 100, 1185, 125, 18, -12, 8, 0, true],
  ],
});
// Fine grain (tiny repeating tile): breaks up the banding of dark gradients.
const grain = `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n' x='0' y='0'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .75  0 0 0 0 1  0 0 0 0 .9  .5 0 0 0 -.22'/></filter><rect width='180' height='180' filter='url(#n)' opacity='.32'/></svg>`;

// base64: the drawings use url(#id) internally, which the public build scanner would read as files.
const toUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const variants = { '--design-bg-arena': wide, '--design-bg-arena-phone': phone, '--design-bg-grain': grain };
const cssPath = fileURLToPath(new URL('../../Idee Site/css/design-background.css', import.meta.url));
let css = readFileSync(cssPath, 'utf8');
for (const [name, svg] of Object.entries(variants)) {
  const pattern = new RegExp(`${name}: url\\("[^"]*"\\);`);
  if (!pattern.test(css)) throw new Error(`${name} line not found in design-background.css`);
  css = css.replace(pattern, () => `${name}: url("${toUri(svg)}");`);
  console.log(`fundal-arena: ${name} ${(toUri(svg).length / 1024).toFixed(1)} KB`);
}
writeFileSync(cssPath, css);
const out = process.argv.indexOf('--svg');
if (out > 0) for (const [name, svg] of Object.entries(variants)) writeFileSync(`${process.argv[out + 1]}${name.replace('--design-bg', '')}.svg`, svg);
