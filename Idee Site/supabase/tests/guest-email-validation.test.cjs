// Real PostgreSQL validation and the actual Edge/mail email predicate. No live writes.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {readFileSync,readdirSync}=require('node:fs');
const {join}=require('node:path');
const {pathToFileURL}=require('node:url');
const directory=join(__dirname,'..');
const valid=['client@example.test','test+court@example.co.uk','șerban@example.test'];
const invalid=['a<b@example.test','a>b@example.test','a\u0085b@example.test','a\ufeffb@example.test','a\u3000b@example.test','a\nb@example.test','a@.','a'.repeat(250)+'@example.test','é'.repeat(124)+'@test.example'];
const modules=Promise.all(['_shared/email-address.ts','_shared/transactional-mail.ts'].map(file=>import(pathToFileURL(join(directory,'functions',file)).href)));

test('the Edge input and mail renderer share the same UTF-8 and character contract',async()=>{
 const [{isMailAddress},{renderTransactionalMail}]=await modules;
 for(const email of valid){assert.equal(isMailAddress(email),true,email);assert.equal(renderTransactionalMail({kind:'account_welcome',recipient:{email}}).to.email,email);}
 for(const email of [...invalid,'a\0b@example.test']){assert.equal(isMailAddress(email),false,email);assert.throws(()=>renderTransactionalMail({kind:'account_welcome',recipient:{email}}),/Invalid email recipient/);}
});

test('SQL rejects undeliverable new guest contacts before a slot or notification is committed',async()=>{
 const pg=new PGlite();
 try{
  let schema=readFileSync(join(__dirname,'schema.sql'),'utf8');
  if(process.env.SPOTIVITY_TEST_INTEGER_IDS==='1')schema=schema.replaceAll('id uuid primary key default gen_random_uuid()','id bigint generated always as identity primary key');
  await pg.exec(schema);
  await pg.exec("alter table auth.users add column created_at timestamptz not null default '2000-01-01',add column deleted_at timestamptz,add column banned_until timestamptz,add column is_anonymous boolean not null default false");
  for(const file of readdirSync(directory).filter(file=>/^(001|00[3-9]|01\d|02\d|03[0-5])_.*\.sql$/.test(file)).sort())await pg.exec(readFileSync(join(directory,file),'utf8'));
  const court=(await pg.query("select id::text id,pret from public.terenuri where nume='Court A'")).rows[0];
  const day=(await pg.query("select ((now() at time zone 'Europe/Bucharest')::date+1)::text booking_day")).rows[0].booking_day;
  const historic='aaaaaaaa-1111-4111-8111-111111111111';
  const create=async(id,email,hour='16:00',phone='+40721123456')=>{
   await pg.exec('reset role;set role service_role');
   return (await pg.query('select public.create_guest_booking_group($1,$2,$3,$4::text[],false,$5,$6,$7,$8) value',[id,court.id,day,[hour],'Fixture Client',email,phone,Number(court.pret)])).rows[0].value;
  };
  await create(historic,'historic@example.test','15:00');
  await pg.exec('reset role');await pg.query('update spotivity_private.booking_groups set contact_email=$2 where id=$1',[historic,invalid[0]]);
  const snapshot=async()=>{
   await pg.exec('reset role');return (await pg.query("select (select count(*)from spotivity_private.booking_groups) groups,(select count(*)from public.rezervari) slots,(select count(*)from spotivity_private.notification_outbox) jobs")).rows[0];
  };
  const before=await snapshot();const migration=readFileSync(join(directory,'038_guest_email_validation.sql'),'utf8');
  await pg.exec(migration);await pg.exec(migration);assert.deepEqual(await snapshot(),before,'Installation and reapply do not rewrite bookings or queue mail');
  for(const email of valid)assert.equal((await pg.query('select spotivity_private.valid_booking_email($1) valid',[email])).rows[0].valid,true,email);
  for(let index=0;index<invalid.length;index++){
   const email=invalid[index];assert.equal((await pg.query('select spotivity_private.valid_booking_email($1) valid',[email])).rows[0].valid,false,email);
   // Do not reuse the historical booking's phone: its one-active-booking
   // guard would reject first and leave the new email predicate unexercised.
   await assert.rejects(()=>create(`bbbbbbbb-1111-4111-8111-${String(index+1).padStart(12,'0')}`,email,'16:00',`+40722${String(index).padStart(6,'0')}`),error=>error.code==='22023',email);
   assert.deepEqual(await snapshot(),before,'Rejected contacts never occupy a slot or queue mail');
  }
  await pg.query("update spotivity_private.booking_groups set contact_email=contact_email,contact_name='Historical client' where id=$1",[historic]);
  await pg.exec('set role service_role');
  await pg.query('select public.attach_cancellation_token($1,$2)',[historic,'a'.repeat(64)]);
  await pg.query('select public.cancel_booking_group_by_token($1,$2)',[historic,'a'.repeat(64)]);
  await pg.exec('reset role');
  assert.equal((await pg.query('select contact_email,status from spotivity_private.booking_groups where id=$1',[historic])).rows[0].status,'anulata','Historical unchanged email cannot block cancellation');
  await assert.rejects(()=>pg.query('update spotivity_private.booking_groups set contact_email=$2 where id=$1',[historic,invalid[1]]),error=>error.code==='22023');
  for(const role of ['anon','authenticated','service_role'])assert.equal((await pg.query("select has_function_privilege($1,'spotivity_private.valid_booking_email(text)','execute') allowed",[role])).rows[0].allowed,false);
  const created=await create('cccccccc-1111-4111-8111-111111111111',valid[1]);assert.equal(created.total,Number(court.pret));
 }finally{await pg.close();}
});
