// Execute the real browser modules with a capped REST adapter. No hosted access.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {runInNewContext}=require('node:vm');
const source=name=>readFileSync(join(__dirname,'../../js',name),'utf8');
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));

function fixture(tables={}) {
    class Element {
        constructor(){this.style={};this.value='';this.innerText='';this.disabled=false;this.children=[];this.handlers={};this.classList={add(){},remove(){}};}
        set innerHTML(value){this.html=value;this.children=[];}
        get innerHTML(){return this.html||'';}
        addEventListener(type,handler){(this.handlers[type]||=[]).push(handler);}
        async emit(type){for(const handler of this.handlers[type]||[])await handler({target:this,currentTarget:this});await settle();}
        appendChild(child){this.children.push(child);}
        querySelectorAll(){return [];}
        focus(){}
    }
    const nodes=new Map(),ranges=[],inserts=[],updates=[],alerts=[];
    const node=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
    let realtime,insertError=null;
    const db={
        from(table){
            const filters=[],orders=[];
            const builder={
                select(){return this;},
                order(field,{ascending=true}={}){orders.push({field,ascending});return this;},
                eq(field,value){filters.push(row=>row[field]===value);return this;},
                neq(field,value){filters.push(row=>row[field]!==value);return this;},
                in(field,values){filters.push(row=>values.includes(row[field]));if(this.updateRecord)this.updateRecord.ids=values.slice();return this;},
                update(values){this.updateRecord={table,values};updates.push(this.updateRecord);return this;},
                insert(values){inserts.push({table,values});return Promise.resolve({error:insertError});},
                then(resolve,reject){return Promise.resolve({data:[],error:null}).then(resolve,reject);},
                single(){return Promise.resolve({data:(tables[table]||[]).filter(row=>filters.every(filter=>filter(row)))[0],error:null});},
                range(start,end){
                    ranges.push({table,start,end});
                    const rows=(tables[table]||[]).filter(row=>filters.every(filter=>filter(row))).slice();
                    rows.sort((a,b)=>{for(const {field,ascending}of orders){if(a[field]<b[field])return ascending?-1:1;if(a[field]>b[field])return ascending?1:-1;}return 0;});
                    return Promise.resolve({data:rows.slice(start,Math.min(end+1,start+2)),error:null});
                }
            };
            return builder;
        },
        channel(){return {on(_event,_filter,handler){realtime=handler;return this;},subscribe(){return this;}};},
        removeChannel(){}
    };
    const document={getElementById:node,querySelector:()=>node('modal-box'),createElement:()=>new Element(),addEventListener(){}};
    const window={SpotivityModules:{},location:{href:'https://fixture.test/'}};
    const sandbox={window,document,URL,Intl,Date,Map,Set,setTimeout,alert:message=>alerts.push(message),confirm:()=>true};
    runInNewContext(source('security.js'),sandbox);
    const state={account:{is_super:true,user_id:'admin'},authGeneration:1,programGeneration:0};
    const context={db,state,modalNodes:()=>[],captureContext:()=>()=>!!state.account};
    return {window,node,context,ranges,inserts,updates,alerts,
        load:name=>runInNewContext(source(name),sandbox),
        realtime:payload=>realtime(payload),setInsertError:error=>{insertError=error;}};
}

test('large admin conversations acknowledge all unread messages without oversized REST requests',async()=>{
    const messages=Array.from({length:1003},(_,index)=>({id:index+1,email_client:'alice@example.test',teren:'Court A',
        expeditor:'client',mesaj:`message ${index+1}`,citit:false,created_at:'2026-11-03T12:00:00Z'}));
    const f=fixture({mesaje_chat:messages,clienti:[]});
    f.load('modules/admin-chat.js');
    const chat=f.window.SpotivityModules.adminChat(f.context);
    await chat.initializeRealtime();
    f.window.deschideChatDinTabel('alice@example.test','Court A','Alice');
    await settle();await settle();
    const updates=f.updates.filter(update=>update.table==='mesaje_chat'&&update.values.citit===true);
    assert.ok(updates.length>1);
    assert.ok(updates.every(update=>update.ids.length<=100));
    assert.deepEqual(Array.from(new Set(updates.flatMap(update=>Array.from(update.ids)))).sort((a,b)=>a-b),messages.map(message=>message.id));
});

