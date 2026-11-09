import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const paths = require('../../Idee Site/js/entity-paths.js');
const uuid = 'AB123456-1234-1234-1234-123456789ABC';

test('shared URL identifiers retain full numeric/UUID identity and reject unsafe input', () => {
    for (const id of [1, 10001, '9223372036854775807', uuid]) assert.equal(paths.validId(id), true);
    for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, undefined, true, '0', '01', '1/../2', '1?admin=true', '1#token', '12345678901234567890']) assert.equal(paths.validId(id), false, String(id));
    assert.equal(paths.normalizedId(uuid), uuid.toLowerCase());
    assert.equal(paths.normalizedId(10001), '10001');
});

test('diacritics and markup become bounded readable slugs without path or query syntax', () => {
    assert.equal(paths.slug('  Bază Ștrand Târgu Mureș!  '), 'baza-strand-targu-mures');
    assert.equal(paths.slug('<img src=x onerror="alert(1)"> /?x=#'), 'img-src-x-onerror-alert-1-x');
    assert.equal(paths.slug('💙', 'Bază sportivă'), 'baza-sportiva');
    assert.equal(paths.slug('A'.repeat(200)).length, 96);
    assert.equal(paths.slug('////', '../'), 'teren');
    assert.match(paths.slug('A '.repeat(100)), /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(paths.citySlug('Târgu Mureș.'), 'targu-mures');
    for (const absent of [undefined, null, '', '   ', '...', '💙']) assert.equal(paths.citySlug(absent), '');
    assert.equal(paths.citySlug('C'.repeat(120)), 'c'.repeat(40));
});

test('court paths include city, sport, base, court and full ID, with collision-resistant identity', () => {
    const court = { id: 12, sport: 'Fotbal', nume: 'Teren sintetic', oras: 'Târgu Mureș.' };
    assert.equal(paths.courtPath(court, { nume: 'Baza Transilvania', oras: 'Reghin' }), 'terenuri/fotbal/targu-mures-baza-transilvania-teren-sintetic-12/');
    assert.equal(paths.courtPath(court), 'terenuri/fotbal/targu-mures-teren-sintetic-12/');
    assert.notEqual(paths.courtPath(court), paths.courtPath({ ...court, id: 13 }));
    assert.notEqual(paths.courtPath(court), paths.courtPath({ ...court, oras: 'Reghin' }));
    assert.equal(paths.courtPath({ ...court, sport: 'Tenis Picior', id: uuid }), `terenuri/tenis-de-picior/targu-mures-teren-sintetic-${uuid.toLowerCase()}/`);
    assert.equal(paths.courtPath({ ...court, sport: 'constructor' }), '');
    assert.equal(paths.courtPath({ ...court, id: '../../private' }), '');
    const longPath = paths.courtPath({ ...court, id: uuid, sport: 'Tenis Picior', nume: 'A'.repeat(200), oras: 'C'.repeat(120) }, { nume: 'B'.repeat(200) });
    assert.ok(longPath.length < 240); assert.ok(longPath.endsWith(`-${uuid.toLowerCase()}/`));
    assert.ok(longPath.split('/')[2].startsWith('c'.repeat(40) + '-'));
    assert.equal(paths.courtPath({ ...court, oras: '' }, { nume: 'Bază', oras: 'Ștefănești' }), 'terenuri/fotbal/stefanesti-baza-teren-sintetic-12/');
    for (const absent of ['   ', '...', '💙']) assert.equal(paths.courtPath({ ...court, oras: absent }, { nume: 'Bază', oras: 'Ștefănești' }), 'terenuri/fotbal/stefanesti-baza-teren-sintetic-12/');
    assert.equal(paths.courtPath({ ...court, oras: undefined }), 'terenuri/fotbal/teren-sintetic-12/');
});

test('base paths and supported sport aliases never return inherited object properties', () => {
    assert.equal(paths.basePath({ id: uuid, nume: 'Bază & Club', oras: 'Târgu Mureș.' }), `baze-sportive/targu-mures-baza-club-${uuid.toLowerCase()}/`);
    assert.equal(paths.basePath({ id: 5, nume: '' }), 'baze-sportive/baza-5/');
    assert.equal(paths.basePath({ id: 'no' }), '');
    const longPath = paths.basePath({ id: uuid, nume: 'N'.repeat(200), oras: 'O'.repeat(120) });
    assert.ok(longPath.length < 240);
    assert.ok(longPath.startsWith('baze-sportive/' + 'o'.repeat(40) + '-'));
    assert.ok(longPath.endsWith(`-${uuid.toLowerCase()}/`));
    for (const [sport, expected] of [['Fotbal', 'fotbal'], ['Tenis', 'tenis'], ['Volei', 'volei'], ['Baschet', 'baschet'], ['tenis de picior', 'tenis-de-picior'], ['Tenis Picior', 'tenis-de-picior']]) assert.equal(paths.sportSlug(sport), expected);
    for (const sport of ['constructor', 'toString', '__proto__', 'Fotbal/../../private', 'Football']) assert.equal(paths.sportSlug(sport), '');
});

test('the reviewed helper has identical browser and Node output', () => {
    const context = vm.createContext({ window: {} });
    vm.runInContext(readFileSync(new URL('../../Idee Site/js/entity-paths.js', import.meta.url), 'utf8'), context);
    const browser = context.window.SpotivityEntityPaths;
    assert.equal(browser.courtPath({ id: 12, sport: 'Volei', nume: 'Primăvara', oras: 'Târgu Mureș' }), paths.courtPath({ id: 12, sport: 'Volei', nume: 'Primăvara', oras: 'Târgu Mureș' }));
    assert.equal(browser.basePath({ id: uuid, nume: 'Club', oras: 'Reghin' }), paths.basePath({ id: uuid, nume: 'Club', oras: 'Reghin' }));
    assert.equal(Object.isFrozen(browser), true);
});
