// Generates the "Arena" background: one composed scene per screen shape (the layer is fixed
// to the viewport, so it is designed as a picture, not as a repeating wallpaper).
//   - a football pitch in perspective, lit by floodlights and fading into the dark (the product:
//     courts you can book), with mowing stripes;
//   - silk-like bundles of thin light lines sweeping across the scene;
//   - a few real 3D balls (projected spheres), back-lit with a rim light, some out of focus;
//   - soft floodlight glows and a fine grain that removes gradient banding.
// Writes --design-bg-arena (wide screens), --design-bg-arena-phone (portrait) and
// --design-bg-grain into Idee Site/css/design-background.css. Never edit those lines by hand.
// Run: node scripts/design/fundal-arena.mjs [--svg <prefix>] [--dry] [--ref]
//   --svg also saves the SVGs, --dry does not touch the CSS, --ref draws the older layout.
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
// [kind, cx, cy, r, yaw, pitch, roll, contactShadow]
function ball([kind, cx, cy, r, yaw, pitch, roll, shadow = false]) {
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
  return `${contact}<g transform='translate(${f(cx)} ${f(cy)}) scale(${f(s * 1000) / 1000})'>${body}</g>`;
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
  // a point h metres above the grass, plus the screen size of 1 metre at that spot
  const projectH = ([x, z], h) => {
    const dx = x - cam.x; const dz = z - cam.z;
    const X = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const Z = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    return Z < 1.5 ? null : [cam.cx + cam.focal * X / Z, cam.horizon + cam.focal * (cam.height - h) / Z, cam.focal / Z];
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
  // goals (posts, crossbar, net) and corner flags standing up from the grass
  let frames = ''; let nets = ''; let flags = '';
  const up = (pts) => { const q = pts.map(([x, z, h]) => projectH([x, z], h)); return q.some((v) => !v || v[1] > H + 200) ? '' : polyline(q); };
  for (const e of [1, -1]) {
    const gz = e * L; const bz = e * (L + 2);
    frames += up([[-3.66, gz, 0], [-3.66, gz, 2.44], [3.66, gz, 2.44], [3.66, gz, 0]]);
    nets += up([[-3.66, gz, 2.44], [-3.66, bz, 1.6], [-3.66, bz, 0]]) + up([[3.66, gz, 2.44], [3.66, bz, 1.6], [3.66, bz, 0]]) + up([[-3.66, bz, 1.6], [3.66, bz, 1.6]]);
    for (let i = 1; i < 12; i++) { const x = -3.66 + i * 7.32 / 12; nets += up([[x, gz, 2.44], [x, bz, 1.6], [x, bz, 0]]); }
    for (let j = 1; j < 5; j++) { const h = j * 0.4; nets += up([[-3.66, bz, h], [3.66, bz, h]]); }
    for (const sx of [1, -1]) {
      const b0 = projectH([sx * Wd, gz], 0); const t0 = projectH([sx * Wd, gz], 1.5);
      if (!b0 || !t0 || b0[1] > H + 50) continue;
      const m = t0[2];
      flags += `<path d='M${P(b0[0], b0[1])}L${P(t0[0], t0[1])}' stroke='#4fe0b6' stroke-opacity='.55' stroke-width='${f(Math.max(0.8, m * 0.05))}'/>`
        + `<path d='M${P(t0[0], t0[1])}l${f(m * 0.55 * -sx)} ${f(m * 0.18)}l${f(m * 0.55 * sx)} ${f(m * 0.2)}Z' fill='#4fe0b6' fill-opacity='.45'/>`;
    }
  }
  const furniture = `<path d='${nets}' fill='none' stroke='${GLOW}' stroke-opacity='.22' stroke-width='.6'/>`
    + `<path d='${frames}' fill='none' stroke='#5fe8bf' stroke-opacity='.6' stroke-width='1.4' stroke-linejoin='round'/>${flags}`;
  // screen point on the grass -> ground point (used to place props by eye)
  const unproject = ([sx, sy]) => {
    const Z = cam.focal * cam.height / (sy - cam.horizon); const X = (sx - cam.cx) * Z / cam.focal;
    return [cam.x + X * Math.cos(yaw) + Z * Math.sin(yaw), cam.z - X * Math.sin(yaw) + Z * Math.cos(yaw)];
  };
  return { defs: fade, svg: svg + furniture, project, projectH, unproject };
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

// ---------------------------------------------------------------- props (same back-lit 3D style)
const rim = (w) => `stroke='url(#ballRim)' stroke-width='${w}'`;
const objects = {
  // stopwatch: crown, two pushers, metal case with rim light, dark dial, ticks, glowing hand
  stopwatch(a = 42) {
    let ticks = '';
    for (let i = 0; i < 60; i++) {
      const big = i % 5 === 0; const ang = i * 6 * Math.PI / 180;
      const r1 = big ? 30 : 34.5; const r2 = 38;
      ticks += `M${P(r1 * Math.sin(ang), -r1 * Math.cos(ang))}L${P(r2 * Math.sin(ang), -r2 * Math.cos(ang))}`;
    }
    const hx = 33 * Math.sin(a * Math.PI / 180); const hy = -33 * Math.cos(a * Math.PI / 180);
    const hand = `M${P(-hx * 0.22, -hy * 0.22)}L${P(hx, hy)}`;
    const pusher = (deg) => `<g transform='rotate(${deg})'><rect x='-6' y='-61' width='12' height='11' rx='2' fill='url(#objBody)' ${rim(1.2)}/></g>`;
    return `<rect x='-6' y='-62' width='12' height='14' rx='2' fill='url(#objBody)' ${rim(1.2)}/><rect x='-14' y='-73' width='28' height='12' rx='5' fill='url(#objBody)' ${rim(1.4)}/>${pusher(-42)}${pusher(42)}`
      + `<circle r='50' fill='url(#ballBody)'/><circle r='50' fill='url(#ballShade)'/><circle r='49' fill='none' ${rim(2)}/>`
      + `<circle r='41.5' fill='#010d0c' stroke='${SEAM}' stroke-opacity='.45' stroke-width='1.2'/>`
      + `<path d='${ticks}' stroke='${SEAM}' stroke-opacity='.6' stroke-width='1.1' stroke-linecap='round'/>`
      + `<circle cy='15' r='8.5' fill='none' stroke='${SEAM}' stroke-opacity='.4' stroke-width='1'/><path d='M0 15L4 10' stroke='${SEAM}' stroke-opacity='.6' stroke-width='1.2' stroke-linecap='round'/>`
      + `<path d='${hand}' stroke='#7dffd6' stroke-opacity='.18' stroke-width='6' stroke-linecap='round'/><path d='${hand}' stroke='#8dffdc' stroke-width='2' stroke-linecap='round'/><circle r='3.4' fill='#8dffdc'/>`
      + `<path d='M-31 -16A35 35 0 0 1 4 -37' fill='none' stroke='#c8fff0' stroke-opacity='.3' stroke-width='3' stroke-linecap='round'/><circle r='50' fill='url(#ballSheen)'/>`;
  },
  // whistle in side view: mouthpiece, round chamber, sound hole, lanyard ring + cord, sound waves
  whistle(cord = 'M30 -30C70 -95 150 -30 210 -120') {
    const body = 'M-52 -16L4 -22A27 27 0 1 1 -4 20Q-8 8 -14 4L-52 2Q-57 -7 -52 -16Z';
    const waves = [-112, -82, -52].map((d) => { const r = d * Math.PI / 180; return `M${P(8 + 12 * Math.cos(r), -30 + 12 * Math.sin(r))}L${P(8 + 22 * Math.cos(r), -30 + 22 * Math.sin(r))}`; }).join('');
    return `<path d='${cord}' fill='none' stroke='url(#cordFade)' stroke-width='2.2' stroke-linecap='round'/><path d='${cord}' fill='none' stroke='url(#cordFade)' stroke-width='.8' stroke-linecap='round' transform='translate(3 2)'/>`
      + `<circle cx='28' cy='-25' r='6.5' fill='none' ${rim(2)}/>`
      + `<path d='${body}' fill='url(#objBody)'/><path d='${body}' fill='url(#objShade)'/><path d='${body}' fill='none' ${rim(1.8)} stroke-linejoin='round'/>`
      + `<path d='M-49 -9L2 -14' stroke='${SEAM}' stroke-opacity='.35' stroke-width='1.1'/><path d='M-47 -14L0 -19.5' stroke='#c8fff0' stroke-opacity='.4' stroke-width='1.4' stroke-linecap='round'/>`
      + `<path d='M-2 -21.5L13 -23.5' stroke='#000' stroke-opacity='.7' stroke-width='3.5' stroke-linecap='round'/>`
      + `<circle cx='18' cy='4' r='15' fill='none' stroke='${SEAM}' stroke-opacity='.25' stroke-width='1'/>`
      + `<path d='${waves}' stroke='#8dffdc' stroke-opacity='.75' stroke-width='2' stroke-linecap='round'/>`;
  },
  // trophy cup: bowl, handles, stem, base plinth, glowing star
  trophy() {
    const bowl = 'M-28 -44H28C28 -20 18 -2 4 3C3 12 4 19 12 26H-12C-4 19 -3 12 -4 3C-18 -2 -28 -20 -28 -44Z';
    const handles = 'M-27 -37C-44 -40 -50 -26 -42 -16C-37 -10 -29 -8 -21 -10M27 -37C44 -40 50 -26 42 -16C37 -10 29 -8 21 -10';
    const base = 'M-15 26H15L20 42H-20Z';
    const st = []; for (let i = 0; i < 10; i++) { const r = i % 2 ? 4 : 9.5; const t = (-90 + i * 36) * Math.PI / 180; st.push([r * Math.cos(t), -24 + r * Math.sin(t)]); }
    return `<path d='${handles}' fill='none' stroke='#0b3a33' stroke-width='6' stroke-linecap='round'/><path d='${handles}' fill='none' ${rim(1.4)} stroke-linecap='round'/>`
      + `<path d='${bowl}' fill='url(#objBody)'/><path d='${bowl}' fill='url(#objShade)'/><path d='${bowl}' fill='none' ${rim(1.8)}/>`
      + `<ellipse cy='-44' rx='28' ry='5' fill='#021412' ${rim(1.6)}/>`
      + `<path d='${base}' fill='url(#objBody)' ${rim(1.4)}/><rect x='-26' y='42' width='52' height='10' rx='1.5' fill='url(#objBody)' ${rim(1.4)}/><path d='M-9 47H9' stroke='${SEAM}' stroke-opacity='.5' stroke-width='1.4'/>`
      + `<path d='${poly(st)}' fill='#8dffdc' fill-opacity='.18'/><path d='${poly(st)}' fill='none' stroke='#8dffdc' stroke-opacity='.85' stroke-width='1.3' stroke-linejoin='round'/>`
      + `<path d='M-20 -38C-20 -24 -14 -12 -6 -6' fill='none' stroke='#c8fff0' stroke-opacity='.3' stroke-width='2.5' stroke-linecap='round'/>`;
  },
  // training cone (stands on the grass at 0,0; local height 100)
  cone() {
    const body = 'M-7 -100Q0 -104 7 -100L38 -10Q0 4 -38 -10Z';
    return `<path d='M-50 -8Q0 10 50 -8L46 -2Q0 16 -46 -2Z' fill='url(#objBody)' ${rim(1.2)}/><path d='${body}' fill='url(#objBody)'/><path d='${body}' fill='url(#objShade)'/>`
      + `<path d='M-21 -55Q0 -50 21 -55L27 -38Q0 -31 -27 -38Z' fill='#8dffdc' fill-opacity='.28'/><path d='${body}' fill='none' ${rim(1.6)} stroke-linejoin='round'/>`;
  },
};
// [kind, cx, cy, size (local 100 units -> size px), rotation, arg, contact shadow]
function prop([kind, cx, cy, size, rot = 0, arg, shadow = false]) {
  const s = size / 100;
  const contact = shadow ? `<ellipse cx='${f(cx)}' cy='${f(cy + size * 0.5)}' rx='${f(size * 0.42)}' ry='${f(size * 0.07)}' fill='url(#contact)'/>` : '';
  return `${contact}<g transform='translate(${f(cx)} ${f(cy)}) rotate(${rot}) scale(${f(s * 1000) / 1000})'>${objects[kind](arg)}</g>`;
}

// ---------------------------------------------------------------- more props (same style)
// seven-segment LED digits (lit segments glow, unlit ones stay as faint ghosts, like a real board)
const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
function sevenSeg(chars, x0, y0, w = 20, h = 38, t = 4.2, gap = 8) {
  let lit = ''; let ghost = '';
  const hseg = (x1, x2, y) => poly([[x1, y], [x1 + t / 2, y - t / 2], [x2 - t / 2, y - t / 2], [x2, y], [x2 - t / 2, y + t / 2], [x1 + t / 2, y + t / 2]]);
  const vseg = (x, y1, y2) => poly([[x, y1], [x + t / 2, y1 + t / 2], [x + t / 2, y2 - t / 2], [x, y2], [x - t / 2, y2 - t / 2], [x - t / 2, y1 + t / 2]]);
  [...chars].forEach((ch, i) => {
    const x = x0 + i * (w + gap); const m = h / 2;
    const segs = {
      a: hseg(x + 1, x + w - 1, y0), g: hseg(x + 1, x + w - 1, y0 + m), d: hseg(x + 1, x + w - 1, y0 + h),
      f: vseg(x, y0 + 1, y0 + m - 1), b: vseg(x + w, y0 + 1, y0 + m - 1), e: vseg(x, y0 + m + 1, y0 + h - 1), c: vseg(x + w, y0 + m + 1, y0 + h - 1),
    };
    for (const [k, d] of Object.entries(segs)) { if ((SEG[ch] || '').includes(k)) lit += d; else ghost += d; }
  });
  return `<path d='${ghost}' fill='${SEAM}' fill-opacity='.08'/><path d='${lit}' fill='#7dffd6' fill-opacity='.22' stroke='#7dffd6' stroke-opacity='.25' stroke-width='5' stroke-linejoin='round'/><path d='${lit}' fill='#a8ffe6'/>`;
}
let clipN = 0;
Object.assign(objects, {
  // stadium floodlight mast standing on the horizon: lattice mast, lamp head, glow and a light cone
  floodlight(lean = -40) {
    let brace = '';
    for (let i = 0; i < 9; i++) {
      const y1 = -i * 9; const y2 = -(i + 1) * 9;
      const w1 = 4 - i * 0.28; const w2 = 4 - (i + 1) * 0.28;
      brace += `M${P(-w1, y1)}L${P(w2, y2)}M${P(w1, y1)}L${P(-w2, y2)}`;
    }
    let lamps = '';
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) lamps += `<circle cx='${-10.5 + c * 7}' cy='${-96 + r * 6.5}' r='2.3'/>`;
    return `<path d='M-11 -86L11 -86L${f(lean + 70)} 40L${f(lean - 70)} 40Z' fill='url(#lampBeam)'/>`
      + `<circle cy='-93' r='34' fill='url(#lampGlow)'/>`
      + `<path d='M-4 0L-1.5 -82M4 0L1.5 -82${brace}' fill='none' stroke='#2fb894' stroke-opacity='.55' stroke-width='1.1'/>`
      + `<rect x='-16' y='-102' width='32' height='16' rx='2' fill='#021412' ${rim(1.2)}/>`
      + `<g fill='#bff5e4' fill-opacity='.8'>${lamps}</g>`;
  },
  // location pin hovering over the grass with pulse rings (the "spot" of Spotivity)
  pin() {
    const drop = 'M0 0C-6 -18 -34 -40 -34 -64A34 34 0 1 1 34 -64C34 -40 6 -18 0 0Z';
    return `<ellipse rx='95' ry='22' fill='url(#pinPool)'/>`
      + `<ellipse rx='28' ry='6.5' fill='none' stroke='#5fe8bf' stroke-opacity='.75' stroke-width='1.6'/><ellipse rx='54' ry='12.5' fill='none' stroke='#5fe8bf' stroke-opacity='.4' stroke-width='1.3'/><ellipse rx='82' ry='19' fill='none' stroke='#5fe8bf' stroke-opacity='.18' stroke-width='1.1'/>`
      + `<ellipse rx='12' ry='3' fill='#000' fill-opacity='.5'/>`
      + `<g transform='translate(0 -16)'><path d='${drop}' fill='url(#objBody)'/><path d='${drop}' fill='url(#objShade)'/><path d='${drop}' fill='none' ${rim(2)} stroke-linejoin='round'/>`
      + `<circle cy='-64' r='14' fill='#010d0c' stroke='${SEAM}' stroke-opacity='.55' stroke-width='1.2'/><circle cy='-64' r='8' fill='#8dffdc' fill-opacity='.25'/><circle cy='-64' r='5' fill='#b5ffe8'/>`
      + `<path d='M-24 -78A28 28 0 0 1 2 -94' fill='none' stroke='#c8fff0' stroke-opacity='.35' stroke-width='3' stroke-linecap='round'/></g>`;
  },
  // hanging scoreboard with LED digits
  scoreboard(score = '21') {
    return `<path d='M-56 -36L-62 -120M56 -36L62 -120' stroke='#2fb894' stroke-opacity='.4' stroke-width='1.2'/>`
      + `<rect x='-82' y='-38' width='164' height='76' rx='9' fill='url(#objBody)' ${rim(1.8)}/>`
      + `<rect x='-74' y='-30' width='148' height='60' rx='5' fill='#010b0a' stroke='${SEAM}' stroke-opacity='.3' stroke-width='1'/>`
      + `<g transform='skewX(-8)'>${sevenSeg(score[0], -58, -19)}${sevenSeg(score[1], 36, -19)}</g>`
      + `<circle cx='-1' cy='-7' r='3' fill='#a8ffe6'/><circle cx='-3' cy='8' r='3' fill='#a8ffe6'/>`
      + `<path d='M-64 -24H-40M38 -24H62' stroke='${SEAM}' stroke-opacity='.45' stroke-width='2' stroke-linecap='round'/>`
      + `<path d='M-74 -26Q0 -36 74 -26' fill='none' stroke='#c8fff0' stroke-opacity='.18' stroke-width='2'/>`;
  },
  // tennis racket: frame, strings (clipped to the head), throat, wrapped grip
  racket() {
    const id = `rc${clipN++}`;
    let strings = '';
    for (let x = -28; x <= 28; x += 7) strings += `M${x} -95V-5`;
    for (let y = -88; y <= -12; y += 7) strings += `M-35 ${y}H35`;
    let grip = '';
    for (let y = 30; y < 98; y += 8) grip += `M-6 ${y}L6 ${y + 5}`;
    return `<clipPath id='${id}'><ellipse cy='-50' rx='31' ry='41'/></clipPath>`
      + `<path d='M-14 -9Q-6 4 -6 22H6Q6 4 14 -9' fill='url(#objBody)' ${rim(1.2)}/>`
      + `<ellipse cy='-50' rx='38' ry='48' fill='url(#objBody)'/><ellipse cy='-50' rx='31' ry='41' fill='#010d0c' fill-opacity='.85'/>`
      + `<path d='${strings}' clip-path='url(#${id})' stroke='${SEAM}' stroke-opacity='.45' stroke-width='.9'/>`
      + `<ellipse cy='-50' rx='38' ry='48' fill='none' ${rim(1.8)}/><ellipse cy='-50' rx='31' ry='41' fill='none' stroke='${SEAM}' stroke-opacity='.4' stroke-width='1'/>`
      + `<rect x='-7' y='22' width='14' height='78' rx='3.5' fill='url(#objBody)' ${rim(1.4)}/><path d='${grip}' stroke='${SEAM}' stroke-opacity='.35' stroke-width='1.1'/>`
      + `<path d='M-30 -78A40 48 0 0 1 -4 -97' fill='none' stroke='#c8fff0' stroke-opacity='.35' stroke-width='2.5' stroke-linecap='round'/>`;
  },
  // winner's medal on a ribbon
  medal() {
    const star = []; for (let i = 0; i < 10; i++) { const r = i % 2 ? 5 : 12; const t = (-90 + i * 36) * Math.PI / 180; star.push([r * Math.cos(t), 2 + r * Math.sin(t)]); }
    return `<path d='M-30 -78L-12 -78L4 -20L-10 -20Z' fill='url(#objBody)' ${rim(1.1)}/><path d='M30 -78L12 -78L-4 -20L10 -20Z' fill='url(#objBody)' ${rim(1.1)}/>`
      + `<path d='M-22 -78L-4 -22M22 -78L4 -22' stroke='#8dffdc' stroke-opacity='.35' stroke-width='3'/>`
      + `<circle cy='2' r='28' fill='url(#ballBody)'/><circle cy='2' r='28' fill='url(#ballShade)'/><circle cy='2' r='27.5' fill='none' ${rim(2)}/><circle cy='2' r='21' fill='none' stroke='${SEAM}' stroke-opacity='.5' stroke-width='1.1'/>`
      + `<path d='${poly(star)}' fill='#8dffdc' fill-opacity='.2' stroke='#a8ffe6' stroke-width='1.3' stroke-linejoin='round'/>`;
  },
  // football shirt with a lit number 10
  jersey() {
    const shirt = 'M-18 -48Q0 -40 18 -48L44 -38L64 -10L48 0L40 -10V52Q40 56 36 56H-36Q-40 56 -40 52V-10L-48 0L-64 -10L-44 -38Z';
    return `<path d='${shirt}' fill='url(#objBody)'/><path d='${shirt}' fill='url(#objShade)'/><path d='${shirt}' fill='none' ${rim(1.8)} stroke-linejoin='round'/>`
      + `<path d='M-18 -48Q0 -30 18 -48' fill='#010d0c' stroke='${SEAM}' stroke-opacity='.5' stroke-width='1.2'/>`
      + `<path d='M-56 -21L-41 -12M56 -21L41 -12' stroke='${SEAM}' stroke-opacity='.45' stroke-width='1.2'/>`
      + `<path d='M-30 10Q-22 30 -26 50M24 -8Q30 20 28 50' fill='none' stroke='#000' stroke-opacity='.25' stroke-width='3'/>`
      + `<g transform='translate(-2 0) scale(.75)'>${sevenSeg('10', -26, -12, 18, 40, 5, 12)}</g>`;
  },
  // floating basketball hoop: backboard, target square, glowing rim, net
  hoop() {
    let net = '';
    const top = (a) => [18 * Math.cos(a), -20 + 4.5 * Math.sin(a)];
    const bot = (a) => [11 * Math.cos(a), 14 + 3 * Math.sin(a)];
    for (let i = 0; i < 10; i++) {
      const a = Math.PI * (i / 9);
      const b = Math.PI * ((i + 1) / 9);
      net += `M${P(...top(a))}L${P(...bot(b))}M${P(...top(b))}L${P(...bot(a))}`;
    }
    return `<rect x='-42' y='-74' width='84' height='54' rx='4' fill='#010d0c' fill-opacity='.85' ${rim(1.8)}/>`
      + `<rect x='-15' y='-50' width='30' height='22' fill='none' stroke='${SEAM}' stroke-opacity='.55' stroke-width='1.3'/>`
      + `<path d='M-4 -20V-26H4V-20' fill='none' stroke='${SEAM}' stroke-opacity='.5' stroke-width='1.4'/>`
      + `<path d='${net}' stroke='${SEAM}' stroke-opacity='.5' stroke-width='.9'/><ellipse cy='14' rx='11' ry='3' fill='none' stroke='${SEAM}' stroke-opacity='.45' stroke-width='.9'/>`
      + `<ellipse cy='-20' rx='18' ry='4.5' fill='none' stroke='#7dffd6' stroke-opacity='.25' stroke-width='5'/><ellipse cy='-20' rx='18' ry='4.5' fill='none' stroke='#a8ffe6' stroke-width='2'/>`
      + `<path d='M-38 -70H30' stroke='#c8fff0' stroke-opacity='.25' stroke-width='2' stroke-linecap='round'/>`;
  },
  // booking calendar card with one day ticked
  calendar() {
    let cells = '';
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) if (!(r === 1 && c === 2)) cells += `M${-34 + c * 18} ${-8 + r * 16}h12v10h-12Z`;
    return `<rect x='-46' y='-42' width='92' height='92' rx='10' fill='url(#objBody)' ${rim(1.8)}/>`
      + `<path d='M-46 -20H46' stroke='${SEAM}' stroke-opacity='.4' stroke-width='1.2'/><rect x='-46' y='-42' width='92' height='22' rx='10' fill='#8dffdc' fill-opacity='.12'/>`
      + `<rect x='-26' y='-52' width='7' height='18' rx='3.5' fill='#021412' ${rim(1.2)}/><rect x='19' y='-52' width='7' height='18' rx='3.5' fill='#021412' ${rim(1.2)}/>`
      + `<path d='${cells}' fill='none' stroke='${SEAM}' stroke-opacity='.35' stroke-width='1'/>`
      + `<rect x='1' y='7' width='14' height='12' rx='2' fill='#8dffdc' fill-opacity='.3' stroke='#a8ffe6' stroke-width='1.2'/><path d='M4 13L7.5 16.5L12.5 9.5' fill='none' stroke='#d8fff3' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/>`
      + `<circle cx='8' cy='13' r='16' fill='url(#pinPool)'/>`;
  },
});

