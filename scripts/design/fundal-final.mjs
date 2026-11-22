// Generates the "Fundal Final" background (owner's reference: Desktop\Spotivity\FundalFinal.jpeg)
// as a seamless vector tile and writes it into Idee Site/css/design-background.css
// (the --design-bg-final variable). Vector instead of the 547x1600 JPEG so it stays sharp
// on wide and retina screens and weighs a fraction of the photo.
// Run: node scripts/design/fundal-final.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const W = 547;   // same coordinate system as the reference photo
const H = 1600;
const ICON = '#1c7a63';      // line-art colour (drawn at low opacity)
const ICON_OPACITY = 0.3;
const GLOW = '#14a07e';
const PENT = '#1f9a7a';     // lit soccer-ball pentagons      // brightest emerald of the light ribbons

const f = (n) => Number(n.toFixed(1));
let uid = 0;

// ---------- icons (local coordinates, a 100-unit circle = ball size) ----------
// Drawn on a clean geometric grid: one stroke weight, round joins, true symmetry.
const P = (x, y) => `${f(x)} ${f(y)}`;
const polar = (r, deg) => [r * Math.cos(deg * Math.PI / 180), r * Math.sin(deg * Math.PI / 180)];
const poly = (pts) => `M${pts.map(([x, y]) => P(x, y)).join('L')}Z`;
function star(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 10; i++) { const [x, y] = polar(i % 2 ? r * 0.42 : r, -90 + i * 36); pts.push([cx + x, cy + y]); }
  return poly(pts);
}

// ---- balls are real 3D spheres (rotated, projected, back half hidden) so the seams curve
// like in the reference instead of looking flat ----
const norm = ([x, y, z]) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };
function rotator(yaw, pitch, roll) {
  const r = (d) => d * Math.PI / 180;
  const [cy, sy, cp, sp, cr, sr] = [Math.cos(r(yaw)), Math.sin(r(yaw)), Math.cos(r(pitch)), Math.sin(r(pitch)), Math.cos(r(roll)), Math.sin(r(roll))];
  return ([x, y, z]) => {
    const X = x * cy + z * sy; let Z = -x * sy + z * cy;           // yaw (around y)
    const Y = y * cp - Z * sp; Z = y * sp + Z * cp;                 // pitch (around x)
    return [X * cr - Y * sr, X * sr + Y * cr, Z];                   // roll (in the picture plane)
  };
}
// great-circle samples between two points of the sphere
const arc = (a, b, n = 10) => Array.from({ length: n + 1 }, (_, i) => norm(a.map((v, k) => v + (b[k] - v) * i / n)));
// visible (front) parts of 3D polylines as one SVG path; R = ball radius
function frontPath(lines, rot, R = 50) {
  let d = '';
  for (const line of lines) {
    let open = false;
    for (const p of line) {
      const [x, y, z] = rot(p);
      if (z > 0.015) { d += `${open ? 'L' : 'M'}${P(x * R, -y * R)}`; open = true; } else open = false;
    }
  }
  return d;
}
const ballBase = `<circle r='50' fill='url(%23ballFill)' stroke='none'/>`;

