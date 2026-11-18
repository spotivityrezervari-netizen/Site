// js/image-compress.js in a real browser, with no network: large photos are
// shrunk to WebP within 1920 px, small ones and GIFs stay exactly as chosen,
// and anything that cannot be decoded is returned unchanged.
const {chromium}=require('playwright');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const assert=require('node:assert/strict');
const root=join(__dirname,'../..');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true});
 let passed=0;const pass=name=>{passed++;console.log('PASS',name);};
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.abort());
  await page.setContent('<!doctype html><meta charset="utf-8"><title>image-compress</title>');
  await page.addScriptTag({content:readFileSync(join(root,'js/image-compress.js'),'utf8')});
  const toPage=(buffer,name,type)=>({b64:buffer.toString('base64'),name,type});
  const shrink=input=>page.evaluate(async({b64,name,type})=>{
   const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));const file=new File([bytes],name,{type});
   const out=await window.spotivityShrinkImage(file);
   let width=0,height=0;try{const bitmap=await createImageBitmap(out);width=bitmap.width;height=bitmap.height;bitmap.close();}catch{}
   return {same:out===file,name:out.name,type:out.type,size:out.size,inSize:file.size,width,height};
  },input);

  const small=readFileSync(join(__dirname,'fixtures','photo-256.png'));
  const r1=await shrink(toPage(small,'mic.png','image/png'));
  assert.equal(r1.same,true,'A small photo within the size limit is uploaded exactly as chosen');
  pass('a small photo below 400 KB and 1920 px stays byte-identical');

  const medium=readFileSync(join(root,'assets/imagini/avatar2.png'));
  assert.ok(medium.length>400*1024,'fixture precondition: avatar2.png is above the keep threshold');
  const r2=await shrink(toPage(medium,'avatar.png','image/png'));
  assert.equal(r2.same,false);assert.equal(r2.type,'image/webp');assert.equal(r2.name,'avatar.webp');
  assert.ok(r2.size<r2.inSize,'The shrunk photo is lighter than the original');
  assert.equal(r2.width,512);assert.equal(r2.height,512);
  pass('a heavy 512 px PNG is re-encoded to a lighter WebP with the same dimensions and a matching file name');

  const large=await page.evaluate(async()=>{
   const canvas=document.createElement('canvas');canvas.width=4000;canvas.height=3000;const context=canvas.getContext('2d');
   for(let i=0;i<400;i++){context.fillStyle=`hsl(${i*37%360} 70% ${30+i%40}%)`;context.fillRect((i*97)%4000,(i*53)%3000,180,140);}
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
   const out=await window.spotivityShrinkImage(new File([blob],'camera.png',{type:'image/png'}));
   const bitmap=await createImageBitmap(out);const result={type:out.type,width:bitmap.width,height:bitmap.height,smaller:out.size<blob.size};bitmap.close();return result;
  });
  assert.deepEqual(large,{type:'image/webp',width:1920,height:1440,smaller:true});
  pass('a 4000×3000 camera photo is limited to 1920 px on the longest side, keeping its aspect ratio');

  const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
  const r3=await shrink(toPage(gif,'animatie.gif','image/gif'));
  assert.equal(r3.same,true);
  pass('GIFs are never re-encoded, because they may be animated');

  const broken=await shrink(toPage(Buffer.from('not an image'),'stricat.png','image/png'));
  assert.equal(broken.same,true);
  const other=await shrink(toPage(Buffer.from('%PDF-1.4'),'document.pdf','application/pdf'));
  assert.equal(other.same,true);
  pass('undecodable or non-image files are returned unchanged for the existing validation to reject');

  assert.deepEqual(errors,[]);
  console.log(`${passed} image-compress checks passed`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
