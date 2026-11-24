// Isolated SQL only. 052 changes only the announcement footer contact and link.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {fixture,uid}=require('./announcement-panel.test.cjs');
const migration=readFileSync(join(__dirname,'../052_announcement_contact_workspace.sql'),'utf8');
const migration031=readFileSync(join(__dirname,'../031_production_announcement_links.sql'),'utf8');

async function check(apply031){
 const f=await fixture(),{pg,root,preview}=f;
 try{
  const campaign=await preview(5291);
  if(apply031){await root('select 1');await pg.exec(migration031);}
  const snapshot=async()=>({
   campaign:(await root('select to_jsonb(c) value from spotivity_private.announcement_campaigns c order by id')).rows,
   recipients:(await root('select to_jsonb(r) value from spotivity_private.announcement_recipients r order by id')).rows,
   config:(await root('select to_jsonb(c) value from spotivity_private.announcement_panel_config c')).rows,
   policies:(await root('select * from pg_policies order by schemaname,tablename,policyname')).rows
  });
  const before=await snapshot();
  await root('select 1');await pg.exec(migration);
  assert.deepEqual(await snapshot(),before);
  const img=`${uid(4)}/${campaign.campaign_id}/${uid(9)}.png`;
  const mail=(await root("select spotivity_private.announcement_mail('<Titlu>','Text & <script>', $1) v",[img])).rows[0].v;
  for(const body of [mail.text,mail.html]){
   assert.ok(body.includes('contact@spotivity.ro'));assert.ok(!body.includes('gmail.com'));assert.ok(!body.includes('github.io'));
  }
  assert.match(mail.text,/https:\/\/spotivity\.ro\//);
  assert.match(mail.html,/href="mailto:contact@spotivity\.ro"/);assert.match(mail.html,/href="https:\/\/spotivity\.ro\/"/);
  assert.match(mail.html,/&lt;Titlu&gt;/);assert.match(mail.html,/Text &amp; &lt;script&gt;/);
  assert.match(mail.html,/supabase\.co\/storage\/v1\/object\/public\/announcement_images\//);
  await assert.rejects(()=>f.as(1,'select spotivity_private.announcement_mail($1,$2,null)',['x','y']),e=>e.code==='42501');
  await root('select 1');await assert.rejects(()=>pg.exec(migration),/already applied or superseded/);await pg.exec('rollback');
  if(!apply031){await root('select 1');await assert.rejects(()=>pg.exec(migration031),/Review the current announcement renderer/);await pg.exec('rollback');}
 }finally{await pg.close();}
}

test('052 replaces the 030 renderer: company contact, final domain, same private state',()=>check(false));
test('052 also accepts the 031 renderer',()=>check(true));
