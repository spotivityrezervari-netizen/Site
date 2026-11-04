const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {runInNewContext} = require('node:vm');

function helper() {
    const window = {};
    runInNewContext(readFileSync(join(__dirname, '../../js/security.js'), 'utf8'), {
        window, URL, Intl, Date, document: {addEventListener() {}}
    });
    return window.spotivityReadAllRows;
}

test('reads beyond the REST row limit, including a server cap below the requested page size', async () => {
    const all = Array.from({length: 1203}, (_, id) => ({id, value: `row-${id}`}));
    const ranges = [];
    const result = await helper()(() => ({range: async (from, to) => {
        ranges.push([from, to]);
        return {data: all.slice(from, Math.min(to + 1, from + 173)), error: null};
    }}));
    assert.equal(result.error, null);
    assert.deepEqual(Array.from(result.data, row => row.id), all.map(row => row.id));
    assert.deepEqual(ranges.at(-1), [1203, 1702]);
});

test('returns no incomplete data when a later page fails', async () => {
    const failure = {message: 'read failed'};
    const result = await helper()(() => ({range: async from => from
        ? {data: null, error: failure} : {data: [{id: 1}], error: null}}));
    assert.equal(result.data, null);
    assert.equal(result.error, failure);
});

test('handles empty lists and rejects a transport which ignores ranges', async () => {
    const read = helper();
    const empty = await read(() => ({range: async () => ({data: [], error: null})}));
    assert.equal(empty.data.length, 0);
    assert.equal(empty.error, null);
    const repeated = await read(() => ({range: async () => ({data: [{id: 'same'}], error: null})}));
    assert.equal(repeated.data, null);
    assert.match(repeated.error.message, /repeated/);
});

test('failed requests and malformed list responses cannot masquerade as an empty list', async () => {
    for (const factory of [() => {throw new Error('offline');},
        () => ({range: async () => ({data: null, error: null})})]) {
        const result = await helper()(factory);
        assert.equal(result.data, null);
        assert.ok(result.error);
    }
});

function catalogFixture(rows, onPage = () => {}) {
    const window = {spotivityReadAllRows: helper()}, state = {authGeneration: 1, user: null, courts: []};
    const db = {from: () => ({select() {return this;}, order() {return this;}, async range(from, to) {
        onPage(state, from);
        return {data: rows.slice(from, to + 1), error: null};
    }})};
    runInNewContext(readFileSync(join(__dirname, '../../js/modules/public-courts.js'), 'utf8'), {
        window, document: {}, clearTimeout
    });
    return {state, catalog: window.SpotivityModules.publicCourts({db, state, services: {}})};
}

test('the public catalog includes courts after the first thousand rows', async () => {
    const rows = Array.from({length: 1203}, (_, id) => ({id, nume: `Court ${id}`}));
    const {state, catalog} = catalogFixture(rows);
    assert.equal(await catalog.load(), true);
    assert.equal(state.courts.length, rows.length);
    assert.equal(state.courts.at(-1).nume, 'Court 1202');
});

test('a catalog load cannot restore the previous identity after sign-out', async () => {
    const {state, catalog} = catalogFixture([{id: 1}], current => {current.authGeneration++;});
    assert.equal(await catalog.load(), false);
    assert.equal(state.courts.length, 0);
});
