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
function parseRedirects(source){
  const routes=new Map(),safe=/^\/(?:terenuri|teren|baze-sportive)\/[a-z0-9/-]+\/?$/;
  // Non-forced 200 rewrites to the app shell, which Netlify applies only when
  // no file exists at the requested path.
  routes.rewrites=[];
  for(const line of source.split(/\r?\n/)){
    if(!line.trim()||line.trimStart().startsWith('#'))continue;
    const rewrite=line.trim().match(/^(\/(?:terenuri|teren|baze-sportive)(?:\/:[a-z]+)+)\s+\/app\.html\s+200$/);
    if(rewrite){routes.rewrites.push(new RegExp('^'+rewrite[1].replace(/:[a-z]+/g,'[^/]+')+'/?$'));continue;}
    const match=line.trim().match(/^(\S+)\s+(\S+)\s+301!$/);
    if(!match||!safe.test(match[1])||!safe.test(match[2])||routes.has(match[1]))throw new Error('Invalid reviewed alias redirect');
    routes.set(match[1],match[2]);
  }
  return routes;
}
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.json':'application/json','.xml':'application/xml; charset=utf-8','.txt':'text/plain; charset=utf-8',
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp',
  '.avif':'image/avif','.gif':'image/gif','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2'};

async function servePublicArtifact({directory,port=0,applyHeaders=true,mountPath='/',prefix=mountPath}={}){
  if(!directory)throw new Error('A built artifact directory is required');
  // A second mounted server exercises GitHub Pages' subdirectory hosting while
  // serving exactly the same reviewed artifact as the root Netlify fixture.
  if(typeof prefix!=='string'||!prefix.startsWith('/')||/[?#\\\u0000-\u001f\u007f]/.test(prefix))throw new Error('Invalid public artifact prefix');
  const mount=decodeURIComponent(prefix).replace(/\/?$/,'/');
  if(mount.split('/').some(part=>part==='.'||part==='..')||/[\\\u0000-\u001f\u007f]/.test(mount))throw new Error('Invalid public artifact prefix');
  const encodedMount=mount.split('/').map(encodeURIComponent).join('/');
  const root=await realpath(directory);
  const rules=applyHeaders?parseHeaders(await readFile(resolve(root,'_headers'),'utf8')):[];
  let redirects=new Map();
  if(applyHeaders){
    try{redirects=parseRedirects(await readFile(resolve(root,'_redirects'),'utf8'));}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const server=createServer(async(req,res)=>{
    let pathname='/';
    try{
      const requested=new URL(req.url,'http://127.0.0.1');
      pathname=decodeURIComponent(requested.pathname);
      if(mount!=='/'&&pathname===mount.slice(0,-1)){
        res.writeHead(301,{location:encodedMount+requested.search});res.end();return;
      }
      if(!pathname.startsWith(mount))throw new Error('Outside public artifact prefix');
      pathname='/'+pathname.slice(mount.length);
      for(const rule of rules)if(rule.match.test(pathname))for(const [name,value]of Object.entries(rule.headers))res.setHeader(name,value);
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
      if(redirects.has(pathname)){
        res.writeHead(301,{location:encodedMount.slice(0,-1)+redirects.get(pathname)+requested.search});res.end();return;
      }
      const parts=pathname.split('/');
      // Netlify consumes _headers itself; it is not a published document.
      if(parts.some(part=>part.startsWith('.')||part==='_headers'||part==='_redirects')||/[\\\u0000-\u001f\u007f]/.test(pathname))throw new Error('Not public');
      let target=resolve(root,'.'+pathname);
      if(redirects.rewrites?.some(rule=>rule.test(pathname))){
        // Like Netlify: a real page (file or directory index) wins over the rewrite.
        const page=await stat(target).then(info=>info.isDirectory()?stat(resolve(target,'index.html')).then(()=>true,()=>false):true,()=>false);
        if(!page)target=resolve(root,'app.html');
      }
      let path=await realpath(target),rel=relative(root,path);
      if(rel.startsWith('..'+sep)||rel==='..')throw new Error('Not a public file');
      let info=await stat(path);
      if(info.isDirectory()){
        if(!pathname.endsWith('/')){
          res.writeHead(301,{location:requested.pathname+'/'+requested.search});res.end();return;
        }
        path=await realpath(resolve(path,'index.html'));rel=relative(root,path);info=await stat(path);
      }
      if(rel.startsWith('..'+sep)||rel==='..'||!info.isFile())throw new Error('Not a public file');
      const bytes=await readFile(path);res.writeHead(200,{'content-type':types[extname(path).toLowerCase()]||'application/octet-stream','content-length':bytes.length});
      res.end(req.method==='HEAD'?undefined:bytes);
    }catch{
      res.writeHead(404,{'content-type':'text/plain; charset=utf-8'});res.end(req.method==='HEAD'?undefined:'Not found');
    }
  });
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',done);});
  return {url:`http://127.0.0.1:${server.address().port}${encodedMount}`,server,close:()=>new Promise((done,reject)=>server.close(error=>error?reject(error):done()))};
}

module.exports={servePublicArtifact,parseHeaders,parseRedirects};
if(require.main===module){
  servePublicArtifact({directory:process.env.PUBLIC_BUILD_DIR||process.argv[2],port:Number(process.env.PORT||0)})
    .then(({url})=>process.stdout.write(url+'\n')).catch(error=>{console.error(error.message);process.exitCode=1;});
}