test('administrator chat reads beyond a capped page and retains separate drafts through realtime refresh and navigation',async()=>{
    const messages=Array.from({length:5},(_,index)=>({id:index+1,email_client:index===4?'bob@example.test':'alice@example.test',teren:'Court A',
        expeditor:'client',mesaj:`message ${index+1}`,citit:true,created_at:`2026-11-03T12:0${index}:00Z`}));
    const f=fixture({mesaje_chat:messages,clienti:[{email:'alice@example.test',nume:'Alice'},{email:'bob@example.test',nume:'Bob'}]});
    f.load('modules/admin-chat.js');
    const chat=f.window.SpotivityModules.adminChat(f.context);
    await chat.initializeRealtime();
    f.window.deschideChatDinTabel('alice@example.test','Court A','Alice');await settle();
    f.node('chat-admin-input').value='draft Alice.';await f.node('chat-admin-input').emit('input');
    f.realtime({new:{teren:'Other court',expeditor:'client',citit:false}});await settle();
    assert.equal(f.node('chat-admin-input').value,'draft Alice.');
    assert.ok(f.node('chat-admin-lista-conversații').children.some(card=>card.innerHTML.includes('message 5')),'Newest conversation is loaded beyond the REST cap');
    assert.ok(f.ranges.some(page=>page.table==='mesaje_chat'&&page.start===4));
    f.window.deschideChatDinTabel('bob@example.test','Court A','Bob');await settle();
    assert.equal(f.node('chat-admin-input').value,'');
    f.node('chat-admin-input').value='draft Bob';await f.node('chat-admin-input').emit('input');
    f.window.deschideChatDinTabel('alice@example.test','Court A','Alice');await settle();
    assert.equal(f.node('chat-admin-input').value,'draft Alice.');
    f.setInsertError({message:'temporary failure'});await f.node('chat-admin-btn-trimite').emit('click');
    assert.equal(f.node('chat-admin-input').value,'draft Alice.','Failed send keeps the draft');
    f.setInsertError(null);await f.node('chat-admin-btn-trimite').emit('click');
    assert.equal(f.inserts.at(-1).values[0].mesaj,'draft Alice.','Sentence punctuation is preserved');
    assert.equal(f.node('chat-admin-input').value,'','Successful send clears only this draft');
    f.window.deschideChatDinTabel('bob@example.test','Court A','Bob');await settle();
    assert.equal(f.node('chat-admin-input').value,'draft Bob');
    chat.clearState({preserveDrafts:true,retainedCourts:['Court A']});
    f.node('chat-admin-input').value='';
    f.window.deschideChatDinTabel('bob@example.test','Court A','Bob');await settle();
    assert.equal(f.node('chat-admin-input').value,'draft Bob','Verified same-user refresh retains authorized drafts');
    chat.clearState({preserveDrafts:true,retainedCourts:['Other court']});
    f.node('chat-admin-input').value='';
    f.window.deschideChatDinTabel('bob@example.test','Court A','Bob');await settle();
    assert.equal(f.node('chat-admin-input').value,'','Revoking court access discards its private draft');
    f.node('chat-admin-input').value='new private draft';await f.node('chat-admin-input').emit('input');
    chat.clearState();f.node('chat-admin-input').value='';
    f.window.deschideChatDinTabel('bob@example.test','Court A','Bob');await settle();
    assert.equal(f.node('chat-admin-input').value,'','Session clear discards private drafts');
});

test('administrator history loads recent reservations beyond older capped pages',async()=>{
    const rows=Array.from({length:5},(_,index)=>({id:index+1,created_at:`2026-11-0${index+1}T12:00:00Z`,sport:'Fotbal',teren:'Court A',
        data_str:index===4?'2099-11-03':'2020-01-01',ora:'12:00',email_client:`client${index}`,stare:'activa',pret_total:'100 RON'}));
    const f=fixture({rezervari:rows,clienti:[]});f.load('modules/admin-history.js');
    f.window.SpotivityModules.adminHistory(f.context);
    await f.window.reincarcaIstoricAdmin();
    assert.ok(f.node('container-istoric').innerHTML.includes('client4'));
    assert.ok(!f.node('container-istoric').innerHTML.includes('client0'));
    assert.ok(f.ranges.some(page=>page.table==='rezervari'&&page.start===4));
});

test('occupied schedule slots require explicit cancellation before blocking and never rewrite customer identity',async()=>{
    const f=fixture({terenuri:[{id:1,nume:'Court A',ore_rezervabile:['12:00','13:00','14:00']}],rezervari:[
        {id:1,teren:'Court A',data_str:'2099-11-03',ora:'12:00',email_client:'alice@example.test',stare:'activa',pret_total:'100 RON'},
        {id:2,teren:'Court A',data_str:'2099-11-03',ora:'13:00',email_client:'Teren Blocat',stare:'activa',pret_total:'0 RON'}]});
    f.load('modules/admin-schedule.js');f.load('modules/admin-bookings.js');
    f.window.SpotivityModules.adminSchedule(f.context);f.window.SpotivityModules.adminBookings(f.context);
    f.node('tabel-teren').value='Court A';f.node('tabel-data').value='2099-11-03';
    await f.window.incarcaTabelProgram();
    const html=f.node('tabel-corp-program').innerHTML;
    const occupied=html.split('<tr data-ora="12:00"')[1].split('</tr>')[0];
    const blocked=html.split('<tr data-ora="13:00"')[1].split('</tr>')[0];
    const free=html.split('<tr data-ora="14:00"')[1].split('</tr>')[0];
    assert.ok(!occupied.includes('value="blocat"'));
    assert.ok(blocked.includes('value="blocat" selected'));
    assert.ok(free.includes('value="blocat"'));
    await f.window.schimbaStareExistenta({value:'blocat'},1,'12:00','Court A','2099-11-03');await settle();
    assert.equal(f.updates.length,0,'No customer email or booking is changed by an invalid transition');
    assert.match(f.alerts[0],/anulează mai întâi/);
});
