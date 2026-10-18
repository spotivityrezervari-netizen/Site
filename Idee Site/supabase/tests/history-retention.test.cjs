const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {runInNewContext}=require('node:vm');
const window={};runInNewContext(readFileSync(join(__dirname,'../../js/security.js'),'utf8'),{window,Intl,Date,URL});
const recent=window.bookingInRecentHistory;
const now=Date.parse('2026-10-18T12:00:00Z');
test('retention hides only slots ended more than 30 days ago and preserves exact boundary/future rows',()=>{
 assert.equal(recent({starts_at:'2026-09-18T10:59:59Z'},now),false);
 assert.equal(recent({starts_at:'2026-09-18T11:00:00Z'},now),true);
 assert.equal(recent({starts_at:'2026-10-18T11:00:00Z'},now),true);
 assert.equal(recent({starts_at:'2027-01-01T11:00:00Z',stare:'anulata'},now),true);
});
test('civil fallback uses Bucharest time and keeps rows without a usable recorded date',()=>{
 assert.equal(recent({data_str:'2026-09-18',ora:'13:00'},now),false);
 assert.equal(recent({data_str:'2026-09-18',ora:'14:00'},now),true);
 assert.equal(recent({data_str:'legacy-date',ora:'12:00'},now),true);
});
test('recorded timestamps remain authoritative across daylight-saving offset changes',()=>{
 const cutoff=Date.parse('2026-11-18T12:00:00Z');
 assert.equal(recent({starts_at:'2026-10-19T13:59:59+03:00'},cutoff),false);
 assert.equal(recent({starts_at:'2026-10-19T14:00:00+03:00'},cutoff),true);
});
