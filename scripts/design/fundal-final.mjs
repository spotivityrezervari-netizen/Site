// Generates the "Fundal Final" background (owner's reference: Desktop\Spotivity\FundalFinal.jpeg)
// as a seamless tile. Brought back on 25.11.2026 (owner: "adu-mi modelul de pe poza de referință",
// Modificari\Design\calereferinta.jpeg), exported as WebP files instead of a CSS data URI:
//   Idee Site/assets/imagini/fundal-final-desktop.webp  (double panel 1094x1600, rendered at 1.5x)
//   Idee Site/assets/imagini/fundal-final-mobil.webp    (one column 547x1600, rendered at 2x)
// Run: CHROMIUM_PATH=<Edge/Chromium> node scripts/design/fundal-final.mjs [--svg <prefix>] [--dry]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const W = 547;   // same coordinate system as the reference photo
const H = 1600;
const ICON = '#1c7a63';      // line-art colour (drawn at low opacity)
const ICON_OPACITY = 0.27;
const GLOW = '#0f8a6a';      // brightest emerald of the light ribbons

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

// Soccer ball seen from a pentagon: centre pentagon, five hexagon seams, five rim pentagons.
function soccer() {
  const id = `sb${uid++}`;
  const a = 15; const junction = 29; const b = 13; const dist = junction + b;
  const centre = [0, 1, 2, 3, 4].map((i) => polar(a, -90 + 72 * i));
  let seams = ''; let patches = poly(centre);
  const outer = [0, 1, 2, 3, 4].map((i) => {
    const th = -90 + 72 * i;
    const [cx, cy] = polar(dist, th);
    return [0, 1, 2, 3, 4].map((k) => { const [x, y] = polar(b, th + 180 + 72 * k); return [cx + x, cy + y]; });
  });
  outer.forEach((pent, i) => {
    const th = -90 + 72 * i;
    patches += poly(pent);
    seams += `M${P(...centre[i])}L${P(...pent[0])}`;                 // centre vertex -> rim pentagon
    seams += `M${P(...pent[4])}L${P(...outer[(i + 1) % 5][1])}`;      // hexagon outer edge
    for (const k of [2, 3]) {                                          // rim pentagon -> edge of ball
      const [x, y] = pent[k]; const [ex, ey] = polar(60, th + (k === 2 ? -28 : 28));
      seams += `M${P(x, y)}L${P(ex, ey)}`;
    }
  });
  return `<clipPath id='${id}'><circle r='49'/></clipPath><circle r='50' fill='url(%23ballFill)' stroke='none'/><g clip-path='url(%23${id})'><path d='${patches}' fill='${ICON}' fill-opacity='.2'/><path d='${seams}'/></g><circle r='50'/>`;
}
const basketball = () => `<circle r='50' fill='url(%23ballFill)' stroke='none'/><circle r='50'/><path d='M0 -50V50M-50 0H50M-36 -34.7C-17 -14 -17 14 -36 34.7M36 -34.7C17 -14 17 14 36 34.7'/>`;
// Volleyball: three seams from the centre (120 deg apart), each with one parallel panel line.
function volleyball() {
  const unit = `M0 0C10 14 26 22 43.3 25M-19.4 5.6C-6 22 14 34 36 34.7`;
  const seams = [0, 120, 240].map((r) => `<path d='${unit}' transform='rotate(${r})'/>`).join('');
  return `<circle r='50' fill='url(%23ballFill)' stroke='none'/><circle r='50'/>${seams}`;
}
const trophy = () => `<path d='M-26 -44H26V-26C26 -6 14 8 0 10C-14 8 -26 -6 -26 -26Z'/><path d='M-26 -36H-34C-41 -36 -44 -30 -42 -23C-40 -15 -33 -9 -23 -7M26 -36H34C41 -36 44 -30 42 -23C40 -15 33 -9 23 -7M-4 10V24M4 10V24M-11 24H11V31H-11ZM-21 31H21V45H-21ZM-10 38H10'/><path d='${star(0, -22, 9)}'/>`;
const whistle = () => `<path d='M0 -10H42Q46 -10 46 -6V2Q46 6 42 6H19.6A20 20 0 1 1 0 -10Z'/><path d='M10 -10V-5H18V-10'/><circle cx='0' cy='10' r='7'/><circle cx='-17.6' cy='-7.6' r='5'/><path d='M53 -14L59 -21M55 -2H63M48 -20L50 -28'/>`;
function stopwatch() {
  let ticks = '';
  for (let i = 0; i < 12; i++) { const r1 = i % 3 ? 31 : 28; const [x1, y1] = polar(r1, i * 30); const [x2, y2] = polar(34, i * 30); ticks += `M${P(x1, y1)}L${P(x2, y2)}`; }
  const [bx1, by1] = polar(40, -45); const [bx2, by2] = polar(47, -45);
  return `<circle r='40'/><path d='${ticks}' stroke-opacity='.7'/><path d='M-8 -53H8V-46H-8ZM0 -46V-40M${P(bx1, by1)}L${P(bx2, by2)}M0 0L-11 18M0 0V-22'/><circle r='3'/>`;
}
const jersey = () => `<path d='M-18 -48Q0 -40 18 -48L44 -38L64 -10L48 0L40 -10V52Q40 56 36 56H-36Q-40 56 -40 52V-10L-48 0L-64 -10L-44 -38Z'/><path d='M-18 -48Q0 -28 18 -48M-56 -21L-41 -12M56 -21L41 -12'/><path d='M-24 -2L-15 -9V27M2 -9H12A6 6 0 0 1 18 -3V21A6 6 0 0 1 12 27H2A6 6 0 0 1 -4 21V-3A6 6 0 0 1 2 -9Z'/>`;
function racket() {
  const id = `rk${uid++}`;
  let strings = '';
  for (let x = -32; x <= 32; x += 8) strings += `M${x} -84V24`;
  for (let y = -76; y <= 16; y += 8) strings += `M-44 ${y}H44`;
  return `<clipPath id='${id}'><ellipse cx='0' cy='-30' rx='38' ry='48'/></clipPath><path d='${strings}' clip-path='url(%23${id})' stroke-opacity='.5' stroke-width='1'/><ellipse cx='0' cy='-30' rx='44' ry='54'/><path d='M-16 19C-10 30 -7 36 -6 44M16 19C10 30 7 36 6 44M-6 44H6V98Q6 102 2 102H-2Q-6 102 -6 98ZM-6 58H6M-6 72H6M-6 86H6'/>`;
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
  [soccer, 95, 62, 1.78, -8, 92],
  [() => dots(3, 3), 470, 40, 1, 0, 30],
  [trophy, 402, 166, 1.45, -4, 80],
  [() => plus(), 222, 183, 1, 0, 10],
  [() => ring(7), 332, 240, 1, 0, 9],
  [whistle, 218, 282, 1.4, -28, 80],
  [() => ring(7), 44, 358, 1, 0, 9],
  [() => cross(), 98, 346, 1, 0, 10],
  [basketball, 476, 366, 1.58, 18, 82],
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
  [volleyball, 22, 1196, 2.05, 30, 104],
  [whistle, 330, 1182, 1.4, -28, 80],
  [() => ring(18), 488, 1188, 1, 0, 20],
  [soccer, 480, 1332, 1.72, 12, 88],
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
  let defs = `<radialGradient id='ballFill' cx='.38' cy='.32' r='.75'><stop offset='0' stop-color='${ICON}' stop-opacity='.15'/><stop offset='1' stop-color='${ICON}' stop-opacity='.02'/></radialGradient>`;
  let ribbonSvg = '';
  ribbons.forEach(([a, b, co, ci, k, peak], i) => {
    const gid = `g${i}`;
    defs += `<linearGradient id='${gid}' gradientUnits='userSpaceOnUse' x1='${a[0]}' y1='${a[1]}' x2='${b[0]}' y2='${b[1]}'><stop offset='0' stop-color='${GLOW}' stop-opacity='0'/><stop offset='${peak}' stop-color='${GLOW}' stop-opacity='${pct(0.6 * k)}'/><stop offset='${pct(peak + (1 - peak) * 0.45)}' stop-color='${GLOW}' stop-opacity='${pct(0.22 * k)}'/><stop offset='1' stop-color='${GLOW}' stop-opacity='0'/></linearGradient>`;
    const xsAll = [a[0], b[0], co[0]]; const ysAll = [a[1], b[1], co[1]];
    for (const [dx, dy] of wrapOffsets(Math.min(...xsAll), Math.min(...ysAll), Math.max(...xsAll), Math.max(...ysAll), wrapX)) {
      const P = ([x, y]) => `${x + dx} ${y + dy}`;
      const outer = `M${P(a)}Q${P(co)} ${P(b)}`;
      // soft body: faint filled crescent, then wide-to-narrow edge strokes that read as a glow
      ribbonSvg += `<path d='${outer}Q${P(ci)} ${P(a)}Z' fill='url(%23${gid})' fill-opacity='.3'/>`;
      ribbonSvg += `<path d='${outer}' fill='none' stroke='url(%23${gid})' stroke-width='26' stroke-opacity='.05'/>`;
      ribbonSvg += `<path d='${outer}' fill='none' stroke='url(%23${gid})' stroke-width='12' stroke-opacity='.1'/>`;
      ribbonSvg += `<path d='${outer}' fill='none' stroke='url(%23${gid})' stroke-width='4.5' stroke-opacity='.22'/>`;
      ribbonSvg += `<path d='${outer}' fill='none' stroke='url(%23${gid})' stroke-width='1.2' stroke-opacity='.65'/>`;
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
function overlapCost(shift) {
  let cost = 0;
  for (const [, x1, y1, , , r1] of icons) {
    for (const [, x2, y2, , , r2] of icons) {
      for (const dx of [W, -W]) {
        for (const wy of [-H, 0, H]) {
          const d = Math.hypot(x1 - (x2 + dx), y1 - (y2 + shift + wy));
          cost += Math.max(0, r1 + r2 + 12 - d);
        }
      }
    }
  }
  return cost;
}
let SHIFT = 800; let best = Infinity;
for (let s = 560; s <= 1040; s += 4) { const c = overlapCost(s); if (c < best) { best = c; SHIFT = s; } }
function buildWide() {
  const base = build(false);
  const inner = base.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  const defsEnd = inner.indexOf('</defs>') + '</defs>'.length;
  const defs = inner.slice(0, defsEnd);
  const art = inner.slice(defsEnd);
  const uses = [[0, 0], [2 * W, 0], [W, SHIFT], [-W, SHIFT], [W, SHIFT - H], [-W, SHIFT - H]]
    .map(([x, y]) => `<use href='%23art' x='${x}' y='${y}'/>`).join('');
  return `<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' width='${2 * W}' height='${H}' viewBox='0 0 ${2 * W} ${H}'>${defs.replace('</defs>', `<g id='art'>${art}</g></defs>`)}${uses}</svg>`;
}
const variants = { '--design-bg-final': buildWide(), '--design-bg-final-phone': build(false) };
console.log(`fundal-final: wide panel shift ${SHIFT}px (overlap score ${best.toFixed(0)})`);
// The tiles are rendered at a higher pixel size (sharp on retina screens); the SVG keeps its viewBox.
const sized = (svg, w, h) => svg.replace(/%23/g, '#').replace(/^<svg([^>]*?) width='\d+' height='\d+'/, `<svg$1 width='${w}' height='${h}'`);
if (!process.argv.includes('--dry')) {
  const { rasterize } = await import('./fundal-raster.mjs');
  await rasterize({
    'fundal-final-desktop': { svg: sized(variants['--design-bg-final'], 1641, 2400), width: 1641, height: 2400, maxKB: 250 },
    'fundal-final-mobil': { svg: sized(variants['--design-bg-final-phone'], 1094, 3200), width: 1094, height: 3200, maxKB: 120 },
  }, fileURLToPath(new URL('../../Idee Site/assets/imagini/', import.meta.url)));
}
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
  const sheet = `<svg xmlns='http://www.w3.org/2000/svg' width='1040' height='600'><defs><radialGradient id='ballFill' cx='.38' cy='.32' r='.75'><stop offset='0' stop-color='${ICON}' stop-opacity='.3'/><stop offset='1' stop-color='${ICON}' stop-opacity='.05'/></radialGradient></defs><rect width='1040' height='600' fill='#011012'/><g fill='none' stroke='#3fd1a8' stroke-opacity='.85' stroke-linecap='round' stroke-linejoin='round'>${cells}</g></svg>`;
  writeFileSync(process.argv[sheetAt + 1], sheet.replace(/%23/g, '#'));
}