// Soccer ball: a true truncated icosahedron on the sphere (20 hexagons, 12 lit pentagons).
const PHI = (1 + Math.sqrt(5)) / 2;
function cyclicSigned(base) {
  const out = new Map();
  for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) {
    const v = [base[0] * sx, base[1] * sy, base[2] * sz];
    for (const q of [v, [v[1], v[2], v[0]], [v[2], v[0], v[1]]]) out.set(q.map((n) => (n + 0).toFixed(4)).join(), q);
  }
  return [...out.values()];
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
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
function soccer(yaw = 18, pitch = -14, roll = 8) {
  const rot = rotator(yaw, pitch, roll);
  const light = norm([-0.35, 0.45, 1]);
  let fills = '';
  for (const { n, ring } of TI_PENTS) {
    const c = rot(n);
    if (c[2] < -0.25) continue;
    const pts = ring.flatMap((a, i) => arc(a, ring[(i + 1) % 5], 4)).map((p) => {
      const [x, y, z] = rot(p);
      if (z >= 0) return [x * 50, -y * 50];
      const l = Math.hypot(x, y); return [x / l * 50, -y / l * 50];   // behind the rim: pin to the outline
    });
    const lit = Math.max(0, dot(c, light));
    fills += `<path d='${poly(pts)}' fill='url(%23pentFill)' fill-opacity='${f(0.25 + 0.75 * lit)}' stroke='none'/>`;
  }
  return `${ballBase}${fills}<path d='${frontPath(TI_EDGES.map(([a, b]) => arc(a, b, 6)), rot)}'/><circle r='50'/>`;
}
// Basketball: two perpendicular great-circle seams and the two curved side seams.
function basketball(yaw = -40, pitch = 15, roll = -50) {
  const rot = rotator(yaw, pitch, roll);
  const N = 72; const T = (i) => i / N * 2 * Math.PI;
  const circle = (fn) => Array.from({ length: N + 1 }, (_, i) => fn(T(i)));
  const k = 0.62; const s = Math.sqrt(1 - k * k);
  const lines = [
    circle((t) => [Math.cos(t), 0, Math.sin(t)]),
    circle((t) => [0, Math.cos(t), Math.sin(t)]),
    circle((t) => [k, s * Math.cos(t), s * Math.sin(t)]),
    circle((t) => [-k, s * Math.cos(t), s * Math.sin(t)]),
  ];
  return `${ballBase}<path d='${frontPath(lines, rot)}'/><circle r='50'/>`;
}
// Volleyball: the cube layout (6 faces x 3 strips, neighbouring faces at right angles).
function volleyball(yaw = 45, pitch = 35, roll = 0) {
  const rot = rotator(yaw, pitch, roll);
  const lines = [];
  const corners = [];
  for (const x of [1, -1]) for (const y of [1, -1]) for (const z of [1, -1]) corners.push([x, y, z]);
  corners.forEach((a, i) => corners.forEach((b, j) => { if (j > i && a.filter((v, q) => v !== b[q]).length === 1) lines.push(arc(norm(a), norm(b), 16)); }));
  for (let ax = 0; ax < 3; ax++) for (const sg of [1, -1]) for (const u of [-1 / 3, 1 / 3]) {
    const pts = [];
    for (let i = 0; i <= 16; i++) { const p = [0, 0, 0]; p[ax] = sg; p[(ax + 1) % 3] = u; p[(ax + 2) % 3] = -1 + i / 8; pts.push(norm(p)); }
    lines.push(pts);
  }
  return `${ballBase}<path d='${frontPath(lines, rot)}'/><circle r='50'/>`;
}
// Trophy: flared bowl, loop handles, slim stem opening into a trapezoid base with a plate.
const trophy = () => `<path d='M-28 -44H28C28 -20 18 -2 4 3C3 12 4 19 12 26H-12C-4 19 -3 12 -4 3C-18 -2 -28 -20 -28 -44Z'/><path d='M-27 -37C-42 -40 -48 -27 -41 -17C-36 -10 -28 -8 -21 -10M27 -37C42 -40 48 -27 41 -17C36 -10 28 -8 21 -10M-15 26H15L20 44H-20ZM-9 35H9'/><path d='${star(0, -23, 9.5)}'/>`;
// Referee whistle in 3/4 view, after the reference: a slightly curved body (top face +
// side face split by a ridge), a boxy mouthpiece end at the lower left, a round chamber
// that hooks back under itself at the right, two grip lines and three sound rays.
function whistle() {
  const cubic = (p, t) => { const u = 1 - t; return [0, 1].map((k) => u * u * u * p[0][k] + 3 * u * u * t * p[1][k] + 3 * u * t * t * p[2][k] + t * t * t * p[3][k]); };
  const top = [[-40, -8], [-24, -13], [-6, -17], [12, -17]];        // top edge
  const ridge = [[-39, 0], [-23, -5], [-6, -9], [10, -9]];           // top face / side face edge
  const C = (p) => `C${P(...p[1])} ${P(...p[2])} ${P(...p[3])}`;
  const outline = `M${P(...top[0])}${C(top)}`
    + 'C26 -17 36 -8 36 4C36 13 31 19 25 19'                       // big round chamber (smooth join)
    + 'Q20 19 17 14'                                             // hook back into the opening
    + 'C8 13 -10 16 -24 22'                                          // underside
    + 'L-32 25Q-38 27 -41 21L-45 9Q-46 0 -40 -8Z';      // mouthpiece end
  const edges = `M${P(...ridge[0])}${C(ridge)}Q16.5 0 17 14`         // ridge, curling into the chamber opening
    + `M${P(...top[0])}L${P(...ridge[0])}L-32 25`;                 // mouthpiece end face
  const grips = [0.36, 0.6].map((t) => `M${P(...cubic(top, t))}L${P(...cubic(ridge, t))}`).join('');
  const rays = [-92, -55, -18].map((a) => { const [x1, y1] = polar(23, a); const [x2, y2] = polar(31, a); return `M${P(22 + x1, 1 + y1)}L${P(22 + x2, 1 + y2)}`; }).join('');
  return `<path d='${outline}'/><path d='${edges}${grips}'/><path d='${rays}'/>`;
}
// Stopwatch: double ring, crown, two side buttons, one hand.
function stopwatch() {
  const btn = (a) => { const [x1, y1] = polar(40, a); const [x2, y2] = polar(47, a); const [px, py] = polar(4, a + 90); return `M${P(x1, y1)}L${P(x2, y2)}M${P(x2 - px, y2 - py)}L${P(x2 + px, y2 + py)}`; };
  return `<circle r='40'/><circle r='33'/><path d='M0 -40V-46M-9 -53Q-9 -56 -6 -56H6Q9 -56 9 -53V-49Q9 -46 6 -46H-6Q-9 -46 -9 -49Z${btn(-135)}${btn(-45)}M0 0L11 -19'/><circle r='3.5'/>`;
}
const jersey = () => `<path d='M-18 -48Q0 -40 18 -48L44 -38L64 -10L48 0L40 -10V52Q40 56 36 56H-36Q-40 56 -40 52V-10L-48 0L-64 -10L-44 -38Z'/><path d='M-18 -48Q0 -30 18 -48M-56 -21L-41 -12M56 -21L41 -12'/><path d='M-24 -2L-15 -9V27M2 -9H12A6 6 0 0 1 18 -3V21A6 6 0 0 1 12 27H2A6 6 0 0 1 -4 21V-3A6 6 0 0 1 2 -9Z'/>`;
// Racket: oval head with an open string grid, curved throat, banded grip.
function racket() {
  const id = `rk${uid++}`;
  let strings = '';
  for (let x = -30; x <= 30; x += 10) strings += `M${x} -84V24`;
  for (let y = -70; y <= 10; y += 10) strings += `M-44 ${y}H44`;
  return `<clipPath id='${id}'><ellipse cx='0' cy='-30' rx='40' ry='50'/></clipPath><path d='${strings}' clip-path='url(%23${id})' stroke-opacity='${f(ICON_OPACITY * 0.8 * 100) / 100}'/><ellipse cx='0' cy='-30' rx='40' ry='50'/><path d='M-15 15C-9 25 -7 32 -7 42M15 15C9 25 7 32 7 42M-7 42H7V98Q7 102 3 102H-3Q-7 102 -7 98ZM-7 54L7 58M-7 66L7 70M-7 78L7 82M-7 90L7 94'/>`;
}
const plus = (s = 9) => `<path d='M-${s} 0H${s}M0 -${s}V${s}'/>`;
const cross = (s = 8) => `<path d='M-${s} -${s}L${s} ${s}M${s} -${s}L-${s} ${s}'/>`;
const ring = (r) => `<circle r='${r}'/>`;
function dots(cols, rows, gap = 14) {
  let d = '';
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) d += `<circle cx='${i * gap}' cy='${j * gap}' r='1.8'/>`;
  return `<g fill='${ICON}' stroke='none' fill-opacity='.8'>${d}</g>`;
}