// ---------------------------------------------------------------- scenes
const commonDefs = `
<radialGradient id='ballBody' cx='.36' cy='.3' r='.78'><stop offset='0' stop-color='#1a6a57'/><stop offset='.45' stop-color='#0b3a33'/><stop offset='1' stop-color='#031b18'/></radialGradient>
<radialGradient id='ballShade' cx='.34' cy='.28' r='.85'><stop offset='.45' stop-color='#000' stop-opacity='0'/><stop offset='1' stop-color='#000' stop-opacity='.6'/></radialGradient>
<linearGradient id='ballRim' x1='.2' y1='0' x2='.55' y2='1'><stop offset='0' stop-color='#8dffdc' stop-opacity='1'/><stop offset='.35' stop-color='${GLOW}' stop-opacity='.55'/><stop offset='.7' stop-color='${GLOW}' stop-opacity='0'/></linearGradient>
<radialGradient id='ballSheen' cx='.3' cy='.22' r='.32'><stop offset='0' stop-color='#b5ffe8' stop-opacity='.26'/><stop offset='1' stop-color='#9ff5dc' stop-opacity='0'/></radialGradient>
<radialGradient id='contact'><stop offset='0' stop-color='#000' stop-opacity='.75'/><stop offset='1' stop-color='#000' stop-opacity='0'/></radialGradient>
<linearGradient id='objBody' x1='.15' y1='0' x2='.85' y2='1'><stop offset='0' stop-color='#1a6a57'/><stop offset='.45' stop-color='#0b3a33'/><stop offset='1' stop-color='#031b18'/></linearGradient>
<linearGradient id='objShade' x1='0' y1='0' x2='0' y2='1'><stop offset='.35' stop-color='#000' stop-opacity='0'/><stop offset='1' stop-color='#000' stop-opacity='.5'/></linearGradient>
<linearGradient id='lampBeam' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#8dffdc' stop-opacity='.11'/><stop offset='1' stop-color='#8dffdc' stop-opacity='0'/></linearGradient><radialGradient id='lampGlow'><stop offset='0' stop-color='#c8fff0' stop-opacity='.32'/><stop offset='.3' stop-color='#5fe8bf' stop-opacity='.1'/><stop offset='1' stop-color='#5fe8bf' stop-opacity='0'/></radialGradient><radialGradient id='pinPool'><stop offset='0' stop-color='#4fe0b6' stop-opacity='.3'/><stop offset='1' stop-color='#4fe0b6' stop-opacity='0'/></radialGradient><linearGradient id='cordFade' x1='0' y1='1' x2='1' y2='0'><stop offset='0' stop-color='${SEAM}' stop-opacity='.7'/><stop offset='1' stop-color='${SEAM}' stop-opacity='0'/></linearGradient>`.replace(/\n/g, '');

