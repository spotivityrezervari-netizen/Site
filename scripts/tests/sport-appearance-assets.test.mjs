import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import vm from 'node:vm';

const site = new URL('../../Idee%20Site/', import.meta.url);
const sources = await Promise.all(['js/security.js', 'js/sport-appearance.js'].map(name => readFile(new URL(name, site), 'utf8')));
const current = {
  Fotbal: 'assets/imagini/BackgroundFootball.avif',
  Baschet: 'assets/imagini/BackgroundBasketball.avif',
  Tenis: 'assets/imagini/TenisFINAL.jpeg',
  Volei: 'assets/imagini/BackgroundVoleyball.avif',
  'Tenis Picior': 'assets/imagini/BackgroundLavolei.avif'
};
const pages = 'https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/';

async function appearance(rows = [], error = null) {
  const document = { addEventListener() {}, querySelectorAll: () => [] };
  const window = { dispatchEvent() {} };
  const query = { select() { return this; }, order() { return this; }, abortSignal: async () => ({ data: rows, error }) };
  const context = vm.createContext({ window, document, db: { from: () => query }, URL, AbortController,
    setTimeout, clearTimeout, CustomEvent: class {} });
  for (const source of sources) vm.runInContext(source, context);
  await window.spotivitySportAppearanceReady;
  return window;
}

test('bundled sport images exist when public configuration is unavailable', async () => {
  const window = await appearance(null, new Error('Public configuration unavailable'));
  for (const sport of Object.keys(current)) assert.equal(window.getSportAppearance(sport).fundal_url, current[sport]);
  for (const config of Object.values(window.spotivitySportAppearance)) {
    for (const path of [config.icona_url, config.fundal_url]) await access(new URL(path, site));
  }
});

test('retired relative and exact GitHub Pages defaults use the new photographs', async () => {
  const previous = {
    Fotbal: ['fundal-fotbal.webp', 'RealistFotbal.png', 'RealistFotbal1.png', 'FotbalFinal.jpeg', 'BackgroundFootball.avif'],
    Baschet: ['fundal-baschet.webp', 'RealisBaschet.png', 'BaschetFinal.jpeg', 'BackgroundBasketball.avif'],
    Tenis: ['fundal-tenis.webp', 'RealistTenis.png', 'TenisFINAL.jpeg', 'TenisVFinal.jpg'],
    Volei: ['fundal-volei.webp', 'RealistVolei.png', 'VoleiVFinal.jpg', 'BackgroundVoleyball.avif'],
    'Tenis Picior': ['fundal-tenis-picior.webp', 'RealistTenispicior.png', 'BackgroundLavolei.avif']
  };
  for (const [sport, filenames] of Object.entries(previous)) {
    for (const filename of filenames) {
      const path = `assets/imagini/${filename}`;
      for (const fundal_url of [path, new URL(path, pages).href, new URL(path, pages).href.replace('%20', ' ')]) {
        const window = await appearance([{ sport, fundal_url, icona_url: 'assets/imagini/avatar2.png', ordine: 5 }]);
        const config = window.getSportAppearance(sport);
        assert.equal(config.fundal_url, current[sport]);
        assert.equal(config.icona_url, 'assets/imagini/avatar2.png');
        assert.equal(config.ordine, 5);
      }
    }
  }
});

test('custom HTTPS images, custom local assets and unrelated sport choices remain intact', async () => {
  const custom = [
    ['Tenis', 'https://cdn.example.test/assets/imagini/TenisFINAL.jpeg'],
    ['Tenis', `${pages}assets/imagini/TenisFINAL.jpeg?custom=1`],
    ['Baschet', 'https://cdn.example.test/assets/imagini/BackgroundBasketball.avif'],
    ['Tenis Picior', `${pages}assets/imagini/BackgroundLavolei.avif?custom=1`],
    ['Volei', 'assets/imagini/avatar2.png'],
    ['Fotbal', 'assets/imagini/VoleiVFinal.jpg'],
    ['Volei', 'assets/imagini/BackgroundLavolei.avif'],
    ['Tenis Picior', 'assets/imagini/BackgroundVoleyball.avif']
  ];
  for (const [sport, fundal_url] of custom) {
    const window = await appearance([{ sport, fundal_url }]);
    assert.equal(window.getSportAppearance(sport).fundal_url, fundal_url);
  }
});

test('invalid or broken custom images fall back to each sport bundled asset', async () => {
  for (const sport of Object.keys(current)) {
    const invalid = await appearance([{ sport, fundal_url: 'javascript:alert(1)' }]);
    assert.equal(invalid.getSportAppearance(sport).fundal_url, current[sport]);
    const window = await appearance([{ sport, fundal_url: 'https://cdn.example.test/missing.jpg' }]);
    const handlers = new Map(), attributes = new Map([['data-sport-background', sport], ['src', '']]);
    const image = { dataset: {}, getAttribute: name => attributes.get(name),
      set src(value) { attributes.set('src', value); }, addEventListener: (event, handler) => handlers.set(event, handler) };
    window.applySportAppearance({ querySelectorAll: selector => selector === 'img[data-sport-background]' ? [image] : [] });
    assert.equal(image.getAttribute('src'), 'https://cdn.example.test/missing.jpg');
    handlers.get('error')();
    assert.equal(image.getAttribute('src'), current[sport]);
  }
});