// [draw, x, y, scale, rotation, radius-for-wrapping (in tile units)]
const icons = [
  [soccer, 95, 62, 1.78, 0, 92],
  [() => dots(3, 3), 470, 40, 1, 0, 30],
  [trophy, 402, 166, 1.45, -4, 80],
  [() => plus(), 222, 183, 1, 0, 10],
  [() => ring(7), 332, 240, 1, 0, 9],
  [whistle, 218, 282, 1.15, -22, 56],
  [() => ring(7), 44, 358, 1, 0, 9],
  [() => cross(), 98, 346, 1, 0, 10],
  [basketball, 476, 366, 1.58, 0, 82],
  [stopwatch, 100, 452, 1.05, 0, 58],
  [() => cross(), 226, 406, 1, 0, 10],
  [() => dots(4, 4, 15), 16, 516, 1, 0, 50],
  [() => dots(4, 3, 15), 310, 540, 1, 0, 50],
  [volleyball, 187, 636, 1.36, 0, 70],
  [jersey, 468, 684, 1.15, 6, 85],
  [() => ring(8), 35, 688, 1, 0, 10],
  [() => ring(11), 325, 698, 1, 0, 13],
  [() => cross(), 368, 756, 1, 0, 10],
  [() => plus(), 515, 815, 1, 0, 10],
  [racket, 402, 905, 1.25, 38, 120],
  [trophy, 140, 978, 1.5, 6, 85],
  [() => ring(7), 45, 1026, 1, 0, 9],
  [() => ring(12), 248, 1088, 1, 0, 14],
  [() => cross(), 182, 1134, 1, 0, 10],
  [() => dots(4, 3, 15), 455, 1050, 1, 0, 50],
  [() => volleyball(45, -35, 15), 40, 1196, 1.92, 0, 96],
  [whistle, 330, 1180, 1.15, -22, 56],
  [() => ring(18), 488, 1188, 1, 0, 20],
  [() => soccer(-24, 10, -6), 480, 1332, 1.72, 0, 88],
  [() => ring(12), 208, 1380, 1, 0, 14],
  [() => plus(), 362, 1386, 1, 0, 10],
  [() => dots(2, 2, 14), 356, 1276, 1, 0, 20],
  [jersey, 78, 1468, 0.95, -16, 70],
  [() => cross(), 226, 1470, 1, 0, 10],
  [() => dots(4, 6, 15), 330, 1462, 1, 0, 80],
];