const glow = (id, cx, cy, rx, ry, color, op) => ({
  defs: `<radialGradient id='${id}' cx='${cx}' cy='${cy}' r='1' gradientUnits='userSpaceOnUse' gradientTransform='translate(${cx} ${cy}) scale(${rx} ${ry}) translate(${-cx} ${-cy})'><stop offset='0' stop-color='${color}' stop-opacity='${op}'/><stop offset='.45' stop-color='${color}' stop-opacity='${f(op * 0.35 * 1000) / 1000}'/><stop offset='1' stop-color='${color}' stop-opacity='0'/></radialGradient>`,
  svg: (W, H) => `<rect width='${W}' height='${H}' fill='url(#${id})'/>`,
});

function scene({ W, H, glows, beams = [], cam, ribbons, balls, props = [], cones = [], arcs = [], sparkles = 0, calm }) {
  let defs = commonDefs; let body = `<rect width='${W}' height='${H}' fill='${BASE}'/>`;
  glows.forEach((g, i) => { const gl = glow(`gl${i}`, ...g); defs += gl.defs; body += gl.svg(W, H); });
  // floodlight beams: soft cones from lights above the screen
  beams.forEach(([ax, ay, deg, spread, len, op], i) => {
    const pt2 = (d, l) => [ax + l * Math.cos(d * Math.PI / 180), ay + l * Math.sin(d * Math.PI / 180)];
    const [ex, ey] = pt2(deg, len);
    defs += `<linearGradient id='bm${i}' gradientUnits='userSpaceOnUse' x1='${ax}' y1='${ay}' x2='${f(ex)}' y2='${f(ey)}'><stop offset='0' stop-color='#7dffd6' stop-opacity='${op}'/><stop offset='.5' stop-color='${GLOW}' stop-opacity='${f(op * 0.4 * 1000) / 1000}'/><stop offset='1' stop-color='${GLOW}' stop-opacity='0'/></linearGradient>`;
    for (const k of [1.6, 1, 0.5]) body += `<path d='${poly([[ax, ay], pt2(deg - spread * k / 2, len), pt2(deg + spread * k / 2, len)])}' fill='url(#bm${i})' fill-opacity='.45'/>`;
  });
  if (cam) {
  const pt = pitch(cam, H); defs += pt.defs;
  // floodlight pool on the grass
  defs += `<radialGradient id='pool' gradientUnits='userSpaceOnUse' cx='${cam.poolX}' cy='${H}' r='1' gradientTransform='translate(${cam.poolX} ${H}) scale(${W * 0.55} ${(H - cam.horizon) * 1.1}) translate(${-cam.poolX} ${-H})'><stop offset='0' stop-color='${GLOW}' stop-opacity='.09'/><stop offset='1' stop-color='${GLOW}' stop-opacity='0'/></radialGradient>`;
  body += `<rect y='${cam.horizon}' width='${W}' height='${H - cam.horizon}' fill='url(#pool)'/>` + pt.svg;
  // training cones standing on the pitch (perspective size, contact shadow)
  for (const c of cones) {
    const q = pt.projectH(pt.unproject(c), 0); if (!q) continue;
    const hgt = q[2] * 1.2;   // drawn a bit larger than life so they read
    body += `<ellipse cx='${f(q[0])}' cy='${f(q[1])}' rx='${f(hgt * 0.6)}' ry='${f(hgt * 0.13)}' fill='url(#contact)'/><g transform='translate(${f(q[0])} ${f(q[1])}) scale(${f(hgt / 100 * 1000) / 1000})'>${objects.cone()}</g>`;
  }
  }
  // a calm zone behind the main text: ribbons are dimmed there
  defs += `<radialGradient id='calmG' gradientUnits='userSpaceOnUse' cx='${calm[0]}' cy='${calm[1]}' r='1' gradientTransform='translate(${calm[0]} ${calm[1]}) scale(${calm[2]} ${calm[3]}) translate(${-calm[0]} ${-calm[1]})'><stop offset='0' stop-color='#000' stop-opacity='.62'/><stop offset='1' stop-color='#000' stop-opacity='0'/></radialGradient><mask id='calm' maskUnits='userSpaceOnUse' x='0' y='0' width='${W}' height='${H}'><rect width='${W}' height='${H}' fill='#fff'/><rect width='${W}' height='${H}' fill='url(#calmG)'/></mask>`;
  let rib = '';
  ribbons.forEach((r, i) => { const rb = ribbon(r, `rb${i}`); defs += rb.defs; rib += rb.svg; });
  // light particles (fixed seed, so every build draws the same sky); dimmed behind the text
  let rnd = 20261122;
  const rand = () => { rnd = (rnd * 1664525 + 1013904223) % 4294967296; return rnd / 4294967296; };
  let dust = '';
  for (let i = 0; i < sparkles; i++) {
    const x = rand() * W; const y = rand() * H; const k = rand();
    const r = 0.6 + k * k * 2; const op = 0.15 + rand() * 0.5;
    dust += `<circle cx='${f(x)}' cy='${f(y)}' r='${f(r)}' fill-opacity='${f(op * 100) / 100}'/>`;
    if (r > 2) dust += `<path d='M${P(x - r * 3, y)}H${f(x + r * 3)}M${P(x, y - r * 3)}V${f(y + r * 3)}' stroke='#c8fff0' stroke-opacity='${f(op * 50) / 100}' stroke-width='.6'/>`;
  }
  // dashed flight paths (a ball's trajectory)
  let paths = '';
  for (const [x1, y1, cx, cy, x2, y2] of arcs) paths += `M${P(x1, y1)}Q${P(cx, cy)} ${P(x2, y2)}`;
  body += `<g mask='url(#calm)'>${rib}<g fill='#8dffdc'>${dust}</g><path d='${paths}' fill='none' stroke='#7dffd6' stroke-opacity='.7' stroke-width='2.2' stroke-dasharray='1 8' stroke-linecap='round'/></g>`;
  body += props.map(prop).join('');
  body += balls.map(ball).join('');
  // vignette: edges sink into the base colour
  defs += `<radialGradient id='vig' cx='.5' cy='.45' r='.75'><stop offset='.6' stop-color='${BASE}' stop-opacity='0'/><stop offset='1' stop-color='${BASE}' stop-opacity='.55'/></radialGradient>`;
  body += `<rect width='${W}' height='${H}' fill='url(#vig)'/>`;
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}' preserveAspectRatio='xMidYMid slice'><defs>${defs}</defs>${body}</svg>`;
}

// ---------------------------------------------------------------- anchored layout
// The picture is drawn with no fixed size (CSS: background-size 100% 100%). Inside it:
//   - one "slice" layer for the atmosphere (glows, light particles) that always fills the screen;
//   - several groups of objects, each glued to a corner/edge of the screen with
//     preserveAspectRatio="<align> meet". "meet" scales a group down until it fits, so an object
//     is never cut by the screen edge, on any phone or monitor.
// Every group uses the same W x H coordinates, so positions read like one composition.
function layout({ W, H, glows, sparkles = 0, calm, groups }) {
  let defs = commonDefs;
  // atmosphere
  let atmo = '';
  glows.forEach((g, i) => { const gl = glow(`gl${i}`, ...g); defs += gl.defs; atmo += gl.svg(W, H); });
  let rnd = 20261122;
  const rand = () => { rnd = (rnd * 1664525 + 1013904223) % 4294967296; return rnd / 4294967296; };
  let dust = '';
  for (let i = 0; i < sparkles; i++) {
    const x = rand() * W; const y = rand() * H; const k = rand();
    const r = 0.6 + k * k * 2; const op = 0.15 + rand() * 0.5;
    dust += `<circle cx='${f(x)}' cy='${f(y)}' r='${f(r)}' fill-opacity='${f(op * 100) / 100}'/>`;
    if (r > 2) dust += `<path d='M${P(x - r * 3, y)}H${f(x + r * 3)}M${P(x, y - r * 3)}V${f(y + r * 3)}' stroke='#c8fff0' stroke-opacity='${f(op * 50) / 100}' stroke-width='.6'/>`;
  }
  // calm zone behind the main text (used by the ribbons and particles)
  defs += `<radialGradient id='calmG' gradientUnits='userSpaceOnUse' cx='${calm[0]}' cy='${calm[1]}' r='1' gradientTransform='translate(${calm[0]} ${calm[1]}) scale(${calm[2]} ${calm[3]}) translate(${-calm[0]} ${-calm[1]})'><stop offset='0' stop-color='#000' stop-opacity='.62'/><stop offset='1' stop-color='#000' stop-opacity='0'/></radialGradient><mask id='calm' maskUnits='userSpaceOnUse' x='-2000' y='-2000' width='${W + 4000}' height='${H + 4000}'><rect x='-2000' y='-2000' width='${W + 4000}' height='${H + 4000}' fill='#fff'/><rect x='-2000' y='-2000' width='${W + 4000}' height='${H + 4000}' fill='url(#calmG)'/></mask>`;
  const box = (align, mode, inner, extra = '') => `<svg width='100%' height='100%' viewBox='0 0 ${W} ${H}' preserveAspectRatio='${align} ${mode}' overflow='visible'${extra}>${inner}</svg>`;
  let body = `<rect width='100%' height='100%' fill='${BASE}'/>`;
  body += box('xMidYMid', 'slice', `${atmo}<g fill='#8dffdc' mask='url(#calm)'>${dust}</g>`);
  let rb = 0;
  for (const g of groups) {
    let inner = '';
    let rib = '';
    for (const r of g.ribbons || []) { const x = ribbon(r, `rb${rb++}`); defs += x.defs; rib += x.svg; }
    let paths = '';
    for (const [x1, y1, cx, cy, x2, y2] of g.arcs || []) paths += `M${P(x1, y1)}Q${P(cx, cy)} ${P(x2, y2)}`;
    if (rib || paths) inner += `<g mask='url(#calm)'>${rib}${paths ? `<path d='${paths}' fill='none' stroke='#7dffd6' stroke-opacity='.7' stroke-width='2.2' stroke-dasharray='1 8' stroke-linecap='round'/>` : ''}</g>`;
    inner += (g.decor || []).map((d) => decor(d, d[5])).join('') + (g.props || []).map(prop).join('') + (g.balls || []).map(ball).join('');
    body += box(g.align, 'meet', g.dim ? `<g opacity='${g.dim}'>${inner}</g>` : inner);
  }
  // side vignette only (nothing darkens the top or bottom edge, so no band appears there)
  defs += `<linearGradient id='vig' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='${BASE}' stop-opacity='.35'/><stop offset='.12' stop-color='${BASE}' stop-opacity='0'/><stop offset='.88' stop-color='${BASE}' stop-opacity='0'/><stop offset='1' stop-color='${BASE}' stop-opacity='.35'/></linearGradient>`;
  body += `<rect width='100%' height='100%' fill='url(#vig)'/>`;
  // soft fade into the page base along the bottom edge (no hard edge against the phone's
  // toolbar or overscroll area, which show the plain base colour)
  return `<svg xmlns='http://www.w3.org/2000/svg' width='100%' height='100%'><defs>${defs}</defs>${body}</svg>`;
}

