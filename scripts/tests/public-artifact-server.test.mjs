import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {request} from 'node:http';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {servePublicArtifact,parseRedirects}=require('../../Idee Site/supabase/tests/public-artifact-server.cjs');

async function fixture(t,options={}){
  const temporary=await mkdtemp(join(tmpdir(),'spotivity-route-server-'));
  t.after(()=>rm(temporary,{recursive:true,force:true}));
  const directory=join(temporary,'public');
  for(const [relative,content] of Object.entries({
    'index.html':'Home',
    'terenuri/fotbal/index.html':'Fotbal',
    'css/main.css':'body{}',
    'robots.txt':'User-agent: *\nAllow: /\n',
    'sitemap.xml':'<?xml version="1.0"?><urlset/>',
    '_headers':'/*\n  X-Content-Type-Options: nosniff\n/terenuri/*\n  Cache-Control: no-cache\n',
    '.hidden':'private',
  })){
    const location=join(directory,relative);await mkdir(dirname(location),{recursive:true});await writeFile(location,content);
  }
  await writeFile(join(temporary,'outside.txt'),'private outside');
  await symlink(join(temporary,'outside.txt'),join(directory,'escape.txt'));
  const {redirects,...serverOptions}=options;
  if(redirects)await writeFile(join(directory,'_redirects'),redirects);
  const site=await servePublicArtifact({directory,...serverOptions});
  t.after(()=>site.close());
  return site;
}

test('reviewed Netlify aliases force one-hop301 and preserve query; Pages keeps native static behavior',async t=>{
  const redirects='/terenuri/fotbal/old-1/ /terenuri/tenis/current-1/ 301!\n/terenuri/fotbal/old-1 /terenuri/tenis/current-1/ 301!\n';
  const site=await fixture(t,{redirects,prefix:'/Site/Idee%20Site/'});
  for(const route of ['terenuri/fotbal/old-1/','terenuri/fotbal/old-1']){
    const response=await fetch(site.url+route+'?code=fixture',{redirect:'manual'});
    assert.equal(response.status,301);assert.equal(response.headers.get('location'),'/Site/Idee%20Site/terenuri/tenis/current-1/?code=fixture');
  }
  assert.equal((await fetch(site.url+'_redirects')).status,404);
  const pages=await fixture(t,{redirects,applyHeaders:false});
  assert.equal((await fetch(pages.url+'terenuri/fotbal/old-1/',{redirect:'manual'})).status,404);
  for(const value of ['/terenuri/fotbal/x-1/ https://evil.example/ 301!', '/private/ /terenuri/fotbal/x-1/ 301!', '/terenuri/fotbal/x-1/ /terenuri/fotbal/y-1/ 302'])assert.throws(()=>parseRedirects(value),/Invalid/);
});

function rawRequest(base,path,method='GET'){
  return new Promise((resolve,reject)=>{
    const parsed=new URL(base);
    const req=request({hostname:parsed.hostname,port:parsed.port,path,method},res=>{
      let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));
    });req.once('error',reject);req.end();
  });
}

test('artifact serves directory indexes and redirects missing slash with query intact',async t=>{
  const site=await fixture(t);
  assert.equal(await (await fetch(site.url)).text(),'Home');
  const nested=await fetch(new URL('terenuri/fotbal/',site.url));
  assert.equal(nested.status,200);assert.equal(await nested.text(),'Fotbal');
  assert.equal(nested.headers.get('content-type'),'text/html; charset=utf-8');
  assert.equal(nested.headers.get('cache-control'),'no-cache');
  assert.equal(nested.headers.get('x-content-type-options'),'nosniff');
  const redirect=await fetch(new URL('terenuri/fotbal?baza=1',site.url),{redirect:'manual'});
  assert.equal(redirect.status,301);assert.equal(redirect.headers.get('location'),'/terenuri/fotbal/?baza=1');
  const head=await fetch(new URL('terenuri/fotbal/',site.url),{method:'HEAD'});
  assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),'6');assert.equal(await head.text(),'');
});

test('artifact can mount under encoded Pages prefix with artifact-relative headers',async t=>{
  const site=await fixture(t,{mountPath:'/Site/Idee%20Site/'});
  assert.ok(site.url.endsWith('/Site/Idee%20Site/'));
  assert.equal(await (await fetch(site.url)).text(),'Home');
  const nested=await fetch(new URL('terenuri/fotbal/',site.url));
  assert.equal(nested.status,200);assert.equal(nested.headers.get('cache-control'),'no-cache');
  const origin=new URL(site.url).origin;
  assert.equal((await fetch(origin+'/')).status,404);
  assert.equal((await fetch(origin+'/terenuri/fotbal/')).status,404);
  const mountRedirect=await fetch(origin+'/Site/Idee%20Site?x=1',{redirect:'manual'});
  assert.equal(mountRedirect.status,301);assert.equal(mountRedirect.headers.get('location'),'/Site/Idee%20Site/?x=1');
  const nestedRedirect=await fetch(new URL('terenuri/fotbal?x=1',site.url),{redirect:'manual'});
  assert.equal(nestedRedirect.headers.get('location'),'/Site/Idee%20Site/terenuri/fotbal/?x=1');
});

test('artifact refuses private paths and symlink escapes and uses correct SEO MIME types',async t=>{
  const site=await fixture(t);
  for(const path of ['/_headers','/.hidden','/escape.txt','/%2f..%2foutside.txt','/terenuri/%2e%2e/_headers','/%00','/%ZZ']){
    assert.equal((await rawRequest(site.url,path)).status,404,path);
  }
  assert.equal((await rawRequest(site.url,'/','POST')).status,405);
  assert.equal((await fetch(new URL('robots.txt',site.url))).headers.get('content-type'),'text/plain; charset=utf-8');
  assert.equal((await fetch(new URL('sitemap.xml',site.url))).headers.get('content-type'),'application/xml; charset=utf-8');
});

test('artifact validates mount path and can omit Netlify headers for Pages tests',async t=>{
  const site=await fixture(t,{applyHeaders:false});
  assert.equal((await fetch(site.url)).headers.get('x-content-type-options'),null);
  for(const mountPath of ['Site/','/../','/%2e%2e/','/Site/?query=1','/Site/#hash','/Site\\/','/%00/']){
    await assert.rejects(servePublicArtifact({directory:'/not-needed',mountPath}),/Invalid public artifact prefix/,mountPath);
  }
});
