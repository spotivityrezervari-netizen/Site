// A realistic local transport must not hide row caps or shared SQL RPCs.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createFixture}=require('./club-request-fixture.cjs');

test('shared browser fixture applies current SQL, honors row caps/ranges and transports durable rate limits',async()=>{
 const f=await createFixture();
 try{
  await f.root(()=>f.pg.exec("insert into public.terenuri(nume,sport,pret) select 'Pagination court '||lpad(n::text,4,'0'),'Fotbal',100 from generate_series(1,1001) n"));
  const url=`https://${f.host}/rest/v1/terenuri?select=id,nume&order=id.asc`;
  let response=await f.transport(url),rows=await response.json();assert.equal(rows.length,1000);assert.equal(response.headers.get('content-range'),'0-999/*');
  response=await f.transport(url+'&offset=1000&limit=1000');rows=await response.json();assert.equal(rows.length,3);assert.equal(response.headers.get('content-range'),'1000-1002/*');
  response=await f.transport(url+'&offset=2000&limit=1000');assert.deepEqual(await response.json(),[]);
  response=await f.transport(url,{method:'HEAD',headers:{range:'1000-1002',prefer:'count=exact'}});assert.equal(response.headers.get('content-range'),'1000-1002/1003');assert.equal(await response.text(),'');
  response=await f.transport(`https://${f.host}/rest/v1/rpc/consume_public_rate_limit`,{method:'POST',headers:{authorization:`Bearer ${f.serviceKey}`,'content-type':'application/json'},body:JSON.stringify({p_scope:'club_application',p_subject_hash:'a'.repeat(64),p_limit:20,p_window_seconds:600})});assert.equal(response.status,200);assert.equal(await response.json(),true);
 }finally{await f.pg.close();}
});
