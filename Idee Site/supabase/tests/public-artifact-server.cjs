// Test-only static server for the built Netlify artifact. It applies the
// generated _headers rules to real HTTP responses; no source checkout is served.
const {createServer}=require('node:http');
const {readFile,stat,realpath}=require('node:fs/promises');
const {resolve,relative,sep,extname}=require('node:path');

function parseHeaders(source){
  const rules=[];let current;
  for(const line of source.split(/\r?\n/)){
    if(!line.trim()||line.trimStart().startsWith('#'))continue;
    if(!/^\s/.test(line)){
      const pattern=line.trim();
      if(!pattern.startsWith('/'))throw new Error('Invalid Netlify header pattern');
      const expression=pattern.split('*').map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*');
      current={match:new RegExp('^'+expression+'$'),headers:{}};rules.push(current);
    }else{
      if(!current)throw new Error('Header without a Netlify path rule');
      const match=line.trim().match(/^([^:]+):\s*(.*)$/);
      if(!match)throw new Error('Invalid Netlify header');
      current.headers[match[1].toLowerCase()]=match[2];
    }
  }
  return rules;
}
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp',
  '.avif':'image/avif','.gif':'image/gif','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2'};

async function servePublicArtifact({directory,port=0,applyHeaders=true}={}){
  if(!directory)throw new Error('A built artifact directory is required');
  const root=await realpath(directory);
  const rules=applyHeaders?parseHeaders(await readFile(resolve(root,'_headers'),'utf8')):[];
  const server=createServer(async(req,res)=>{
    let pathname='/';
    try{
      pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
      for(const rule of rules)if(rule.match.test(pathname))for(const [name,value]of Object.entries(rule.headers))res.setHeader(name,value);
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
      const parts=pathname.split('/');
      // Netlify consumes _headers itself; it is not a published document.
      if(parts.some(part=>part.startsWith('.')||part==='_headers'))throw new Error('Not public');
      const target=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
      const path=await realpath(target),rel=relative(root,path);
      if(rel.startsWith('..'+sep)||rel==='..'||!await stat(path).then(info=>info.isFile()))throw new Error('Not a public file');
      const bytes=await readFile(path);res.writeHead(200,{'content-type':types[extname(path).toLowerCase()]||'application/octet-stream','content-length':bytes.length});
      res.end(req.method==='HEAD'?undefined:bytes);
    }catch{
      res.writeHead(404,{'content-type':'text/plain; charset=utf-8'});res.end(req.method==='HEAD'?undefined:'Not found');
    }
  });
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',done);});
  return {url:`http://127.0.0.1:${server.address().port}/`,server,close:()=>new Promise((done,reject)=>server.close(error=>error?reject(error):done()))};
}

module.exports={servePublicArtifact,parseHeaders};
if(require.main===module){
  servePublicArtifact({directory:process.env.PUBLIC_BUILD_DIR||process.argv[2],port:Number(process.env.PORT||0)})
    .then(({url})=>process.stdout.write(url+'\n')).catch(error=>{console.error(error.message);process.exitCode=1;});
}