// ---------- light ribbons (crescents) ----------
// [start, end, outer control, inner control, strength, where the light peaks (0..1 along it)]
const ribbons = [
  [[-20, 318], [345, -20], [130, 150], [160, 190], 0.5, 0.35],
  [[-20, 250], [210, 110], [60, 150], [80, 170], 0.25, 0.4],
  [[282, 252], [560, 70], [300, 110], [340, 150], 0.3, 0.4],
  [[560, 240], [560, 520], [20, 400], [170, 385], 1, 0.5],
  [[-30, 840], [560, 470], [220, 770], [240, 720], 0.85, 0.2],
  [[150, 845], [-20, 1070], [-10, 860], [50, 905], 0.55, 0.45],
  [[560, 860], [560, 1125], [140, 1000], [300, 995], 0.8, 0.4],
  [[130, 1250], [560, 1140], [300, 1090], [330, 1170], 0.35, 0.5],
  [[-30, 1390], [270, 1290], [70, 1290], [100, 1320], 0.35, 0.35],
  [[170, 1620], [560, 1380], [250, 1420], [330, 1480], 0.85, 0.45],
];

// Copies needed so an element cut by a tile edge continues on the opposite edge.
function wrapOffsets(minX, minY, maxX, maxY, wrapX) {
  const xs = [0]; const ys = [0];
  if (wrapX && minX < 0) xs.push(W); if (wrapX && maxX > W) xs.push(-W);
  if (minY < 0) ys.push(H); if (maxY > H) ys.push(-H);
  return xs.flatMap((dx) => ys.map((dy) => [dx, dy]));
}

