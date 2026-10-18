const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const factory = import(pathToFileURL(path.join(__dirname,'../functions/booking-notifications/handler.ts')).href);
const tokens = import(pathToFileURL(path.join(__dirname,'../functions/_shared/booking-token.ts')).href);
const ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const LEASE = 'bbbbbbbb-2222-4222-8222-222222222222';
const BOOKING = 'cccccccc-3333-4333-8333-333333333333';
const SERVICE = 'the-service-role-secret';
const CANCEL_SECRET = 'independent-cancellation-secret-32bytes';
const BOOKING_HOOK = 'https://hook.eu2.make.com/booking12345678901234567890';
const CHAT_HOOK = 'https://hook.eu2.make.com/chat12345678901234567890123';
const day = '2026-10-25';
function job(kind='booking_created_client', overrides={}) {
  return {
    notification_id: ID,lease_token:LEASE,attempt:1,kind,booking_id:BOOKING,
    recipient:{email:kind.endsWith('owner')?'owner@example.test':'client@example.test',name:'Ana'},
    booking:{id:BOOKING,courtName:'Teren unu',sport:'Fotbal',baseName:'Baza Verde',city:'Cluj-Napoca',dayISO:day,hours:['18:00','19:00'],remainingHours:[],amountRON:200,customerName:'Ana',customerEmail:'client@example.test',customerPhone:'+40 721 123 456'},
    chat:{courtName:'Teren unu',customerName:'Ana',preview:'Aveți vestiar?'},...overrides,
  };
}
const json = (body,status=200) => new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
function request(body={action:'dispatch'}, token=SERVICE, method='POST') {
  return new Request('https://project.supabase.co/functions/v1/booking-notifications',{method,headers:token?{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}:{'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)})});
}
async function fixture(overrides={}) {
  const calls=[]; const pending=overrides.jobs??[job()];
  const fetch=async(url,options={})=>{
    const endpoint=new URL(url); const headers=new Headers(options.headers);const body=typeof options.body==='string'?JSON.parse(options.body):null;
    const call={url,path:endpoint.pathname,method:options.method,body,headers,redirect:options.redirect};calls.push(call);
    if(overrides.fetch){const response=await overrides.fetch(call,calls);if(response!==undefined)return response;}
    if(endpoint.pathname.endsWith('/get_booking_notification_config')) return json(overrides.settings??{ready:true,booking_webhook_url:BOOKING_HOOK,chat_webhook_url:CHAT_HOOK});
    if(endpoint.pathname.endsWith('/claim_booking_notifications')) return json(pending);
    if(endpoint.pathname.endsWith('/attach_cancellation_token')) return json(true);
    if(endpoint.pathname.endsWith('/finish_booking_notification')) return json(true);
    if(url===BOOKING_HOOK||url===CHAT_HOOK) return new Response('Accepted',{status:200});
    assert.fail(`Unexpected request: ${options.method} ${url}`);
  };
  const {createHandler}=await factory;
  return {handler:createHandler({url:'https://project.supabase.co',serviceKey:SERVICE,cancellationSecret:CANCEL_SECRET,...overrides.config},{fetch,timeoutMs:100,...overrides.dependencies}),calls};
}

test('dispatcher requires exact server authorization and never trusts a public JWT or HTTP GET',async()=>{
  const {handler,calls}=await fixture();
  for(const token of [null,'anon-public-key','eyJhbGciOiJub25lIn0.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.','the-service-role-secret-wrong']) assert.equal((await handler(request({action:'dispatch'},token))).status,401);
  assert.equal((await handler(request({},SERVICE,'GET'))).status,405);
  assert.equal(calls.length,0);
});
test('unconfigured transport and missing independent production secret leave all jobs queued',async()=>{
  for(const options of [
    {settings:{ready:false,booking_webhook_url:BOOKING_HOOK,chat_webhook_url:CHAT_HOOK}},
    {settings:{ready:true,booking_webhook_url:null,chat_webhook_url:null}},
    {settings:{ready:true,booking_webhook_url:'https://evil.example/steal',chat_webhook_url:null}},
    {config:{cancellationSecret:''}},
    {config:{cancellationSecret:undefined}},
  ]) {
    const {handler,calls}=await fixture(options); const response=await handler(request());
    assert.equal(response.status,200);assert.equal((await response.json()).status,'pending_configuration');
    assert.ok(!calls.some(call=>/claim_booking_notifications|finish_booking_notification/.test(call.path)));
    assert.ok(!calls.some(call=>call.url.startsWith('https://hook.')));
  }
});
test('client receipt derives/attaches only the digest before submitting a deterministic private cancellation link',async()=>{
  const {handler,calls}=await fixture(); const response=await handler(request({action:'dispatch',booking_id:BOOKING}));const result=await response.json();
  assert.equal(response.status,200);assert.deepEqual(result,{status:'submitted',submitted:1,queued:0,blocked:0});
  const claim=calls.find(call=>call.path.endsWith('/claim_booking_notifications'));assert.equal(claim.body.p_booking_id,BOOKING);assert.equal(claim.body.p_lease_seconds,120);
  const attach=calls.find(call=>call.path.endsWith('/attach_cancellation_token'));assert.equal(attach.body.p_booking_id,BOOKING);
  const {deriveBookingCancellationToken,hashCancellationToken}=await tokens;
  const token=await deriveBookingCancellationToken(CANCEL_SECRET,BOOKING);assert.equal(attach.body.p_token_hash,await hashCancellationToken(token));
  assert.ok(!JSON.stringify(attach.body).includes(token));
  const send=calls.find(call=>call.url===BOOKING_HOOK);assert.ok(calls.indexOf(attach)<calls.indexOf(send));
  assert.equal(send.headers.get('X-Spotivity-Notification-Id'),ID);assert.equal(send.headers.get('Authorization'),null);assert.equal(send.redirect,'error');
  assert.equal(send.body.notification_id,ID);assert.equal(send.body.to.email,'client@example.test');assert.match(send.body.text,/18:00–19:00, 19:00–20:00/);
  assert.ok(send.body.text.includes(`#anulare-rezervare=${BOOKING}&token=${token}`));
  assert.ok(!JSON.stringify(send.body).includes(SERVICE));assert.ok(!JSON.stringify(send.body).includes(CANCEL_SECRET));
  const finished=calls.find(call=>call.path.endsWith('/finish_booking_notification'));assert.equal(finished.body.p_outcome,'submitted');assert.equal(finished.body.p_error_code,null);
  assert.ok(!JSON.stringify(result).includes(token));assert.ok(!JSON.stringify(result).includes('client@example.test'));
});
test('owner bookings/cancellations and client cancellation notices contain no raw cancellation credentials',async()=>{
  for(const kind of ['booking_created_owner','booking_cancelled_owner','booking_cancelled_client']){
    const {handler,calls}=await fixture({jobs:[job(kind)]});await handler(request());
    assert.ok(!calls.some(call=>call.path.endsWith('/attach_cancellation_token')));
    const send=calls.find(call=>call.url===BOOKING_HOOK);assert.ok(send);assert.ok(!send.body.html.includes('#anulare-rezervare='));
    if(kind.endsWith('_owner')) assert.ok(send.body.text.includes('+40 721 123 456'));
  }
});
test('a partial booking receipt retains the cancellation link for its remaining hour',async()=>{
  const {handler,calls}=await fixture({jobs:[job('booking_created_client',{booking:{...job().booking,hours:['19:00'],amountRON:100}})]});
  assert.equal((await (await handler(request())).json()).submitted,1);
  const send=calls.find(call=>call.url===BOOKING_HOOK);
  assert.match(send.body.text,/19:00–20:00/);assert.ok(!send.body.text.includes('18:00–19:00'));
  assert.ok(send.body.text.includes(`#anulare-rezervare=${BOOKING}&token=`));
  assert.equal(send.body.record.amountRON,100);
});
test('chat uses its separate scenario and carries escaped HTML with the authorized recipient',async()=>{
  const {handler,calls}=await fixture({jobs:[job('chat_owner',{booking_id:null,chat:{courtName:'<Teren>',customerName:'Ana',preview:'<script>private()</script>'}})]});
  const response=await handler(request());assert.equal((await response.json()).status,'submitted');
  const send=calls.find(call=>call.url===CHAT_HOOK);assert.equal(send.body.to.email,'owner@example.test');assert.equal(send.body.booking_id,null);
  assert.ok(send.body.html.includes('&lt;script&gt;private()&lt;/script&gt;'));assert.ok(!send.body.html.includes('<script>'));
  assert.equal(send.body.record.preview,'<script>private()</script>');
});
test('a missing chat scenario does not claim chat jobs',async()=>{
  const {handler,calls}=await fixture({settings:{ready:true,booking_webhook_url:BOOKING_HOOK,chat_webhook_url:null},jobs:[]});
  await handler(request());const claim=calls.find(call=>call.path.endsWith('/claim_booking_notifications'));
  assert.ok(!claim.body.p_kinds.includes('chat_owner'));assert.equal(claim.body.p_kinds.length,4);
});
test('temporary Make errors retry the same stable notification ID and permanent errors block without leaking provider responses',async()=>{
  for(const [status,outcome,errorCode] of [[429,'retry','make_http_429'],[503,'retry','make_http_503'],[400,'blocked','make_rejected']]){
    const {handler,calls}=await fixture({fetch:call=>call.url===BOOKING_HOOK?new Response('Sensitive provider configuration must not be logged',{status}):undefined});
    const response=await handler(request());const body=await response.json();assert.equal(response.status,200);assert.equal(body.status,'queued');
    const finished=calls.find(call=>call.path.endsWith('/finish_booking_notification'));assert.equal(finished.body.p_notification_id,ID);assert.equal(finished.body.p_outcome,outcome);assert.equal(finished.body.p_error_code,errorCode);
    assert.ok(!JSON.stringify(body).includes('Sensitive provider'));assert.ok(!JSON.stringify(finished.body).includes('Sensitive provider'));
  }
});
test('network uncertainty retries with the original ID and an explicit uncertain outcome',async()=>{
  const {handler,calls}=await fixture({fetch:call=>{if(call.url===BOOKING_HOOK) throw new Error('Network failed after remote acceptance');}});
  const response=await handler(request());assert.equal((await response.json()).queued,1);
  const finished=calls.find(call=>call.path.endsWith('/finish_booking_notification'));assert.equal(finished.body.p_error_code,'delivery_uncertain');assert.equal(finished.body.p_outcome,'retry');assert.equal(finished.body.p_notification_id,ID);
});
test('a failed token attachment never sends a nonworking cancellation link',async()=>{
  const {handler,calls}=await fixture({fetch:call=>call.path.endsWith('/attach_cancellation_token')?json({error:'temporarily unavailable'},503):undefined});
  assert.equal((await (await handler(request())).json()).queued,1);assert.ok(!calls.some(call=>call.url===BOOKING_HOOK));
  assert.equal(calls.find(call=>call.path.endsWith('/finish_booking_notification')).body.p_error_code,'database_unavailable');
});
test('malformed template input is blocked without sending any email',async()=>{
  const {handler,calls}=await fixture({jobs:[job('booking_created_owner',{recipient:{email:'victim@example.test\r\nBcc:other@example.test'}})]});
  const result=await (await handler(request())).json();assert.equal(result.blocked,1);
  assert.ok(!calls.some(call=>call.url===BOOKING_HOOK));assert.equal(calls.find(call=>call.path.endsWith('/finish_booking_notification')).body.p_error_code,'invalid_template_input');
});
test('unacknowledged accepted mail remains queued for lease recovery rather than reporting successful submission',async()=>{
  const {handler}=await fixture({fetch:call=>call.path.endsWith('/finish_booking_notification')?json(false):undefined});
  assert.equal((await (await handler(request())).json()).status,'queued');
});
test('invalid request payloads fail before any database or provider access',async()=>{
  for(const body of [{action:'other'},{action:'dispatch',booking_id:'not-a-uuid'},[],null]){
    const {handler,calls}=await fixture();assert.equal((await handler(request(body))).status,400);assert.equal(calls.length,0);
  }
});
