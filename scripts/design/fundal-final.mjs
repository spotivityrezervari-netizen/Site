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
const ICON_OPACITY = 0.27;
const GLOW = '#0f8a6a';      // brightest emerald of the light ribbons

const f = (n) => Number(n.toFixed(1));
let uid = 0;

// ---------- icons (local coordinates, roughly 100 units across) ----------
const ballPentagon = (r) => Array.from({ length: 5 }, (_, i) => {
  const a = -Math.PI / 2 + i * 2 * Math.PI / 5;
  return [r * Math.cos(a), r * Math.sin(a)];
});
function soccer() {
  const p = ballPentagon(17);
  const spokes = ballPentagon(32);
  let d = `M${p.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`;
  const outer = [];
  p.forEach(([x, y], i) => {
    const [sx, sy] = spokes[i];
    d += `M${f(x)} ${f(y)}L${f(sx)} ${f(sy)}`;
    const a = -Math.PI / 2 + i * 2 * Math.PI / 5;
    for (const s of [-1, 1]) {
      const b = a + s * 0.62;
      d += `M${f(sx)} ${f(sy)}L${f(50 * Math.cos(b))} ${f(50 * Math.sin(b))}`;
    }
    outer.push(a + Math.PI / 5);
  });
  // dark outer patches between the spokes (like the filled pentagons in the photo)
  let patches = '';
  outer.forEach((a) => {
    const pts = [[38 * Math.cos(a), 38 * Math.sin(a)]];
    for (const s of [-1, 1]) pts.push([50 * Math.cos(a + s * 0.3), 50 * Math.sin(a + s * 0.3)]);
    patches += `M${f(pts[1][0])} ${f(pts[1][1])}L${f(pts[0][0])} ${f(pts[0][1])}L${f(pts[2][0])} ${f(pts[2][1])}Z`;
  });
  const centre = `M${p.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`;
  return `<circle r='50' fill='url(%23ballFill)' stroke='none'/><path d='${centre}${patches}' fill='${ICON}' fill-opacity='.1' stroke='none'/><circle r='50'/><path d='${d}'/>`;
}
const basketball = () => `<circle r='50' fill='url(%23ballFill)' stroke='none'/><circle r='50'/><path d='M0 -50V50M-50 0H50M-34 -36Q-12 0 -34 36M34 -36Q12 0 34 36'/>`;
const volleyball = () => `<circle r='50' fill='url(%23ballFill)' stroke='none'/><circle r='50'/><path d='M0 0Q4 -30 -10 -49M0 0Q-28 12 -46 4M0 0Q26 18 30 40M-10 -49Q30 -40 46 -18M-46 4Q-42 36 -16 47M30 40Q46 20 46 -18M-4 -24Q20 -26 38 -8M-24 8Q-20 30 2 42M14 14Q32 6 44 18'/>`;
const trophy = () => `<path d='M-28 -46H28V-22Q28 10 0 15Q-28 10 -28 -22Z'/><path d='M-28 -38Q-48 -38 -46 -20Q-43 -4 -24 -1M28 -38Q48 -38 46 -20Q43 -4 24 -1M-5 15V31M5 15V31M-16 31H16V39H-16ZM-24 39H24V51H-24ZM-12 45H12'/><path d='M0 -34L3.5 -25.5H12.5L5.3 -20.2L8 -11.5L0 -16.8L-8 -11.5L-5.3 -20.2L-12.5 -25.5H-3.5Z'/>`;
const whistle = () => `<path d='M-12 -12L38 -12L38 2L5.5 2A18 18 0 1 1 -12 -12Z'/><circle cx='-12' cy='6' r='6'/><circle cx='-30' cy='-14' r='5'/><path d='M44 -20L52 -29M48 -10L59 -12M36 -24L38 -35'/>`;
const stopwatch = () => `<circle r='40'/><circle r='33' stroke-opacity='.5'/><path d='M-7 -52H7V-45H-7ZM0 -45V-40M27 -33L33 -39M30 -42L38 -34M0 0L-8 20M0 -33V-28M33 0H28M0 33V28M-33 0H-28'/><circle r='2.5'/>`;
const jersey = () => `<path d='M-20 -50L-50 -38L-68 -5L-48 5L-40 -10V55H40V-10L48 5L68 -5L50 -38L20 -50Q0 -36 -20 -50Z'/><path d='M-20 -50Q0 -28 20 -50M-22 -2L-14 -9V28M-14 28H-6M-22 28H-14'/><ellipse cx='12' cy='9' rx='10' ry='19'/>`;
function racket() {
  const id = `rk${uid++}`;
  let strings = '';
  for (let x = -36; x <= 36; x += 8) strings += `M${x} -84V24`;
  for (let y = -80; y <= 20; y += 8) strings += `M-44 ${y}H44`;
  return `<clipPath id='${id}'><ellipse cx='0' cy='-30' rx='40' ry='50'/></clipPath><path d='${strings}' clip-path='url(%23${id})' stroke-opacity='.55' stroke-width='1.1'/><ellipse cx='0' cy='-30' rx='44' ry='54'/><ellipse cx='0' cy='-30' rx='40' ry='50' stroke-opacity='.5'/><path d='M-14 20L-6 42M14 20L6 42M-14 20Q0 30 14 20'/><path d='M-7 42H7V100H-7ZM-7 52L7 60M-7 64L7 72M-7 76L7 84M-7 88L7 96'/>`;
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
  [trophy, 402, 168, 1.28, -4, 72],
  [() => plus(), 222, 183, 1, 0, 10],
  [() => ring(7), 332, 240, 1, 0, 9],
  [whistle, 222, 282, 1.15, -28, 70],
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
  [whistle, 336, 1182, 1.15, -28, 70],
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
const variants = { '--design-bg-final': build(true), '--design-bg-final-phone': build(false) };
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
