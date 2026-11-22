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

// Wide screens (coordinates 1600 x 1000): the photo spread evenly over the whole screen,
// centred: its top half fills the left half, its bottom half the right half, both starting
// below the header bars. Only pieces right behind the text or the photo card are softened.
const WX = 1.42; const WY = 1.03;
const WL = (x, y) => [22 + x * WX, 170 + y * WY];
const WR = (x, y) => [800 + 22 + x * WX, 170 + (y - 800) * WY];
const behindWide = (x, y) => (x > 150 && x < 800 && y > 270 && y < 840) || (x > 870 && x < 1400 && y > 330 && y < 720);
const wide = layout({
  W: 1600, H: 1000,
  glows: [[140, -80, 950, 720, '#11936f', 0.24], [1480, -60, 760, 620, '#0e8064', 0.16], [1180, 640, 620, 380, '#0a5e4b', 0.1], [760, 1060, 820, 300, '#0e8064', 0.14]],
  sparkles: 60,
  calm: [470, 520, 420, 300],
  groups: [
    ...zoned(REF.filter((i) => i[2] < 800), REF_RIBBONS.filter((r) => r[0][1] < 800), WL, 0.8, [1600, 1000], behindWide, 'xMinYMid', 0.2),
    ...zoned(REF.filter((i) => i[2] >= 800), REF_RIBBONS.filter((r) => r[0][1] >= 800), WR, 0.8, [1600, 1000], behindWide, 'xMaxYMid', 0.2),
  ],
});
// Portrait screens (547 x 1184, the phone's shape). Fewer pieces, placed with care:
// top (glued to the top, below the header): the basketball with its light trail right of
// the title and the racket right of the green button; bottom (glued to the bottom, seen in
// the gaps between sections while scrolling): two staggered rows, big pieces on the outside.
const phone = layout({
  W: 547, H: 1184,
  glows: [[500, -60, 520, 520, '#11936f', 0.24], [60, 980, 460, 320, '#0e8064', 0.12], [280, 640, 380, 280, '#0a5e4b', 0.1]],
  sparkles: 34,
  calm: [250, 560, 300, 330],
  groups: [
    { align: 'xMidYMin',
      ribbons: [
        { a: [[-40, 520], [140, 470], [330, 420], [452, 266]], b: [[-40, 600], [200, 540], [400, 400], [466, 330]], n: 34, strength: 0.9, peak: 0.86, endOp: 0.6, width: 70, twist: 0.8 },
      ],
      decor: [['dots', 498, 470, 3, 3, 0.8], ['ring', 512, 560, 7, 0, 0.8], ['plus', 380, 236, 0, 0, 0.8], ['cross', 28, 236, 0, 0, 0.8]],
      props: [['racket', 470, 658, 84, 22]],
      balls: [['basketball', 478, 292, 44, -40, 15, -50]] },
    { align: 'xMidYMax',
      ribbons: [
        { a: [[-40, 1070], [160, 1030], [360, 960], [600, 820]], b: [[-40, 1110], [200, 1070], [400, 1000], [600, 880]], n: 26, strength: 0.6, peak: 0.5, width: 60, twist: 0.75 },
      ],
      decor: [['ring', 275, 900, 9, 0, 0.8], ['dots', 252, 1040, 3, 2, 0.8], ['plus', 40, 975, 0, 0, 0.8], ['cross', 510, 975, 0, 0, 0.8]],
      props: [['stopwatch', 290, 965, 62, 10, 40], ['trophy', 462, 912, 76, 0], ['whistle', 120, 1040, 66, -16, 'M30 -30C50 -70 30 -110 70 -150']],
      balls: [['soccer', 90, 912, 44, 18, -14, 8], ['volleyball', 455, 1036, 30, 45, 35, 0]] },
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