// ---------------------------------------------------------------- the owner's reference layout
// Positions measured from the owner's photo Desktop\Spotivity\FundalFinal.jpeg (547 x 1600),
// drawn with the 3D icons above. [kind, x, y, scale (old 100-unit icon), rotation, variant]
const REF = [
  ['soccer', 62, 62, 1.5, 0], ['dots', 470, 40, 3, 3], ['trophy', 402, 166, 1.45, -4], ['plus', 222, 183],
  ['ring', 332, 240, 7], ['whistle', 218, 282, 1.15, -22], ['ring', 44, 358, 7], ['cross', 98, 346],
  ['basketball', 476, 366, 1.58, 0], ['stopwatch', 100, 452, 1.05, 0], ['cross', 226, 406],
  ['dots', 16, 516, 4, 4], ['dots', 310, 540, 4, 3], ['volleyball', 187, 636, 1.36, 0], ['jersey', 468, 684, 1.15, 6],
  ['ring', 35, 688, 8], ['ring', 325, 698, 11], ['cross', 368, 756], ['plus', 515, 815],
  ['racket', 402, 905, 1.25, 38], ['medal', 140, 978, 1.5, 6], ['ring', 45, 1026, 7], ['ring', 248, 1088, 12],
  ['cross', 182, 1134], ['dots', 455, 1050, 4, 3], ['volleyball', 40, 1196, 1.92, 0, 2], ['pin', 330, 1180, 1.15, 0],
  ['ring', 488, 1188, 18], ['soccer', 480, 1332, 1.72, 0, 2], ['ring', 208, 1380, 12], ['plus', 362, 1386],
  ['dots', 356, 1276, 2, 2], ['calendar', 78, 1468, 0.95, -10], ['cross', 226, 1470], ['dots', 330, 1462, 4, 6],
];
// light ribbons of the photo: [start, end, outer control, inner control, strength, peak]
const REF_RIBBONS = [
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
const BALL_POSE = { soccer: [[18, -14, 8], [-24, 10, -6]], basketball: [[-40, 15, -50]], volleyball: [[45, 35, 0], [45, -35, 15]], tennis: [[20, 30, 10]] };
const PROP_SIZE = { trophy: 92, whistle: 100, stopwatch: 84, jersey: 100, racket: 92, medal: 70, pin: 90, calendar: 92, hoop: 100, scoreboard: 100 };
const DECOR = new Set(['dots', 'ring', 'cross', 'plus']);
// small line marks of the photo, in the same emerald glow
function decor([kind, x, y, a = 0, b = 0], k = 1) {
  const st = `stroke='${SEAM}' stroke-opacity='.55' stroke-width='${f(1.6 * k)}' stroke-linecap='round' fill='none'`;
  if (kind === 'ring') return `<circle cx='${f(x)}' cy='${f(y)}' r='${f(a * k)}' ${st}/>`;
  if (kind === 'plus') { const s = 9 * k; return `<path d='M${P(x - s, y)}H${f(x + s)}M${P(x, y - s)}V${f(y + s)}' ${st}/>`; }
  if (kind === 'cross') { const s = 7 * k; return `<path d='M${P(x - s, y - s)}L${P(x + s, y + s)}M${P(x + s, y - s)}L${P(x - s, y + s)}' ${st}/>`; }
  let d = ''; const g = 14 * k;
  for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) d += `<circle cx='${f(x + i * g)}' cy='${f(y + j * g)}' r='${f(1.8 * k)}'/>`;
  return `<g fill='${SEAM}' fill-opacity='.6'>${d}</g>`;
}
// Maps the reference into one group. map(x, y) -> [x', y'], k = size factor, box = [W, H] for clamping.
function refGroup(items, ribbons, map, k, box, extra = {}) {
  const g = { props: [], balls: [], decor: [], ribbons: [], ...extra };
  const clamp = (x, y, r) => [Math.min(Math.max(x, r + 4), box[0] - r - 4), Math.min(Math.max(y, r + 4), box[1] - r - 4)];
  for (const [kind, x0, y0, s, rot, v] of items) {
    const [x, y] = map(x0, y0);
    if (DECOR.has(kind)) { g.decor.push([kind, x, y, s, rot, k]); continue; }
    if (BALL_POSE[kind]) {
      const r = 50 * s * k; const [cx, cy] = clamp(x, y, r);
      const pose = BALL_POSE[kind][(v || 1) - 1];
      g.balls.push([kind, cx, cy, r, ...pose]);
    } else {
      const size = PROP_SIZE[kind] * s * k; const [cx, cy] = clamp(x, y, size * 0.55);
      g.props.push([kind, cx, cy, size, rot]);
    }
  }
  const cub = (p0, c, p3) => [p0, [p0[0] + 2 / 3 * (c[0] - p0[0]), p0[1] + 2 / 3 * (c[1] - p0[1])], [p3[0] + 2 / 3 * (c[0] - p3[0]), p3[1] + 2 / 3 * (c[1] - p3[1])], p3];
  for (const [a, b, co, ci, strength, peak] of ribbons) {
    const [A, B, CO, CI] = [a, b, co, ci].map(([x, y]) => map(x, y));
    g.ribbons.push({ a: cub(A, CO, B), b: cub(A, CI, B), n: 30, strength, peak: Math.max(peak, 0.3), width: 70 * k, twist: 0.75 });
  }
  return g;
}

// Splits the reference into the pieces that are clear of the page's text/photo (full
// strength) and the ones that sit behind them (softened). inZone(x, y) works on mapped coords.
function zoned(items, ribbons, map, k, box, inZone, align, soft) {
  const pos = (i) => map(i[1], i[2]);
  const clear = items.filter((i) => !inZone(...pos(i)));
  const behind = items.filter((i) => inZone(...pos(i)));
  return [{ align, ...refGroup(clear, ribbons, map, k, box) }, { align, dim: soft, ...refGroup(behind, [], map, k, box) }];
}

// ---------------------------------------------------------------- reference layout, cleaned
// The owner's reference photo (REF / REF_RIBBONS) placed as it is: zigzag of big pieces,
// light ribbons sweeping between them, small marks in the gaps. Two rules on top of it:
//   1. a piece never sits behind the page's text or photo card (it is left out there);
//   2. pieces never touch each other (a later piece that would touch an earlier one is left out).
function itemRadius(kind, s, k) {
  if (kind === 'dots') return 14 * k * Math.max(s, 1);
  if (DECOR.has(kind)) return 12 * k;
  if (BALL_POSE[kind]) return 50 * s * k;
  return PROP_SIZE[kind] * s * k * 0.6;
}
function cleanRef(items, map, k, zones, taken = []) {
  const keep = [];
  for (const it of items) {
    const [kind, x0, y0, s] = it;
    const [x, y] = map(x0, y0);
    const r = itemRadius(kind, s || 1, k);
    if (zones.some(([a, b, c, d]) => x + r > a && x - r < c && y + r > b && y - r < d)) continue;
    if (taken.some(([tx, ty, tr]) => Math.hypot(tx - x, ty - y) < tr + r + 10)) continue;
    taken.push([x, y, r]); keep.push(it);
  }
  return keep;
}

// Wide screens (1600 x 1000): the reference column drawn three times side by side, each
// showing a different stretch of it (top / middle / bottom), so it reads like the photo,
// not like a repeated tile. Columns are glued left / centre / right.
const ZONES_WIDE = [[150, 260, 805, 830], [865, 315, 1435, 735], [1140, 800, 1420, 850], [0, 0, 1600, 150]];
const COLS = [[0, 0, 'xMinYMid'], [533, 290, 'xMidYMid'], [1067, 580, 'xMidYMid']];   // left column back at the left edge (owner)
const KW = 0.78;
// Extra pieces on the left edge (owner: "add a whistle, a stopwatch etc. on the left").
// They are placed first, so the reference pieces make room for them.
const LEFT_EXTRA = {
  props: [['whistle', 70, 236, 88, -14, 'M30 -30C44 -70 10 -100 30 -140'], ['medal', 66, 690, 64, -6], ['trophy', 70, 872, 76, -4]],
  balls: [['volleyball', 64, 395, 30, 45, 35, 0]],
};
const takenWide = [[70, 236, 54], [66, 690, 50], [70, 872, 52], [64, 395, 34]];
const wideGroups = [{ align: 'xMinYMid', ...LEFT_EXTRA }, ...COLS.map(([x0, refTop, align]) => {
  const map = (x, y) => [x0 + x * 0.975, 150 + (y - refTop) * 0.82];
  const inView = REF.filter((i) => { const y = map(i[1], i[2])[1]; return y > 120 && y < 1000; });
  const items = cleanRef(inView, map, KW, ZONES_WIDE, takenWide);
  const ribbons = REF_RIBBONS.filter((r) => { const ys = [r[0][1], r[1][1]].map((y) => map(0, y)[1]); return Math.max(...ys) > 150 && Math.min(...ys) < 1000; });
  return { align, ...refGroup(items, ribbons, map, KW, [1600, 1000]) };
})];
const wide = layout({
  W: 1600, H: 1000,
  glows: [[140, -80, 950, 720, '#11936f', 0.22], [1480, -60, 760, 620, '#0e8064', 0.15], [1180, 640, 620, 380, '#0a5e4b', 0.1], [760, 1060, 820, 300, '#0e8064', 0.12]],
  sparkles: 50,
  calm: [470, 540, 400, 320],
  groups: wideGroups,
});
// Portrait screens (547 x 1184): the whole reference column across the width, as in the
// photo (upper half glued to the top, lower half to the bottom). Pieces that would sit
// behind the text block are left out, so nothing overlaps.
const PY = (y) => 235 + y * 0.585;
const P2 = (x, y) => [x, PY(y)];
const ZONES_PHONE = [[40, 240, 420, 900], [0, 0, 547, 215], [0, 790, 547, 890], [0, 1085, 547, 1184]];   // text block, header, steps row, footer text
// Owner: whistle and stopwatch must be visible on the phone too: placed first, in the free
// spot right of the "discover" link and below the jersey.
const PHONE_EXTRA = { props: [['whistle', 246, 734, 62, -14, 'M30 -30C44 -70 10 -100 30 -140'], ['stopwatch', 344, 740, 58, 12, 40]] };
const takenPhone = [[246, 734, 42], [344, 740, 44]];
const phone = layout({
  W: 547, H: 1184,
  glows: [[500, -60, 520, 520, '#11936f', 0.24], [60, 980, 460, 320, '#0e8064', 0.12], [280, 640, 380, 280, '#0a5e4b', 0.1]],
  sparkles: 34,
  calm: [250, 560, 300, 330],
  groups: [
    { align: 'xMidYMin', ...PHONE_EXTRA },
    { align: 'xMidYMin', ...refGroup(cleanRef(REF.filter((i) => i[2] < 800), P2, 0.66, ZONES_PHONE, takenPhone), REF_RIBBONS.filter((r) => r[0][1] < 800), P2, 0.66, [547, 1184]) },
    { align: 'xMidYMax', ...refGroup(cleanRef(REF.filter((i) => i[2] >= 800), P2, 0.66, ZONES_PHONE.slice(2), takenPhone), REF_RIBBONS.filter((r) => r[0][1] >= 800), P2, 0.66, [547, 1184]) },
  ],
});

// ---------------------------------------------------------------- Fibonacci composition (owner, 24.11.2026)
// "Aranjează-le în sensul lui Fibonacci": the classic Fibonacci spiral, a quarter circle in each
// square of the tiling 1, 1, 2, 3, 5, 8, 13, 21, ... The spiral is the flight path of the balls:
// each ball flies outward along it and leaves a light trail; the stopwatch and the whistle sit
// on it too. Every icon's size follows its square (the Fibonacci numbers), small near the eye,
// large outside. Only stopwatch, whistle, balls and their flight trails (owner's list).
// Squares are added Right, Up, Left, Down around the first unit square; flipX/flipY mirror
// the drawing, (ox, oy) is where the eye (the first square) lands, unit = size of square 1.
// fit: { cx, cy, w } puts the whole golden rectangle of the tiling, w wide, centred on (cx, cy).
function fibTiling({ n, unit, flipX = false, flipY = false, ox, oy, fit }) {
  const F = [1, 1]; while (F.length < n) F.push(F.at(-1) + F.at(-2));
  const r = { x0: 0, y0: 0, x1: 1, y1: 1 };
  const raw = [{ x: 0, y: 0, s: 1, arc: [[1, 1], [0, 0], [0, 1]] }];
  for (let i = 1; i < n; i++) {
    const s = F[i]; const d = 'RULD'[(i - 1) % 4]; let q; let a;
    if (d === 'R') { q = [r.x1, r.y1 - s]; a = [[r.x1, r.y1], [r.x1 + s, r.y1 - s], [r.x1, r.y1 - s]]; r.x1 += s; }
    if (d === 'U') { q = [r.x0, r.y0 - s]; a = [[r.x0 + s, r.y0], [r.x0, r.y0 - s], [r.x0, r.y0]]; r.y0 -= s; }
    if (d === 'L') { q = [r.x0 - s, r.y0]; a = [[r.x0, r.y0], [r.x0 - s, r.y0 + s], [r.x0, r.y0 + s]]; r.x0 -= s; }
    if (d === 'D') { q = [r.x0, r.y1]; a = [[r.x0, r.y1], [r.x0 + s, r.y1 + s], [r.x0 + s, r.y1]]; r.y1 += s; }
    raw.push({ x: q[0], y: q[1], s, arc: a });
  }
  if (fit) {
    const x0 = flipX ? -r.x1 : r.x0; const x1 = flipX ? -r.x0 : r.x1; const y0 = flipY ? -r.y1 : r.y0; const y1 = flipY ? -r.y0 : r.y1;
    unit = fit.w / (x1 - x0);
    ox = fit.cx - (x0 + x1) / 2 * unit; oy = fit.cy - (y0 + y1) / 2 * unit;
  }
  const T = ([x, y]) => [ox + (flipX ? -x : x) * unit, oy + (flipY ? -y : y) * unit];
  return raw.map((q, i) => {
    const a = T([q.x, q.y]); const b = T([q.x + q.s, q.y + q.s]);
    const [p0, p1, c] = q.arc.map(T);
    const a0 = Math.atan2(p0[1] - c[1], p0[0] - c[0]);
    let da = Math.atan2(p1[1] - c[1], p1[0] - c[0]) - a0;
    while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    return { i, F: F[i], x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), s: q.s * unit, c, rad: q.s * unit, a0, da, p0, p1 };
  });
}
// A point on the spiral: u = square index + fraction along its quarter arc (0..1).
function fibPoint(sq, u) {
  const i = Math.max(0, Math.min(sq.length - 1, Math.floor(u))); const t = Math.min(1, u - i); const q = sq[i];
  const ang = q.a0 + q.da * t;
  const x = q.c[0] + q.rad * Math.cos(ang); const y = q.c[1] + q.rad * Math.sin(ang);
  const dir = Math.sign(q.da);   // tangent of the flight (towards bigger squares)
  return { x, y, s: q.s, tx: -Math.sin(ang) * dir, ty: Math.cos(ang) * dir };
}
// The light trail a ball leaves behind it: many short pieces of the spiral, fading and thinning
// towards the eye, plus two thin speed lines alongside, and a soft glow under the ball.
let fibTrailN = 0;
function fibTrail(sq, u, len, width) {
  const N = 60; const id = `ft${fibTrailN++}`;
  const pts = Array.from({ length: N + 1 }, (_, k) => fibPoint(sq, u - len + len * k / N));
  // One tapered shape (thin tail -> wide at the ball), filled with a fade from tail to ball.
  const edge = (side, k0) => pts.map((p, k) => { const w = width * (0.08 + 0.92 * (k / N) ** 1.4) * side; return [p.x - p.ty * w, p.y + p.tx * w]; });
  const left = edge(1); const right = edge(-1).reverse();
  const tail = pts[0]; const head = pts[N];
  const grad = (gid, op) => `<linearGradient id='${gid}' gradientUnits='userSpaceOnUse' x1='${f(tail.x)}' y1='${f(tail.y)}' x2='${f(head.x)}' y2='${f(head.y)}'><stop offset='0' stop-color='#4fe0b6' stop-opacity='0'/><stop offset='.55' stop-color='#4fe0b6' stop-opacity='${f(op * 0.35 * 100) / 100}'/><stop offset='1' stop-color='#b5ffe8' stop-opacity='${op}'/></linearGradient>`;
  // speed lines: two thin strands alongside the last part of the trail
  const strand = (side) => polyline(pts.slice(Math.round(N * 0.35)).map((p, k, all) => { const t = k / (all.length - 1); const w = width * (1.6 + 0.6 * t) * side; return [p.x - p.ty * w, p.y + p.tx * w]; }));
  return {
    defs: grad(id, 0.95) + grad(`${id}s`, 0.5),
    svg: `<path d='${poly([...left, ...right])}' fill='url(#${id})'/>`
      + `<path d='${polyline(pts.map((p) => [p.x, p.y]))}' fill='none' stroke='url(#${id})' stroke-width='${f(Math.max(0.8, width * 0.22))}' stroke-linecap='round'/>`
      + `<path d='${strand(1)}${strand(-1)}' fill='none' stroke='url(#${id}s)' stroke-width='${f(Math.max(0.6, width * 0.12))}' stroke-linecap='round'/>`
      + `<circle cx='${f(head.x)}' cy='${f(head.y)}' r='${f(width * 5)}' fill='url(#trailHead)'/>`,
  };
}
// zones: [x0, y0, x1, y1] that must stay free (text, photo, header); an icon of radius r at
// (x, y) must not touch them (pad) and must stay inside the screen.
const fibFree = (x, y, r, zones, W, H, pad = 14) => x - r >= 8 && y - r >= 8 && x + r <= W - 8 && y + r <= H - 8
  && zones.every(([a, b, c, d]) => x + r + pad < a || x - r - pad > c || y + r + pad < b || y - r - pad > d);