const pct = (v) => f(v * 100) / 100;
function build(wrapX) {
  uid = 0;
  let defs = `<linearGradient id='pentFill' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${PENT}' stop-opacity='.55'/><stop offset='1' stop-color='${ICON}' stop-opacity='.18'/></linearGradient><radialGradient id='ballFill' cx='.38' cy='.32' r='.75'><stop offset='0' stop-color='${ICON}' stop-opacity='.15'/><stop offset='1' stop-color='${ICON}' stop-opacity='.02'/></radialGradient>`;
  let ribbonSvg = '';
  ribbons.forEach(([a, b, co, ci, k, peak], i) => {
    const gid = `g${i}`;
    defs += `<linearGradient id='${gid}' gradientUnits='userSpaceOnUse' x1='${a[0]}' y1='${a[1]}' x2='${b[0]}' y2='${b[1]}'><stop offset='0' stop-color='${GLOW}' stop-opacity='0'/><stop offset='${peak}' stop-color='${GLOW}' stop-opacity='${pct(0.6 * k)}'/><stop offset='${pct(peak + (1 - peak) * 0.45)}' stop-color='${GLOW}' stop-opacity='${pct(0.22 * k)}'/><stop offset='1' stop-color='${GLOW}' stop-opacity='0'/></linearGradient>`;
    const xsAll = [a[0], b[0], co[0]]; const ysAll = [a[1], b[1], co[1]];
    for (const [dx, dy] of wrapOffsets(Math.min(...xsAll), Math.min(...ysAll), Math.max(...xsAll), Math.max(...ysAll), wrapX)) {
      const P = ([x, y]) => `${x + dx} ${y + dy}`;
      const outer = `M${P(a)}Q${P(co)} ${P(b)}`;
      // soft body: faint filled crescent, then wide-to-narrow edge strokes that read as a glow
      ribbonSvg += `<path d='${outer}Q${P(ci)} ${P(a)}Z' fill='url(%23${gid})' fill-opacity='.55'/>`;
      ribbonSvg += `<path d='${outer}' fill='none' stroke='url(%23${gid})' stroke-width='26' stroke-opacity='.08'/>`;
      ribbonSvg += `<path d='${outer}' fill='none' stroke='url(%23${gid})' stroke-width='12' stroke-opacity='.16'/>`;
      ribbonSvg += `<path d='${outer}' fill='none' stroke='url(%23${gid})' stroke-width='4.5' stroke-opacity='.32'/>`;
      ribbonSvg += `<path d='${outer}' fill='none' stroke='url(%23${gid})' stroke-width='1.4' stroke-opacity='.85'/>`;
    }
  });
  let iconSvg = '';
  for (const [draw, x, y, s, rot, r] of icons) {
    const body = draw();
    for (const [dx, dy] of wrapOffsets(x - r, y - r, x + r, y + r, wrapX)) {
      iconSvg += `<g transform='translate(${x + dx} ${y + dy}) rotate(${rot}) scale(${s})' stroke-width='${f(2.3 / s * 10) / 10}'>${body}</g>`;
    }
  }
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}'><defs>${defs}</defs>${ribbonSvg}<g fill='none' stroke='${ICON}' stroke-opacity='${ICON_OPACITY}' stroke-linecap='round' stroke-linejoin='round'>${iconSvg}</g></svg>`;
}
// base64: the gradients use url(#id) internally, which the public build scanner would
// otherwise read as a file reference.
const toUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg.replace(/%23/g, '#')).toString('base64')}`;

// Wide screens: tiles sit side by side, so edges wrap both ways (seamless).
// Phones: one tile spans the width, so only top/bottom wrap (exactly like the photo).
// Wide screens: a double panel (2W x H). The right half is the same drawing moved down by
// SHIFT, so side-by-side repeats never line up in identical rows. Elements cut at an edge
// continue into the neighbouring half. SHIFT is chosen so those continuations overlap
// the other half's drawings as little as possible.
// Wide panel: the two columns sit COL_GAP apart, so the big balls cut at a column edge never touch
// the neighbouring column (nothing is clipped, so the drawing still continues seamlessly).
const COL_GAP = 40; const PITCH = W + COL_GAP;
function overlapCost(shift) {
  let cost = 0;
  for (const [, x1, y1, , , r1] of icons) {
    for (const [, x2, y2, , , r2] of icons) {
      for (const dx of [PITCH, -PITCH]) {
        for (const wy of [-H, 0, H]) {
          const d = Math.hypot(x1 - (x2 + dx), y1 - (y2 + shift + wy));
          cost += Math.max(0, r1 + r2 + 12 - d) ** 2;
        }
      }
    }
  }
  return cost;
}
let SHIFT = 800; let best = Infinity;
for (let s = 420; s <= 1180; s += 4) { const c = overlapCost(s); if (c < best) { best = c; SHIFT = s; } }
function buildWide() {
  const base = build(false);
  const inner = base.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  const defsEnd = inner.indexOf('</defs>') + '</defs>'.length;
  const defs = inner.slice(0, defsEnd);
  const art = inner.slice(defsEnd);
  const uses = [[0, 0], [2 * PITCH, 0], [PITCH, SHIFT], [-PITCH, SHIFT], [PITCH, SHIFT - H], [-PITCH, SHIFT - H]]
    .map(([x, y]) => `<use href='%23art' x='${x}' y='${y}'/>`).join('');
  return `<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' width='${2 * PITCH}' height='${H}' viewBox='0 0 ${2 * PITCH} ${H}'>${defs.replace('</defs>', `<g id='art'>${art}</g></defs>`)}${uses}</svg>`;
}
const variants = { '--design-bg-final': buildWide(), '--design-bg-final-phone': build(false) };
console.log(`fundal-final: wide panel shift ${SHIFT}px (overlap score ${best.toFixed(0)})`);
for (const [, x1, y1, , , r1] of icons) for (const [, x2, y2, , , r2] of icons) for (const dx of [PITCH, -PITCH]) for (const wy of [-H, 0, H]) {
  const gap = Math.hypot(x1 - (x2 + dx), y1 - (y2 + SHIFT + wy)) - r1 - r2;
  if (gap < 0) console.log(`  touch across a join: (${x1},${y1}) and (${x2},${y2}) by ${(-gap).toFixed(0)}px`);
}
const cssPath = fileURLToPath(new URL('../../Idee Site/css/design-background.css', import.meta.url));
let css = readFileSync(cssPath, 'utf8');
for (const [name, svg] of Object.entries(variants)) {
  const pattern = new RegExp(`${name}: url\\("[^"]*"\\);`);
  if (!pattern.test(css)) throw new Error(`${name} line not found in design-background.css`);
  css = css.replace(pattern, () => `${name}: url("${toUri(svg)}");`);
  console.log(`fundal-final: ${name} ${(toUri(svg).length / 1024).toFixed(1)} KB`);
}
writeFileSync(cssPath, css);
const out = process.argv.indexOf('--svg');
if (out > 0) {
  writeFileSync(`${process.argv[out + 1]}-wide.svg`, variants['--design-bg-final'].replace(/%23/g, '#'));
  writeFileSync(`${process.argv[out + 1]}-phone.svg`, variants['--design-bg-final-phone'].replace(/%23/g, '#'));
}

