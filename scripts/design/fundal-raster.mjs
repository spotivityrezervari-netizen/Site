// Renders the background scenes of fundal-arena.mjs to WebP files (25.11.2026, hero brief).
// Uses the Playwright copy of the browser tests (Idee Site/supabase/tests/node_modules) and a local
// Chromium/Edge: set CHROMIUM_PATH (on Windows: C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe).
// The browser paints the SVG at the exact pixel size, then its own WebP encoder compresses it; the
// quality steps down until the file fits its budget (maxKB).
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(fileURLToPath(new URL('../../Idee Site/supabase/tests/package.json', import.meta.url)));

export async function rasterize(scenes, outDir) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true });
  try {
    for (const [name, { svg, width, height, maxKB }] of Object.entries(scenes)) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      await page.setContent(`<!doctype html><html style="height:100%"><body style="margin:0;height:100%;overflow:hidden;background:#011012">${svg}</body></html>`);
      const png = await page.screenshot({ type: 'png' });
      const webp = await page.evaluate(async ({ b64, maxKB }) => {
        const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        let q = 0.94, url;
        do { url = c.toDataURL('image/webp', q); q -= 0.04; } while (url.length * 0.75 > maxKB * 1024 && q > 0.3);
        if (!url.startsWith('data:image/webp')) throw new Error('This browser cannot encode WebP');
        return { data: url.split(',')[1], quality: Math.round((q + 0.04) * 100) };
      }, { b64: png.toString('base64'), maxKB });
      const bytes = Buffer.from(webp.data, 'base64');
      writeFileSync(`${outDir}${name}.webp`, bytes);
      console.log(`fundal-raster: ${name}.webp ${width}x${height} q${webp.quality} ${(bytes.length / 1024).toFixed(1)} KB`);
      await page.close();
    }
  } finally { await browser.close(); }
}