const fibDebug = {};
// Owner (24.11): "nu se vede prea bine" -> lighter bodies, stronger rim light and seams, brighter
// spiral and trails, a light ring around every icon.
const FIB_BRIGHT = true;
const fibBrightDefs = commonDefs
  .replace("<stop offset='0' stop-color='#1a6a57'/><stop offset='.45' stop-color='#0b3a33'/><stop offset='1' stop-color='#031b18'/></radialGradient>", "<stop offset='0' stop-color='#3fb896'/><stop offset='.45' stop-color='#187563'/><stop offset='1' stop-color='#07362f'/></radialGradient>")
  .replace("<stop offset='0' stop-color='#1a6a57'/><stop offset='.45' stop-color='#0b3a33'/><stop offset='1' stop-color='#031b18'/></linearGradient>", "<stop offset='0' stop-color='#3fb896'/><stop offset='.45' stop-color='#187563'/><stop offset='1' stop-color='#07362f'/></linearGradient>")
  .replace("<stop offset='.45' stop-color='#000' stop-opacity='0'/><stop offset='1' stop-color='#000' stop-opacity='.6'/>", "<stop offset='.5' stop-color='#000' stop-opacity='0'/><stop offset='1' stop-color='#000' stop-opacity='.42'/>")
  .replace("<stop offset='0' stop-color='#b5ffe8' stop-opacity='.26'/>", "<stop offset='0' stop-color='#e2fff6' stop-opacity='.5'/>");