// Optional check sheet: every icon drawn large and bright (node ... --sheet out.svg).
const sheetAt = process.argv.indexOf('--sheet');
if (sheetAt > 0) {
  const list = [soccer, basketball, volleyball, trophy, whistle, stopwatch, jersey, racket];
  const cells = list.map((draw, i) => `<g transform='translate(${130 + (i % 4) * 260} ${150 + Math.floor(i / 4) * 300}) scale(2)' stroke-width='1.15'>${draw()}</g>`).join('');
  const sheet = `<svg xmlns='http://www.w3.org/2000/svg' width='1040' height='600'><defs><linearGradient id='pentFill' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${PENT}' stop-opacity='.9'/><stop offset='1' stop-color='${ICON}' stop-opacity='.3'/></linearGradient><linearGradient id='pentFill' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${PENT}' stop-opacity='.55'/><stop offset='1' stop-color='${ICON}' stop-opacity='.18'/></linearGradient><radialGradient id='ballFill' cx='.38' cy='.32' r='.75'><stop offset='0' stop-color='${ICON}' stop-opacity='.3'/><stop offset='1' stop-color='${ICON}' stop-opacity='.05'/></radialGradient></defs><rect width='1040' height='600' fill='#011012'/><g fill='none' stroke='#3fd1a8' stroke-opacity='.85' stroke-linecap='round' stroke-linejoin='round'>${cells}</g></svg>`;
  writeFileSync(process.argv[sheetAt + 1], sheet.replace(/%23/g, '#'));
}
