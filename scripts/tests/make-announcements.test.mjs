import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnnouncementScenario } from '../make-announcements.mjs';
const anonKey = ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({role:'anon'})).toString('base64url'), 'public-test-signature'].join('.');
const config = {keychainId:101,gmailConnectionId:11897572,teamId:2838814,supabaseUrl:'https://project.supabase.co',anonKey,campaignId:'aaaaaaaa-1111-4111-8111-111111111111'};
const byID = (b,id) => b.flow.find(m=>m.id===id);
for(const audience of ['clients','admins']) {
  test(`${audience}: preview-only manual default and exact RPC contract`,()=>{
    const out=buildAnnouncementScenario({...config,audience}), b=out.blueprint;
    assert.deepEqual(out.scheduling,{type:'on-demand'});
    assert.deepEqual(JSON.parse(out.createBody.blueprint),b);
    assert.deepEqual(JSON.parse(out.createBody.scheduling),out.scheduling);
    assert.equal(out.createBody.teamId,config.teamId);
    assert.ok(!('isActive' in out.createBody)); // Make API activation is deliberately separate.
    assert.deepEqual(byID(b,1).mapper.variables.map(x=>x.name),['mod','id_campanie','subiect','mesaj','numar_asteptat']);
    assert.equal(byID(b,1).mapper.variables[0].value,'PREVIZUALIZARE');
    assert.equal(byID(b,1).mapper.variables[4].value,0);
    assert.equal(b.metadata.instant,false); assert.equal(b.metadata.scenario.sequential,true);
    assert.equal(b.metadata.scenario.confidential,true); assert.equal(b.metadata.scenario.dlq,false);
    assert.equal(b.metadata.scenario.dataloss,false);
    const args={2:['p_audience','p_campaign_id','p_subject','p_message'],4:['p_audience','p_campaign_id','p_expected_count'],7:['p_audience','p_campaign_id','p_recipient_id'],10:['p_audience','p_campaign_id','p_recipient_id','p_lease_token']};
    for(const [id,keys] of Object.entries(args)) {
      const m=byID(b,Number(id)); assert.equal(m.module,'json:TransformToJSON');
      assert.deepEqual(Object.keys(m.mapper.object),keys); assert.equal(m.mapper.object.p_audience,audience);
    }
    const endpoints=['announcement_preview','announcement_approve','announcement_claim','announcement_finish'];
    for(const [i,id] of [3,5,8,11].entries()) {
      const m=byID(b,id); assert.equal(m.module,'http:MakeRequest'); assert.equal(m.version,4);
      assert.equal(m.parameters.authenticationType,'apiKey'); assert.equal(m.parameters.apiKeyKeychain,config.keychainId);
      assert.equal(m.mapper.url,`${config.supabaseUrl}/rest/v1/rpc/${endpoints[i]}`);
      assert.equal(m.mapper.method,'post'); assert.equal(m.mapper.allowRedirects,false);
      assert.equal(m.mapper.stopOnHttpError,true); assert.equal(m.mapper.parseResponse,true);
      assert.equal(m.mapper.jsonStringBodyContent,`{{${[2,4,7,10][i]}.json}}`);
      assert.deepEqual(m.onerror[0].mapper,{});
      assert.equal(m.onerror[0].module,'builtin:Rollback');
    }
    const gate=byID(b,4).filter.conditions;
    assert.deepEqual(gate,[[{a:'{{1.mod}}',o:'text:equal',b:'TRIMITE'},{a:'{{3.data.count}}',o:'number:equal',b:'{{1.numar_asteptat}}'},{a:'{{1.numar_asteptat}}',o:'number:greater',b:'0'}]]);
    assert.equal(byID(b,6).module,'builtin:BasicFeeder');assert.equal(byID(b,6).mapper.array,'{{5.data.recipients}}');
    const gmail=byID(b,9);
    assert.deepEqual(gmail.mapper.to,['{{8.data.to_email}}']); assert.ok(!('cc'in gmail.mapper));assert.ok(!('bcc'in gmail.mapper));
    assert.equal(gmail.mapper.subject,'{{8.data.subject}}');assert.equal(gmail.mapper.content,'{{8.data.html}}');
    assert.deepEqual(gmail.filter.conditions,[[{a:'{{8.data.send}}',o:'boolean:equal',b:'true'}]]);
    assert.deepEqual(gmail.onerror[0].mapper,{});
    assert.equal(gmail.onerror[0].module,'builtin:Rollback');
    assert.equal(b.metadata.scenario.dlq,false);
    assert.equal(gmail.parameters.__IMTCONN__,config.gmailConnectionId);
    const serialized=JSON.stringify(out);
    for(const forbidden of ['service_role','sb_secret_','SUPABASE_SERVICE_ROLE_KEY','http://','gateway:CustomWebHook']) assert.ok(!serialized.includes(forbidden));
  });
}

test('subject and multiline message are structured values serialized before HTTP, not JSON interpolation',()=>{
  const {blueprint}=buildAnnouncementScenario({...config,audience:'clients'});
  const data={'1.id_campanie':config.campaignId,'1.subiect':'Anunț "nou" \\ test','1.mesaj':'Prima linie\nA doua: "quoted" \\ slash\tși diacritice.'};
  const object=Object.fromEntries(Object.entries(byID(blueprint,2).mapper.object).map(([k,v])=>[k,v.match(/^\{\{(.+)\}\}$/)?data[v.slice(2,-2)]:v]));
  const body=JSON.stringify(object),parsed=JSON.parse(body);
  assert.equal(parsed.p_subject,data['1.subiect']);assert.equal(parsed.p_message,data['1.mesaj']);
  assert.equal(byID(blueprint,3).mapper.jsonStringBodyContent,'{{2.json}}');
});

test('builder rejects private credentials, arbitrary destinations and invalid audience or credential IDs',()=>{
  for(const change of [{audience:'everyone'},{keychainId:0},{gmailConnectionId:-1},{campaignId:'new'},{supabaseUrl:'http://project.supabase.co'},{supabaseUrl:'https://evil.test'},{supabaseUrl:'https://project.supabase.co/extra'},{anonKey:'sb_secret_do-not-leak'},{anonKey:'sb_publishable_unsupported-bearer'}, {anonKey:['header',Buffer.from('{"role":"service_role"}').toString('base64url'),'signature'].join('.')}]) assert.throws(()=>buildAnnouncementScenario({...config,audience:'clients',...change}),TypeError);
});