// seams and dial lines a lot more visible (the drawings are shared with the older layout)
const fibBrighten = (svg) => svg.replace(/stroke='#33c49c' stroke-opacity='\.(62|6|45|5|4|35|25)'/g, (m, o) => `stroke='#7dffd6' stroke-opacity='${Math.min(0.95, Number('.' + o) + 0.3).toFixed(2)}'`);
// items: [kind, u, size factor (of the square), rotation, arg]
function fibonacci({ W, H, tiling, zones, items = [], chain, glows, sparkles, calm, label }) {
  const sq = fibTiling(tiling);
  let defs = FIB_BRIGHT ? fibBrightDefs : commonDefs; let atmo = '';
  glows.forEach((g, i) => { const gl = glow(`gl${i}`, ...g); defs += gl.defs; atmo += gl.svg(W, H); });
  defs += `<radialGradient id='calmG' gradientUnits='userSpaceOnUse' cx='${calm[0]}' cy='${calm[1]}' r='1' gradientTransform='translate(${calm[0]} ${calm[1]}) scale(${calm[2]} ${calm[3]}) translate(${-calm[0]} ${-calm[1]})'><stop offset='0' stop-color='#000' stop-opacity='.7'/><stop offset='1' stop-color='#000' stop-opacity='0'/></radialGradient><mask id='calm' maskUnits='userSpaceOnUse' x='-4000' y='-4000' width='${W + 8000}' height='${H + 8000}'><rect x='-4000' y='-4000' width='${W + 8000}' height='${H + 8000}' fill='#fff'/><rect x='-4000' y='-4000' width='${W + 8000}' height='${H + 8000}' fill='url(#calmG)'/></mask>`;
  defs += `<radialGradient id='trailHead'><stop offset='0' stop-color='#8dffdc' stop-opacity='.34'/><stop offset='1' stop-color='#8dffdc' stop-opacity='0'/></radialGradient>`;
  // the Fibonacci squares, barely visible, and the spiral itself as a thin line of light
  let grid = ''; let spiral = '';
  for (const q of sq) {
    if (q.i < 4) continue;
    grid += `M${P(q.x, q.y)}h${f(q.s)}v${f(q.s)}h${f(-q.s)}Z`;
    spiral += `${spiral ? '' : `M${P(...q.p0)}`}A${f(q.rad)} ${f(q.rad)} 0 0 ${q.da > 0 ? 1 : 0} ${P(...q.p1)}`;
  }
  let rnd = 20261124;
  const rand = () => { rnd = (rnd * 1664525 + 1013904223) % 4294967296; return rnd / 4294967296; };
  let dust = '';
  for (let i = 0; i < sparkles; i++) {
    const x = rand() * W; const y = rand() * H; const k = rand();
    dust += `<circle cx='${f(x)}' cy='${f(y)}' r='${f(0.5 + k * k * 1.6)}' fill-opacity='${f((0.12 + rand() * 0.4) * 100) / 100}'/>`;
  }
  let trails = ''; let icons = '';
  // Owner (24.11): the icons start from the eye and repeat along the spiral, one per Fibonacci
  // square, so the distance between two neighbours grows by the golden ratio, like the spiral.
  // Sizes grow more gently (chain.grow per step), or the outer icons would be huge. An icon that
  // would cover the text or the photo is left out; the next one keeps its place in the rhythm.
  if (chain) {
    const props = { whistle: [-18, 'M30 -30C44 -70 10 -100 30 -140'], stopwatch: [12, 40] };
    // The chain may start anywhere on its first arc (phase): the generator picks the start at
    // which the most icons stay clear of the content. The steps stay one square each.
    const clear = (from) => { let n = 0; for (let k = 0; k < chain.count; k++) { const q = fibPoint(sq, from + k * chain.step); if (fibFree(q.x, q.y, chain.size0 * chain.grow ** k * 0.75, zones, W, H, 24)) n++; } return n; };
    let best = chain.from;
    if (chain.auto) for (let ph = 0; ph < 1; ph += 0.02) { const from = Math.floor(chain.from) + ph; if (clear(from) > clear(best)) best = from; }
    console.log(`fundal-arena (${label}): chain starts at u=${best.toFixed(2)}, ${clear(best)} of ${chain.count} icons clear`);
    for (let k = 0; k < chain.count; k++) {
      const u = best + k * chain.step; const kind = chain.kinds[k % chain.kinds.length];
      const p = fibPoint(sq, u); const size = chain.size0 * chain.grow ** k;
      const inside = p.x - size / 2 >= 8 && p.y - size / 2 >= 8 && p.x + size / 2 <= W - 8 && p.y + size / 2 <= H - 8;
      if (!inside) continue;
      // over the content: kept in the rhythm, but only as a faint shadow behind the text
      const dim = fibFree(p.x, p.y, size / 2, zones, W, H, 24) ? 1 : chain.dim;
      items.push([kind, u, size / p.s, ...(props[kind] || [0, undefined]), dim]);
    }
  }
  for (const [kind, u, k, rot = 0, arg, dim = 1] of items) {
    const p = fibPoint(sq, u); const size = p.s * k; const r = size / 2;
    const icons0 = icons.length; const trails0 = trails.length;
    if (!chain && !fibFree(p.x, p.y, r, zones, W, H)) console.warn(`fundal-arena (${label}): ${kind} at u=${u} (${Math.round(p.x)}, ${Math.round(p.y)}, r ${Math.round(r)}) touches text/photo or the edge`);
    if (seams[kind]) {
      const tr = fibTrail(sq, u - 0.03, Math.min(1.1, 0.5 + 0.08 * Math.log2(p.s)), Math.max(2, r * 0.42));
      defs += tr.defs; trails += tr.svg;
      const pose = BALL_POSE[kind][0];
      icons += `<circle cx='${f(p.x)}' cy='${f(p.y)}' r='${f(r * 1.45)}' fill='url(#trailHead)'/>` + fibBrighten(ball([kind, p.x, p.y, r, pose[0] + rot, pose[1], pose[2]]))
        + `<circle cx='${f(p.x)}' cy='${f(p.y)}' r='${f(r + 1.5)}' fill='none' stroke='#b5ffe8' stroke-opacity='.35' stroke-width='${f(Math.max(1, r * 0.04))}'/>`;
    } else icons += `<circle cx='${f(p.x)}' cy='${f(p.y)}' r='${f(r * 1.4)}' fill='url(#trailHead)'/>` + fibBrighten(prop([kind, p.x, p.y, size, rot, arg]));
    if (dim < 1) {
      icons = icons.slice(0, icons0) + `<g opacity='${dim}'>${icons.slice(icons0)}</g>`;
      trails = trails.slice(0, trails0) + `<g opacity='${dim}'>${trails.slice(trails0)}</g>`;
    }
  }
  // --debug: an overlay with numbered positions along the spiral and the content boxes (tuning aid)
  if (process.argv.includes('--debug')) {
    let d = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W} ${H}' width='${W}' height='${H}'>`;
    for (const [a, b2, c, e] of zones) d += `<rect x='${a}' y='${b2}' width='${c - a}' height='${e - b2}' fill='#f0f' fill-opacity='.12' stroke='#f0f'/>`;
    for (let u = 2; u < sq.length; u += 0.25) {
      const p = fibPoint(sq, u);
      if (p.x < -20 || p.y < -20 || p.x > W + 20 || p.y > H + 20) continue;
      d += `<circle cx='${f(p.x)}' cy='${f(p.y)}' r='4' fill='#ff0'/><text x='${f(p.x + 6)}' y='${f(p.y - 6)}' fill='#ff0' font-size='${W > 1000 ? 18 : 16}' font-family='Arial'>${u}</text>`;
    }
    fibDebug[label] = `${d}</svg>`;
  }
  const body = `<rect width='${W}' height='${H}' fill='${BASE}'/>${atmo}`
    + `<g mask='url(#calm)'><path d='${grid}' fill='none' stroke='${LINE}' stroke-opacity='.12' stroke-width='1'/>`
    + `<path d='${spiral}' fill='none' stroke='${GLOW}' stroke-opacity='.22' stroke-width='10' stroke-linecap='round'/><path d='${spiral}' fill='none' stroke='#9fffe2' stroke-opacity='.75' stroke-width='2' stroke-linecap='round'/>`
    + `<g fill='#8dffdc'>${dust}</g>${trails}</g>${icons}`;
  return { defs, body };
}
// One composition per screen shape, glued like the content (wide: centred; phone: from the top).
// ---- "Floarea-soarelui" (owner, 24.11): Fibonacci as it grows in nature. Seed n sits at
// n x 137.5° (the golden angle), at radius c·√n (Vogel's model). Owner, 24.11 later: "să nu fie
// trasate liniile spiralei, ca la floarea-soarelui, cât mai natural". So no line is drawn: the
// seeds are packed tightly enough to almost touch, as in a real sunflower head, and the eye finds
// the 21, 34 and 55 spirals by itself in the packing. Each seed is a small oval pointing away
// from the centre; the florets in the middle are smaller and brighter (the young centre of the
// flower), the seeds reach full size quickly and fade towards the edge of the screen. A tiny
// seeded jitter in place and size keeps it from looking machine-made. Each icon takes the place
// of a seed (the seeds under it are left out); the icon places are the old ones (three of the
// 21 spirals of a wider sunflower, c = iconC). Over the text or the photo everything is faint.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
function sunflower({ W, H, cx, cy, c, rMax, margin = [200, 100], size0, grow, kinds, dim, seedDim = 0.3, zones, glows, label, iconC, iconCount, arms: armCount = 21, iconArms = [3, 13], iconEvery = 2, iconSeeds = false, iconFill = 0.62, iconOp = [0.75, 0.55, 0.32, 0], goldenFade = null }) {
  const PHI = (1 + Math.sqrt(5)) / 2;
  let defs = FIB_BRIGHT ? fibBrightDefs : commonDefs; let atmo = '';
  glows.forEach((g, i) => { const gl = glow(`gl${i}`, ...g); defs += gl.defs; atmo += gl.svg(W, H); });
  defs += `<radialGradient id='trailHead'><stop offset='0' stop-color='#8dffdc' stop-opacity='.34'/><stop offset='1' stop-color='#8dffdc' stop-opacity='0'/></radialGradient>`;
  // seeds: bright young centre, steady on the disc, fading out towards rMax
  defs += `<radialGradient id='seedG' gradientUnits='userSpaceOnUse' cx='${cx}' cy='${cy}' r='${rMax}'><stop offset='0' stop-color='#d9fff0' stop-opacity='.55'/><stop offset='.08' stop-color='#a6ffe2' stop-opacity='.36'/><stop offset='.35' stop-color='#7dffd6' stop-opacity='.24'/><stop offset='.7' stop-color='#4fd9b2' stop-opacity='.14'/><stop offset='1' stop-color='#3cc39e' stop-opacity='0'/></radialGradient>`;
  defs += `<radialGradient id='seedCore' gradientUnits='userSpaceOnUse' cx='${cx}' cy='${cy}' r='${c * 9}'><stop offset='0' stop-color='#8dffdc' stop-opacity='.22'/><stop offset='1' stop-color='#8dffdc' stop-opacity='0'/></radialGradient>`;
  const inZone = (x, y, r) => zones.some(([a, b, e, d]) => x + r > a - 6 && x - r < e + 6 && y + r > b - 6 && y - r < d + 6);
  const covered = (x, y, r) => !fibFree(x, y, r, zones, W, H, 6);
  let rnd = 20261124;
  const rand = () => { rnd = (rnd * 1664525 + 1013904223) % 4294967296; return rnd / 4294967296; };
  const count = Math.ceil((rMax / c) ** 2);
  const seeds = [];
  for (let n = 1; n <= count; n++) {
    const j1 = rand(); const j2 = rand(); const j3 = rand();
    const a = n * GOLDEN_ANGLE - Math.PI / 2 + (j1 - 0.5) * 0.5 / Math.sqrt(n + 4);
    const r = c * Math.sqrt(n) * (1 + (j2 - 0.5) * 0.03);
    seeds.push({ n, a, r, x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), s: (0.9 + j3 * 0.2) * Math.min(1, 0.5 + 0.5 * Math.sqrt(n / 60)) });
  }
  const old = (n) => { const a = n * GOLDEN_ANGLE - Math.PI / 2; const r = iconC * Math.sqrt(n); return [cx + r * Math.cos(a), cy + r * Math.sin(a), r]; };
  const armsAt = (a) => [a, a + 7, a + 14].map((v) => v % armCount);
  const isIcon = (set, n) => set.includes(n % armCount) && Math.floor(n / armCount) % iconEvery === 0 && n > armCount;
  const fits = (x, y, rad) => x - rad >= 8 && y - rad >= 8 && x + rad <= W - 8 && y + rad <= H - 8;
  const clearFor = (set) => { let n2 = 0; for (let n = 1; n <= iconCount; n++) { if (!isIcon(set, n)) continue; const [x, y, r] = old(n); const rad = (size0 + r * grow) / 2; if (fits(x, y, rad) && !covered(x, y, rad)) n2++; } return n2; };
  if (iconArms === 'auto') { let best = 0; for (let a = 0; a < 7; a++) if (clearFor(armsAt(a)) > clearFor(armsAt(best))) best = a; iconArms = armsAt(best); }
  console.log(`fundal-arena (${label}): icons on arms ${iconArms.join(', ')}: ${clearFor(iconArms)} clear`);
  const placed = [];
  if (iconSeeds) iconCount = 0;   // every seed is an icon: no separate big icons
  for (let n = 1; n <= iconCount; n++) {
    if (!isIcon(iconArms, n)) continue;
    const [ox, oy, r] = old(n); const size = size0 + r * grow; const rad = size / 2;   // grows with the distance from the centre
    if (!fits(ox, oy, rad)) continue;
    let near = seeds[0]; for (const sd of seeds) if ((sd.x - ox) ** 2 + (sd.y - oy) ** 2 < (near.x - ox) ** 2 + (near.y - oy) ** 2) near = sd;
    placed.push({ n, x: near.x, y: near.y, size, rad });
  }
  let icons = ''; let k = 0;
  for (const { n, x, y, size, rad } of placed) {
    const kind = kinds[k++ % kinds.length];
    let svg = `<circle cx='${f(x)}' cy='${f(y)}' r='${f(rad * 1.45)}' fill='url(#trailHead)'/>`;
    if (seams[kind]) {
      const pose = BALL_POSE[kind][0];
      svg += fibBrighten(ball([kind, x, y, rad, pose[0] + n * 7, pose[1], pose[2]])) + `<circle cx='${f(x)}' cy='${f(y)}' r='${f(rad + 1.5)}' fill='none' stroke='#b5ffe8' stroke-opacity='.35' stroke-width='${f(Math.max(1, rad * 0.04))}'/>`;
    } else {
      const extra = { whistle: [-18, 'M30 -30C44 -70 10 -100 30 -140'], stopwatch: [12, 40] }[kind] || [0];
      svg += fibBrighten(prop([kind, x, y, size, ...extra]));
    }
    icons += covered(x, y, rad) ? `<g opacity='${dim}'>${svg}</g>` : svg;
  }
  // Owner, 24.11: "in loc de buline ... mai rare și să pui iconițele". Every seed is a small icon
  // (owner, later: "mai aleatoriu, nu chiar așa una după alta": the kind is picked at random per
  // seed, never the same as its nearest neighbours n-8, n-13, n-21, n-34; ball turn and lean are
  // random too). Each icon is drawn once in <defs> and placed with <use>, so a
  // seed costs ~60 bytes. Balls come in three turns each (the light stays top-left); the whistle
  // and stopwatch lean a little. Brightness falls off with the radius in bands (iconOp at r = 0,
  // rMax/3, 2rMax/3, rMax); over the text or the photo they are drawn at seedDim.
  if (iconSeeds) {
    const yaws = [0, 120, 240];
    for (const kind of kinds) {
      if (seams[kind]) yaws.forEach((yw, i) => { const pose = BALL_POSE[kind][0]; defs += `<g id='s${kinds.indexOf(kind)}${i}'>${fibBrighten(ball([kind, 0, 0, 50, pose[0] + yw, pose[1], pose[2]]))}</g>`; });
      else {
        const extra = { whistle: [-18, 'M30 -30C44 -70 10 -100 30 -140'], stopwatch: [12, 40] }[kind] || [0];
        defs += `<g id='s${kinds.indexOf(kind)}0'>${fibBrighten(prop([kind, 0, 0, 100, ...extra]))}</g>`;
      }
    }
    const d0 = c * Math.sqrt((2 * Math.PI) / Math.sqrt(3));
    const opAt = (r) => { const u = Math.min(1, r / rMax) * 3; const i = Math.min(2, Math.floor(u)); return iconOp[i] + (iconOp[i + 1] - iconOp[i]) * (u - i); };
    const bands = {}; const kindOf = []; let rk = 7919;
    const rand2 = () => { rk = (rk * 1664525 + 1013904223) % 4294967296; return rk / 4294967296; };
    for (const sd of seeds) {
      const { x, y, n, s, r } = sd;
      if (x < -margin[0] || y < -margin[1] || x > W + margin[0] || y > H + margin[1]) continue;
      // depth (owner: "arată ca fundalul de la WhatsApp"): three sizes in the golden ratio,
      // 1 : 1/φ : 1/φ², the smaller ones also fainter, as if further away
      const depth = goldenFade ? [0, 1, 1, 2, 2][Math.floor(rand2() * 5)] : 0;
      const size = d0 * iconFill * s * PHI ** -depth;
      let op = opAt(r) * PHI ** -depth;
      // fade at golden-ratio distances: rings of light at r0·φ^k around the centre, the icons
      // between two rings fade out (a soft wave, never quite to zero)
      if (goldenFade) { const t = Math.log(Math.max(r, 1) / goldenFade.r0) / Math.log(PHI); op *= goldenFade.low + (1 - goldenFade.low) * (0.5 + 0.5 * Math.cos(2 * Math.PI * t)) ** 1.5; }
      if (inZone(x, y, size / 2)) op *= seedDim;
      op = Math.round(op * 20) / 20; if (op <= 0) continue;
      let ki = Math.floor(rand2() * kinds.length);
      for (let tries = 0; tries < 12 && [8, 13, 21, 34].some((dn) => kindOf[n - dn] === ki); tries++) ki = Math.floor(rand2() * kinds.length);
      kindOf[n] = ki; const isBall = !!seams[kinds[ki]];
      const id = `s${ki}${isBall ? Math.floor(rand2() * 3) : 0}`;
      const rot = isBall ? '' : `rotate(${Math.round(rand2() * 50 - 25)})`;
      bands[op] = (bands[op] || '') + `<use href='#${id}' transform='translate(${Math.round(x)} ${Math.round(y)})${rot}scale(${(size / 100).toFixed(3)})'/>`;
    }
    const uses = Object.entries(bands).map(([op, u]) => `<g opacity='${op}'>${u}</g>`).join('');
    console.log(`fundal-arena (${label}): sunflower of icons, ${count} seeds (c ${c})`);
    return { defs, body: `<rect width='${W}' height='${H}' fill='${BASE}'/>${atmo}<circle cx='${cx}' cy='${cy}' r='${c * 9}' fill='url(#seedCore)'/>${uses}` };
  }
  // the seeds: one short stroke each with round ends (an oval, long axis along the radius). Seeds
  // of about the same width share one path, so the picture stays small (a few bytes per seed).
  const d0 = c * Math.sqrt((2 * Math.PI) / Math.sqrt(3));   // distance between neighbours at this density
  const g = (v) => Math.round(v);
  const clear = {}; const faint = {};
  for (const sd of seeds) {
    const { x, y, a, s } = sd;
    if (x < -margin[0] || y < -margin[1] || x > W + margin[0] || y > H + margin[1]) continue;
    if (placed.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < (p.rad + d0 * 0.35) ** 2)) continue;
    const w = Math.round(d0 * 0.6 * s * 2) / 2; const len = d0 * 0.8 * s - w;   // stroke width = the oval's short axis
    const ux = Math.cos(a) * len / 2; const uy = Math.sin(a) * len / 2;
    const seg = `M${g(x - ux)} ${g(y - uy)}l${g(2 * ux)} ${g(2 * uy)}`;
    const box = inZone(x, y, d0 * 0.4 * s) ? faint : clear; box[w] = (box[w] || '') + seg;
  }
  const paths = (box) => Object.entries(box).map(([w, d]) => `<path d='${d}' stroke-width='${w}'/>`).join('');
  console.log(`fundal-arena (${label}): sunflower with ${count} seeds (c ${c}), ${k} icons`);
  const body = `<rect width='${W}' height='${H}' fill='${BASE}'/>${atmo}<circle cx='${cx}' cy='${cy}' r='${c * 9}' fill='url(#seedCore)'/>`
    + `<g fill='none' stroke='url(#seedG)' stroke-linecap='round'>${paths(clear)}<g opacity='${seedDim}'>${paths(faint)}</g></g>${icons}`;
  return { defs, body };
}
// ---- "Vârtej de aur" (owner, 24.11: the icon sunflower "arată foarte urât ... mai dinamic, mai
// natural, îți las mână liberă"). A few balls fly out of the centre along golden spirals (the
// spiral widens by φ every quarter turn, as in a nautilus shell or a galaxy arm), each one with a
// light trail behind it, so the picture moves. Behind them, the arms are only a soft haze (no
// line), and a fine dust of light lies around the centre the way sunflower seeds do (golden
// angle, Vogel). Balls further out are bigger; a ball over the text or the photo is faint.
function vortex({ W, H, cx, cy, zones, glows, label, arms = 3, r0 = 12, turn = 0, balls, dim = 0.4, span = 1.15, haze = 0.022, dust, galaxy = null, universe = null }) {
  const PHI = (1 + Math.sqrt(5)) / 2; const kk = Math.log(PHI) / (Math.PI / 2);
  let defs = FIB_BRIGHT ? fibBrightDefs : commonDefs; let atmo = '';
  glows.forEach((g, i) => { const gl = glow(`gl${i}`, ...g); defs += gl.defs; atmo += gl.svg(W, H); });
  defs += `<radialGradient id='trailHead'><stop offset='0' stop-color='#8dffdc' stop-opacity='.34'/><stop offset='1' stop-color='#8dffdc' stop-opacity='0'/></radialGradient>`;
  defs += `<radialGradient id='vxCore' gradientUnits='userSpaceOnUse' cx='${cx}' cy='${cy}' r='220'><stop offset='0' stop-color='#9fffe2' stop-opacity='.2'/><stop offset='.4' stop-color='#4fe0b6' stop-opacity='.07'/><stop offset='1' stop-color='#4fe0b6' stop-opacity='0'/></radialGradient>`;
  defs += `<radialGradient id='vxShade'><stop offset='.78' stop-color='${BASE}' stop-opacity='.55'/><stop offset='1' stop-color='${BASE}' stop-opacity='0'/></radialGradient>`;
  defs += `<radialGradient id='vxAccent'><stop offset='0' stop-color='#22c55e' stop-opacity='.34'/><stop offset='.55' stop-color='#22c55e' stop-opacity='.1'/><stop offset='1' stop-color='#22c55e' stop-opacity='0'/></radialGradient>`;
  // th = angle travelled along the arm (radians); r = r0·φ^(th / quarter turn)
  const pt = (arm, th) => {
    const a = th + turn + (arm * 2 * Math.PI) / arms; const r = r0 * Math.exp(kk * th);
    const dx = r * (kk * Math.cos(a) - Math.sin(a)); const dy = r * (kk * Math.sin(a) + Math.cos(a)); const l = Math.hypot(dx, dy);
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), r, tx: dx / l, ty: dy / l };
  };
  const inZone = (x, y, r) => zones.some(([a, b, e, d]) => x + r > a - 10 && x - r < e + 10 && y + r > b - 10 && y - r < d + 10);
  // the haze: each arm as a broad, very soft band that widens with the spiral
  let hazeSvg = '';
  const far = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy));
  defs += `<radialGradient id='vxFadeG' gradientUnits='userSpaceOnUse' cx='${cx}' cy='${cy}' r='${f(far)}'><stop offset='0' stop-color='#fff' stop-opacity='0'/><stop offset='.12' stop-color='#fff' stop-opacity='1'/><stop offset='.6' stop-color='#fff' stop-opacity='.8'/><stop offset='1' stop-color='#fff' stop-opacity='0'/></radialGradient><mask id='vxFade' maskUnits='userSpaceOnUse' x='-2000' y='-2000' width='${W + 4000}' height='${H + 4000}'><rect x='-2000' y='-2000' width='${W + 4000}' height='${H + 4000}' fill='url(#vxFadeG)'/></mask>`;
  for (let arm = 0; arm < arms; arm++) {
    const pts = []; for (let th = 0; th < 10 * Math.PI / 2; th += 0.12) pts.push(pt(arm, th));
    for (const [wk, op] of [[0.42, haze * 0.5], [0.2, haze]]) {
      const side = (s) => pts.map((p) => [p.x - p.ty * p.r * wk * s * 0.5, p.y + p.tx * p.r * wk * s * 0.5]);
      hazeSvg += `<path d='${poly([...side(1), ...side(-1).reverse()])}' fill='#4fe0b6' fill-opacity='${op}'/>`;
    }
  }
  // the dust: tiny points at the golden angle, thinning out from the centre
  let rnd = 31415;
  const rand = () => { rnd = (rnd * 1664525 + 1013904223) % 4294967296; return rnd / 4294967296; };
  const dots = {};
  for (let n = 1; n <= dust.count; n++) {
    const a = n * Math.PI * (3 - Math.sqrt(5)); const r = dust.c * Math.sqrt(n) * (1 + (rand() - 0.5) * 0.25);
    const x = cx + r * Math.cos(a); const y = cy + r * Math.sin(a);
    if (x < -150 || y < -80 || x > W + 150 || y > H + 80) continue;
    const keep = Math.exp(-r / dust.fall); if (rand() > 0.25 + 0.75 * keep) continue;   // sparser outwards, at random
    let op = Math.round((0.3 + 0.6 * keep) * rand() ** 0.5 * 20) / 20; if (inZone(x, y, 2)) op = Math.round(op * 0.4 * 20) / 20;
    if (op <= 0) continue;
    const w = [1.6, 2.4, 3.4][Math.floor(rand() ** 2 * 3)];
    const key = `${w}|${op}`; dots[key] = (dots[key] || '') + `M${Math.round(x)} ${Math.round(y)}h0`;
  }
  const dustSvg = Object.entries(dots).map(([key, d]) => { const [w, op] = key.split('|'); return `<path d='${d}' stroke-width='${w}' stroke-opacity='${op}'/>`; }).join('');
  // ---- galaxy (owner, 24.11: "să punem mai multe secvențe Fibonacci, să arate ca o galaxie?").
  // The 3 arms of the balls become bright lanes of stars, and 5 fainter arms run between them
  // (3 + 5 = 8, all Fibonacci numbers), every one a golden spiral. The stars are scattered around
  // each arm (gaussian, wider further out, denser near the centre, as in a real spiral galaxy);
  // a few are brighter. A soft bulge lights the core and a few loose stars fill the sky.
  // Everything is static; stars over the text or the photo are drawn faint.
  let galaxySvg = '';
  if (galaxy) {
    if (galaxy.haze) { hazeSvg = hazeSvg.replace(/fill-opacity='([d.]+)'/g, (m, o) => `fill-opacity='${f((Number(o) * galaxy.haze / haze) * 1000) / 1000}'`); haze = galaxy.haze; }
    const g = galaxy; const stars = {}; const PHI_G = (1 + Math.sqrt(5)) / 2;
    const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand());
    const pt2 = (j, th) => {   // the secondary arms, between the main ones
      const a = th + turn + g.turn2 + (j * 2 * Math.PI) / g.arms2; const r = r0 * Math.exp(kk * th);
      const dx = r * (kk * Math.cos(a) - Math.sin(a)); const dy = r * (kk * Math.sin(a) + Math.cos(a)); const l = Math.hypot(dx, dy);
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), r, tx: dx / l, ty: dy / l };
    };
    const put = (x, y, w, op) => {
      if (x < -150 || y < -80 || x > W + 150 || y > H + 80) return;
      if (inZone(x, y, w)) op *= 0.35;
      op = Math.round(op * 20) / 20; if (op <= 0) return;
      const key = `${w}|${op}`; stars[key] = (stars[key] || '') + `M${Math.round(x)} ${Math.round(y)}h0`;
    };
    const lane = (at, count, wk, op0) => {
      for (let s = 0; s < count; s++) {
        const rr = r0 * PHI_G ** 1.2 + rand() * (g.rMax - r0 * PHI_G ** 1.2); const th = Math.log(rr / r0) / kk; const p = at(th);   // even in radius
        const off = gauss() * p.r * wk; const along = gauss() * p.r * wk * 0.6;
        const x = p.x - p.ty * off + p.tx * along; const y = p.y + p.tx * off + p.ty * along;
        const near = Math.exp(-Math.abs(off) / (p.r * wk * 1.2));                // brighter on the lane itself
        const fade = Math.min(1, p.r / 90) * Math.exp(-p.r / g.fall);            // from the core outwards
        const bright = rand() < 0.04;
        put(x, y, bright ? 3.6 : [1.5, 2.1, 2.8][Math.floor(rand() ** 1.6 * 3)], Math.min(1, (bright ? 1.6 : 1) * op0 * (0.2 + 0.8 * near) * (0.4 + 0.6 * rand()) * (0.25 + fade)));
      }
    };
    for (let arm = 0; arm < arms; arm++) lane((th) => pt(arm, th), g.stars, g.width, g.op);
    for (let j = 0; j < g.arms2; j++) lane((th) => pt2(j, th), g.stars2, g.width * 1.3, g.op * 0.6);
    for (let s = 0; s < g.sky; s++) put(rand() * W, rand() * H, [1.2, 1.6, 2.2][Math.floor(rand() ** 2 * 3)], 0.12 + rand() * 0.35);
    // the soft haze of the secondary arms (the main ones already have theirs)
    for (let j = 0; j < g.arms2; j++) {
      const pts = []; for (let th = 0; th < 10 * Math.PI / 2; th += 0.12) pts.push(pt2(j, th));
      const side = (s2) => pts.map((p) => [p.x - p.ty * p.r * 0.16 * s2, p.y + p.tx * p.r * 0.16 * s2]);
      hazeSvg += `<path d='${poly([...side(1), ...side(-1).reverse()])}' fill='#4fe0b6' fill-opacity='${f(haze * 0.6 * 1000) / 1000}'/>`;
    }
    defs += `<radialGradient id='vxBulge' gradientUnits='userSpaceOnUse' cx='${cx}' cy='${cy}' r='${g.bulge}'><stop offset='0' stop-color='#e8fff6' stop-opacity='.5'/><stop offset='.25' stop-color='#9fffe2' stop-opacity='.22'/><stop offset='.6' stop-color='#4fe0b6' stop-opacity='.06'/><stop offset='1' stop-color='#4fe0b6' stop-opacity='0'/></radialGradient>`;
    galaxySvg = `<circle cx='${cx}' cy='${cy}' r='${g.bulge}' fill='url(#vxBulge)'/><g fill='none' stroke='#d6fff2' stroke-linecap='round'>`
      + Object.entries(stars).map(([key, d]) => { const [w, op] = key.split('|'); return `<path d='${d}' stroke-width='${w}' stroke-opacity='${op}'/>`; }).join('') + '</g>';
  }
  // ---- universe (owner, 24.11: "mai multe galaxii dinastea, să arate ca un univers"). A few small,
  // far-away galaxies in the free corners of the screen, each one a little two-armed golden
  // spiral of stars with a bright core, seen at its own tilt (squashed and turned, as galaxies
  // look in the sky); one of them slightly bluish. Restore point: tag design-before-universe.
  let universeSvg = '';
  for (const [k, gx] of (universe || []).entries()) {
    const { x: ux, y: uy, r: ur, tilt = 0.5, rot = 0, arms: na = 2, tint = '#d6fff2', stars: ns = Math.round(ur * 2.4) } = gx;
    const ga = {}; const b0 = ur * 0.06;
    const put2 = (x, y, w, op) => { op = Math.round(op * 20) / 20; if (op <= 0) return; const key = `${w}|${op}`; ga[key] = (ga[key] || '') + `M${f(x)} ${f(y)}h0`; };
    const gauss2 = () => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand());
    for (let s = 0; s < ns; s++) {
      const arm = s % na; const rr = b0 + rand() * (ur - b0); const th = Math.log(rr / b0) / kk;
      const a = th + (arm * 2 * Math.PI) / na; const off = gauss2() * rr * 0.11;
      const x = rr * Math.cos(a) - Math.sin(a) * off; const y = rr * Math.sin(a) + Math.cos(a) * off;
      const fade = 1 - rr / ur;
      put2(x, y, [1, 1.4, 2][Math.floor(rand() ** 1.8 * 3)], (0.25 + 0.7 * fade) * (0.5 + 0.5 * rand()));
    }
    const id = `vxG${k}`;
    defs += `<radialGradient id='${id}'><stop offset='0' stop-color='#f2fffa' stop-opacity='.75'/><stop offset='.12' stop-color='${tint}' stop-opacity='.32'/><stop offset='.45' stop-color='${tint}' stop-opacity='.08'/><stop offset='1' stop-color='${tint}' stop-opacity='0'/></radialGradient>`;
    universeSvg += `<g transform='translate(${f(ux)} ${f(uy)}) rotate(${rot}) scale(1 ${tilt})'><circle r='${f(ur * 1.1)}' fill='url(#${id})'/>`
      + `<g fill='none' stroke='${tint}' stroke-linecap='round'>${Object.entries(ga).map(([key, d]) => { const [w, op] = key.split('|'); return `<path d='${d}' stroke-width='${w}' stroke-opacity='${op}'/>`; }).join('')}</g></g>`;
  }
  // the flying balls (and a few props). Owner, 24.11: "unele efecte se suprapun peste iconițe".
  // So: (1) the layers go glows -> trails -> icons, never one icon's glow over another icon;
  // (2) each trail is cut short where it would come near another icon (it ends in the open);
  // (3) every icon sits on a soft dark contact disc that separates it from what is behind;
  // (4) the small (far) icons are drawn first, the big (near) ones on top.
  // optional 5th item: { drift, span } - drift bends the trail outwards (the ball came in on a
  // wider curve, like a ball with spin), so it can pass outside the ball in front of it
  const items = balls.map(([arm, q, kind, scale = 0.17, opt = {}]) => {
    const th = (q * Math.PI) / 2; const p = pt(arm, th);
    return { arm, q, kind, th, p, rad: Math.max(8, Math.min(70, p.r * scale)), drift: opt.drift || 0, span: opt.span, accent: !!opt.accent };
  });
  const clearOf = (self, x, y) => items.every((o) => o === self || Math.hypot(o.p.x - x, o.p.y - y) > o.rad * 1.5 + self.rad * 0.5 + 6);
  let glows2 = ''; let trails = ''; let icons = ''; let i = 0;
  // a few points of light left behind in the trail, like the dust of a comet (bigger near the ball)
  const sparks = (pts, rad) => {
    let s = ''; const n = Math.round(5 + rad / 6);
    for (let k = 0; k < n; k++) {
      const u = 0.12 + 0.8 * rand(); const pp = pts[Math.round(u * (pts.length - 1))]; const off = (rand() - 0.5) * rad * (2.6 - u);
      s += `<circle cx='${f(pp.x - pp.ty * off)}' cy='${f(pp.y + pp.tx * off)}' r='${f((0.6 + rand() * 1.6) * (0.4 + u) * Math.max(1, rad / 25))}' fill='#c8fff0' fill-opacity='${f((0.15 + 0.5 * u * rand()) * 100) / 100}'/>`;
    }
    return s;
  };
  for (const it of [...items].sort((a, b) => a.rad - b.rad)) {
    const { arm, q, kind, th, p, rad, drift } = it;
    const faint = inZone(p.x, p.y, rad); const wrap = (s) => (faint ? `<g opacity='${dim}'>${s}</g>` : s);
    glows2 += wrap(`<circle cx='${f(p.x)}' cy='${f(p.y)}' r='${f(rad * (it.accent ? 1.9 : 1.6))}' fill='url(#${it.accent ? 'vxAccent' : 'trailHead'})'/>`);
    let ic = `<circle cx='${f(p.x)}' cy='${f(p.y)}' r='${f(rad * 1.12)}' fill='url(#vxShade)'/>`;
    if (seams[kind]) {
      // walk back from the ball along the arm until the trail would touch another icon
      const sp0 = it.span || span * Math.min(1, 0.6 + q / 12); let sp = sp0; const step = 0.02;
      const tp = (s) => { const b = pt(arm, th - s); const m = 1 + drift * (s / sp0) ** 1.4; return { x: cx + (b.x - cx) * m, y: cy + (b.y - cy) * m }; };
      for (let s = rad / p.r; s <= sp; s += step) { const b = tp(s); if (!clearOf(it, b.x, b.y)) { sp = Math.max(0.2, s - 0.08); break; } }
      if (process.env.VXDBG) console.log(label, arm, q, kind, Math.round(p.x), Math.round(p.y), Math.round(rad), "sp", sp.toFixed(2), "of", sp0.toFixed(2));
      const N = 48; const id = `vt${i++}`;
      const pts = Array.from({ length: N + 1 }, (_, k) => tp(sp - (sp * k) / N)).map((pp, k, all) => {
        const a = all[Math.max(0, k - 1)]; const b = all[Math.min(N, k + 1)]; const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        return { ...pp, tx: (b.x - a.x) / l, ty: (b.y - a.y) / l };
      });
      const edge = (s) => pts.map((pp, k) => { const w = rad * 0.82 * (0.05 + 0.95 * (k / N) ** 1.3) * s; return [pp.x - pp.ty * w, pp.y + pp.tx * w]; });
      const tail = pts[0];
      defs += `<linearGradient id='${id}' gradientUnits='userSpaceOnUse' x1='${f(tail.x)}' y1='${f(tail.y)}' x2='${f(p.x)}' y2='${f(p.y)}'><stop offset='0' stop-color='#4fe0b6' stop-opacity='0'/><stop offset='.6' stop-color='#4fe0b6' stop-opacity='.16'/><stop offset='1' stop-color='#b5ffe8' stop-opacity='.6'/></linearGradient>`;
      trails += wrap(`<path d='${poly([...edge(1), ...edge(-1).reverse()])}' fill='url(#${id})'/>`
        + `<path d='${polyline(pts.map((pp) => [pp.x, pp.y]))}' fill='none' stroke='url(#${id})' stroke-width='${f(Math.max(0.8, rad * 0.12))}' stroke-linecap='round'/>`
        + sparks(pts, rad));
      const pose = BALL_POSE[kind][0];
      // lit from the centre of the vortex (owner, 24.11: "să arate și mai bine"): the ball's
      // highlight sits at about -124° in its own drawing, so the whole ball is turned until the
      // highlight faces the centre; the side away from the centre falls into shadow
      const toCentre = (Math.atan2(cy - p.y, cx - p.x) * 180) / Math.PI;
      ic += `<g transform='rotate(${Math.round(toCentre + 124)} ${f(p.x)} ${f(p.y)})'>${fibBrighten(ball([kind, p.x, p.y, rad, pose[0] + q * 40, pose[1], pose[2]]))}</g>`
        + `<circle cx='${f(p.x)}' cy='${f(p.y)}' r='${f(rad + 1.5)}' fill='none' stroke='${it.accent ? '#22c55e' : '#b5ffe8'}' stroke-opacity='${it.accent ? '.85' : '.35'}' stroke-width='${f(Math.max(1, rad * (it.accent ? 0.05 : 0.04)))}'/>`;
    } else {
      const extra = { whistle: [-18, 'M30 -30C44 -70 10 -100 30 -140'], stopwatch: [12, 40] }[kind] || [0];
      ic += fibBrighten(prop([kind, p.x, p.y, rad * 2, ...extra]));
    }
    icons += wrap(ic);
  }
  items.forEach((a, ia) => items.forEach((b, ib) => { if (ia < ib && Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y) < (a.rad + b.rad) * 1.3) console.warn(`fundal-arena (${label}): icons ${a.arm}:${a.q} and ${b.arm}:${b.q} almost touch`); }));
  if (process.argv.includes('--debug')) {
    let d = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W} ${H}' width='${W}' height='${H}'>`;
    for (const [a, b2, c, e] of zones) d += `<rect x='${a}' y='${b2}' width='${c - a}' height='${e - b2}' fill='#f0f' fill-opacity='.12' stroke='#f0f'/>`;
    for (let arm = 0; arm < arms; arm++) for (let q = 2; q <= 10; q += 0.5) { const p = pt(arm, (q * Math.PI) / 2); d += `<circle cx='${f(p.x)}' cy='${f(p.y)}' r='4' fill='#ff0'/><text x='${f(p.x + 6)}' y='${f(p.y - 6)}' fill='#ff0' font-size='16' font-family='Arial'>${arm}:${q}</text>`; }
    fibDebug[label] = `${d}</svg>`;
  }
  console.log(`fundal-arena (${label}): golden vortex, ${arms} arms, ${balls.length} icons`);
  const body = `<rect width='${W}' height='${H}' fill='${BASE}'/>${atmo}<circle cx='${cx}' cy='${cy}' r='220' fill='url(#vxCore)'/><g mask='url(#vxFade)'>${hazeSvg}</g>`
    + `${galaxy ? galaxySvg : `<g fill='none' stroke='#b5ffe8' stroke-linecap='round'>${dustSvg}</g>`}${universeSvg}${glows2}${trails}${icons}`;
  return { defs, body };
}
function fibSvg(W, H, align, comp) {
  const { defs, body } = comp.vortex ? vortex({ W, H, ...comp, ...comp.vortex }) : comp.sunflower ? sunflower({ W, H, ...comp, ...comp.sunflower }) : fibonacci({ W, H, ...comp });
  const vig = `<linearGradient id='vig' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='${BASE}' stop-opacity='.35'/><stop offset='.12' stop-color='${BASE}' stop-opacity='0'/><stop offset='.88' stop-color='${BASE}' stop-opacity='0'/><stop offset='1' stop-color='${BASE}' stop-opacity='.35'/></linearGradient>`;
  return `<svg xmlns='http://www.w3.org/2000/svg' width='100%' height='100%'><defs>${defs}${vig}</defs><rect width='100%' height='100%' fill='${BASE}'/>`
    + `<svg width='100%' height='100%' viewBox='0 0 ${W} ${H}' preserveAspectRatio='${align} meet' overflow='visible'>${body}</svg><rect width='100%' height='100%' fill='url(#vig)'/></svg>`;
}
// Content boxes on the first screen (measured on the real page, in picture units).
const FIB_ZONES_WIDE = [[0, 0, 1600, 150], [169, 321, 485, 381], [169, 399, 608, 475], [169, 500, 637, 566], [169, 601, 565, 664], [169, 700, 779, 783], [850, 340, 1431, 690], [1020, 800, 1260, 850]];   // photo cards, gallery dots
const FIB_ZONES_PHONE = [[0, 0, 547, 222], [34, 275, 290, 324], [34, 338, 444, 409], [34, 434, 513, 552], [34, 586, 326, 664], [34, 684, 213, 747], [34, 786, 513, 876], [34, 921, 513, 1184]];
const fibWide = fibSvg(1600, 1000, 'xMidYMid', {
  // golden vortex (owner, 24.11): [arm, quarter turns from the centre, kind, size factor]
  vortex: { cx: 800, cy: 540, arms: 3, r0: 12, turn: 0.4, dim: 0.4, dust: { count: 900, c: 30, fall: 420 },
    galaxy: { arms2: 5, turn2: 0.6, stars: 560, stars2: 240, width: 0.05, op: 0.95, fall: 1500, rMax: 1000, sky: 90, bulge: 160, haze: 0.04 },
    // small far-away galaxies in the free corners: { x, y, r, tilt, rot, arms, tint }
    universe: [{ x: 1350, y: 235, r: 95, tilt: 0.42, rot: -25 }, { x: 1500, y: 870, r: 75, tilt: 0.62, rot: 35, tint: '#bfe6ff' }, { x: 92, y: 640, r: 48, tilt: 0.5, rot: 70 }, { x: 1040, y: 935, r: 38, tilt: 0.35, rot: -12, arms: 3 }, { x: 1545, y: 520, r: 30, tilt: 0.7, rot: 15 }],
    balls: [[0, 5.5, 'tennis'], [1, 5, 'volleyball'], [2, 6, 'basketball'], [0, 7, 'soccer', 0.17, { span: 1.6, accent: true }], [2, 7.5, 'whistle', 0.09], [1, 8, 'soccer', 0.12],
      // owner: "încă câteva iconițe și să nu se termine așa brusc": small ones born at the centre, more towards the edges
      [1, 4, 'tennis'], [2, 4.5, 'soccer'], [0, 4.5, 'volleyball']] },
  label: 'wide', zones: FIB_ZONES_WIDE,
  sunflower: { cx: 800, cy: 540, c: 32, rMax: 980, iconSeeds: true, iconFill: 0.8, iconOp: [0.95, 0.75, 0.42, 0], goldenFade: { r0: 60, low: 0.25 }, iconC: 52, iconCount: 377, size0: 22, grow: 0.075, iconArms: [2, 9, 16], iconEvery: 2, kinds: ['tennis', 'whistle', 'stopwatch', 'volleyball', 'basketball', 'soccer'], dim: 0.4 },
  tiling: { n: 14, flipX: false, flipY: true, fit: { cx: 800, cy: 540, w: 1080 } },
  glows: [[815, 880, 520, 380, '#11936f', 0.16], [300, -60, 900, 600, '#0e8064', 0.14], [1500, 980, 600, 420, '#0a5e4b', 0.1]],
  sparkles: 40, calm: [470, 520, 380, 300],
  // smallest near the eye, biggest outside: 55 -> 89 -> 144 -> 377 -> 610 -> 987 squares
  chain: { from: 6.5, step: 1, count: 8, size0: 26, grow: 1.2, dim: 0.45, kinds: ['tennis', 'whistle', 'stopwatch', 'volleyball', 'basketball', 'soccer'] },
});
const fibPhone = fibSvg(547, 1184, 'xMidYMin', {
  vortex: { cx: 273, cy: 600, arms: 3, r0: 9, turn: 1.2, dim: 0.4, dust: { count: 700, c: 26, fall: 330 },
    galaxy: { arms2: 5, turn2: 0.6, stars: 400, stars2: 170, width: 0.05, op: 0.95, fall: 1100, rMax: 800, sky: 50, bulge: 110, haze: 0.04 },
    universe: [{ x: 455, y: 250, r: 50, tilt: 0.45, rot: -20 }, { x: 440, y: 762, r: 32, tilt: 0.55, rot: 30, tint: '#bfe6ff' }, { x: 80, y: 205, r: 26, tilt: 0.6, rot: 60 }],
    // phone (owner, 24.11 cleanup): at most one ball per arm within a quarter turn, so every trail stays whole
    balls: [[0, 6.5, 'soccer', 0.17, { accent: true }], [1, 6, 'tennis'], [2, 5.5, 'basketball', 0.15],
      [2, 4.5, 'tennis'], [0, 4, 'soccer'], [1, 4.5, 'volleyball'], [1, 7, 'soccer', 0.08]] },
  label: 'phone', zones: FIB_ZONES_PHONE,
  sunflower: { cx: 273, cy: 600, c: 28, rMax: 760, iconSeeds: true, iconFill: 0.8, iconOp: [1, 0.9, 0.55, 0], goldenFade: { r0: 45, low: 0.25 }, margin: [60, 60], iconC: 43, iconCount: 233, size0: 18, grow: 0.075, iconArms: 'auto', iconEvery: 1, kinds: ['tennis', 'whistle', 'stopwatch', 'volleyball', 'basketball', 'soccer'], dim: 0.4 },
  tiling: { n: 15, flipX: true, fit: { cx: 273, cy: 600, w: 500 } },
  glows: [[420, 715, 340, 300, '#11936f', 0.16], [500, -60, 520, 520, '#0e8064', 0.16]],
  sparkles: 26, calm: [250, 520, 300, 330],
  chain: { from: 6.5, step: 1, count: 9, size0: 20, grow: 1.2, dim: 0.45, kinds: ['tennis', 'whistle', 'stopwatch', 'volleyball', 'basketball', 'soccer'] },
});

