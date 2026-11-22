// Real static rename/move aliases on Pages and future Netlify, with no hosted calls.
const {chromium}=require('playwright');
const {mkdtemp,mkdir,writeFile,readFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join,dirname}=require('node:path');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const {servePublicArtifact}=require('./public-artifact-server.cjs');
(async()=>{
 const repo=join(__dirname,'../../..');
 const {SPORTS,SEO_PATHS,PAGES_BASE_URL}=await import(pathToFileURL(join(repo,'scripts/seo-pages.mjs')).href);
 const {generateSourcePages}=await import(pathToFileURL(join(repo,'scripts/generate-seo-pages.mjs')).href);
 const {buildPublic}=await import(pathToFileURL(join(repo,'scripts/build-public.mjs')).href);
 const paths=require('../../js/entity-paths.js'),seo=require('../../js/seo-data.js');
 const temporary=await mkdtemp(join(tmpdir(),'spotivity-alias-browser-')),servers=[];
 let browser;
 const put=async(file,value)=>{await mkdir(dirname(join(temporary,file)),{recursive:true});await writeFile(join(temporary,file),value);};
 const base={id:'00000000-0000-0000-0000-000000000001',nume:'Baza Veche',oras:'Reghin',descriere:null};
 const court={id:1,nume:'Teren Vechi',sport:'Fotbal',oras:'Reghin',pret:100,baza_sportiva_id:base.id};
 const catalog={version:2,refreshedAt:'2026-11-14T00:00:00.000Z',courts:[court],bases:[base]};
 const template='<!doctype html><html lang="ro"><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; base-uri \'none\'; script-src \'self\'"><meta name="referrer" content="no-referrer"><title>Spotivity</title><meta name="description" content="Public"><meta property="og:title" content="Public"><meta property="og:description" content="Public"><meta property="og:url" content="'+PAGES_BASE_URL+'"><meta property="og:image" content="'+PAGES_BASE_URL+'assets/imagini/avatar2.png"><link rel="canonical" href="'+PAGES_BASE_URL+'">'+seo.script(seo.graphFor({baseUrl:PAGES_BASE_URL,kind:'home'}))+'</head><body><a id="home-brand" href="#top">Acasă</a><main><section data-home-intro><h1>Rezervări</h1></section>'+SPORTS.map(s=>'<section data-home-sport="'+s.sport+'"><div class="home-sport-heading"><h2>'+s.sport+'</h2></div><button class="card-sport" data-sport="'+s.sport+'">Rezervă</button><div data-home-courts="'+s.sport+'"></div></section>').join('')+'</main></body></html>';
 try{
  await put('Idee Site/index.html',template);await put('scripts/seo-public-catalog.json',JSON.stringify(catalog));
  await put('scripts/public-files.json',JSON.stringify({version:1,files:['index.html',...SEO_PATHS]}));
  await put('deploy/netlify/_headers',"/*\n  X-Content-Type-Options: nosniff\n");
  const oldCourt=paths.courtPath(court,base),oldBase=paths.basePath(base);
  await generateSourcePages({repoRoot:temporary});
  court.nume='Nume Intermediar';base.nume='Bază Intermediară';await put('scripts/seo-public-catalog.json',JSON.stringify(catalog));await generateSourcePages({repoRoot:temporary});
  const middleCourt=paths.courtPath(court,base);
  court.nume='Teren Actual';court.oras='Cluj-Napoca';court.sport='Tenis';base.nume='Baza Actuală';base.oras='Cluj-Napoca';
  await put('scripts/seo-public-catalog.json',JSON.stringify(catalog));await generateSourcePages({repoRoot:temporary});await generateSourcePages({repoRoot:temporary,check:true});await buildPublic({repoRoot:temporary});
  const currentCourt=paths.courtPath(court,base),currentBase=paths.basePath(base);
  const pages=await servePublicArtifact({directory:join(temporary,'Idee Site'),prefix:'/Site/Idee%20Site/',applyHeaders:false});servers.push(pages);
  const production=await servePublicArtifact({directory:join(temporary,'dist')});servers.push(production);
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true});
  const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  for(const host of[pages,production])for(const[old,current]of[[oldCourt,currentCourt],[middleCourt,currentCourt],[oldBase,currentBase]]){
   const intent='?code=fixture-recovery#access_token=fixture&type=recovery';
   await page.goto(host.url);await page.goto(host.url+old+intent);await page.waitForURL(host.url+current+intent);
   assert.equal(await page.locator('h1').count(),1);assert.ok(!(await page.locator('meta[name="robots"]').count()),'Current page is indexable');
   await page.goBack();await page.waitForURL(host.url);
  }
  const without=await browser.newContext({javaScriptEnabled:false}),plain=await without.newPage();
  const response=await plain.goto(pages.url+oldCourt);assert.equal(response.status(),200);
  assert.equal(await plain.locator('meta[name="robots"]').getAttribute('content'),'noindex,follow');
  assert.equal(await plain.locator('link[rel="canonical"]').getAttribute('href'),PAGES_BASE_URL+currentCourt);
  await plain.locator('#seo-alias-destination').click();await plain.waitForURL(pages.url+currentCourt);assert.match(await plain.locator('h1').innerText(),/Teren Actual/);
  const redirect=await fetch(production.url+oldCourt+'?intent=fixture',{redirect:'manual'});assert.equal(redirect.status,301);assert.equal(redirect.headers.get('location'),'/'+currentCourt+'?intent=fixture');
  await put('scripts/seo-public-catalog.json',JSON.stringify({...catalog,courts:[],bases:[]}));await generateSourcePages({repoRoot:temporary});await buildPublic({repoRoot:temporary});
  // The fixture loads deployment rules when its server starts. A real publish
  // replaces those rules with the rebuilt artifact, including removed redirects.
  await pages.close();await production.close();servers.length=0;
  const retiredPages=await servePublicArtifact({directory:join(temporary,'Idee Site'),prefix:'/Site/Idee%20Site/',applyHeaders:false});servers.push(retiredPages);
  const retiredProduction=await servePublicArtifact({directory:join(temporary,'dist')});servers.push(retiredProduction);
  for(const route of[oldCourt,middleCourt,currentCourt,oldBase,currentBase])assert.equal((await fetch(retiredPages.url+route,{redirect:'manual'})).status,404,'Retired identity has no stale public page');
  // spotivity.ro answers unknown court/base addresses with the noindex app shell,
  // which rereads the ID under RLS and reports it unavailable: still no stale page.
  for(const route of[oldCourt,middleCourt,currentCourt,oldBase,currentBase]){
   const retired=await fetch(retiredProduction.url+route,{redirect:'manual'}),body=await retired.text();
   assert.equal(retired.status,200,route);assert.match(body,/<meta name="robots" content="noindex,follow">/,'Retired identity has no stale public page');
   assert.doesNotMatch(body,/Teren Actual|Teren Vechi|Teren Mijloc/,'Retired identity has no stale public page');
  }
  assert.deepEqual(errors,[]);console.log('PASS repeated rename/move aliases, one-hop301, Pages external redirect, Back history, query/hash recovery intents, JS-disabled fallback and retired404s.');
 }finally{if(browser)await browser.close();for(const server of servers)await server.close();await rm(temporary,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