// Fine grain (tiny repeating tile): breaks up the banding of dark gradients.
const grain = `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n' x='0' y='0'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .75  0 0 0 0 1  0 0 0 0 .9  .5 0 0 0 -.22'/></filter><rect width='180' height='180' filter='url(#n)' opacity='.32'/></svg>`;

// base64: the drawings use url(#id) internally, which the public build scanner would read as files.
const toUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
// Default: the Fibonacci composition (owner, 24.11.2026). --ref draws the previous reference layout.
const useRef = process.argv.includes('--ref');
const variants = { '--design-bg-arena': useRef ? wide : fibWide, '--design-bg-arena-phone': useRef ? phone : fibPhone, '--design-bg-grain': grain };
const cssPath = fileURLToPath(new URL('../../Idee Site/css/design-background.css', import.meta.url));
let css = readFileSync(cssPath, 'utf8');
for (const [name, svg] of Object.entries(variants)) {
  const pattern = new RegExp(`${name}: url\\("[^"]*"\\);`);
  if (!pattern.test(css)) throw new Error(`${name} line not found in design-background.css`);
  css = css.replace(pattern, () => `${name}: url("${toUri(svg)}");`);
  console.log(`fundal-arena: ${name} ${(toUri(svg).length / 1024).toFixed(1)} KB`);
}
if (!process.argv.includes('--dry')) writeFileSync(cssPath, css);   // --dry: only the --svg files
const out = process.argv.indexOf('--svg');
if (out > 0) for (const [label, svg] of Object.entries(fibDebug)) writeFileSync(`${process.argv[out + 1]}-dbg-${label}.svg`, svg);
if (out > 0) for (const [name, svg] of Object.entries(variants)) writeFileSync(`${process.argv[out + 1]}${name.replace('--design-bg', '')}.svg`, svg);
