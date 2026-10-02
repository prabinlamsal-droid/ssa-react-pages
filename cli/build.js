import {build,createServer} from 'vite';
import {viteSingleFile} from 'vite-plugin-singlefile';
import {mkdtemp,readFile,writeFile,mkdir,readdir,rename,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadConfig} from './config.js';
import {copyHtml} from './copy.js';
import {arcBridge,artifactAudit} from '../vite/plugin.js';
import {validateHtml} from '../vite/audit.js';
function viteConfig(config,target,development={}) {
 const generated={configFile:false,root:config.root,base:'./',publicDir:false,resolve:{dedupe:['react','react-dom']},
 plugins:[arcBridge({target,appId:config.appId,contract:config.contract,development,devPath:config.devPath,devOnly:(config.devOnly ?? []).map(p=>resolve(config.root,p))}),
 ...(config.plugins ?? []),...(target==='mobile'?[viteSingleFile(),artifactAudit(config.appId)]:[])],
 build:{modulePreload:false,sourcemap:false,assetsInlineLimit:()=>true,
 rollupOptions:{input:config.entry}},server:{host:'127.0.0.1',port:config.port ?? 5173,strictPort:true}};
 generated.plugins.push({name:'arcbridge:protected-config',enforce:'post',configResolved(resolved){
   if(resolved.root!==config.root || resolved.base!==(target==='mobile'?'./':'/') || resolved.publicDir!=='' ||
    (target==='mobile' && (resolved.build.sourcemap!==false || resolved.build.rollupOptions.input!==config.entry || resolved.build.outDir!==generated.build.outDir)))throw new Error('Application plugin changed protected ArcBridge build configuration (root/input/output/sourcemaps).');
 }});
 return generated;
}
export async function buildMobile({root,copy=false,flutterAssets}={}) {
 const config=await loadConfig(root);
 await mkdir(config.outputDirectory,{recursive:true});
 const staging=await mkdtemp(join(config.outputDirectory,'.arcbridge-build-'));
 try {
  const vite=viteConfig(config,'mobile'); vite.build.outDir=staging;vite.build.emptyOutDir=false;
  await build(vite);
  if((await readdir(staging)).join()!=='index.html')throw new Error('Unexpected build artifacts.');
  const html=validateHtml(await readFile(join(staging,'index.html'),'utf8'),config.appId);
  // Only current validated bytes can reach Flutter; never read a stale dist file.
  let destination;
  if(copy) destination=await copyHtml({html,appId:config.appId,assetDirectory:flutterAssets?resolve(config.root,flutterAssets):config.flutter?.assetDirectory?resolve(config.root,config.flutter.assetDirectory):undefined});
  await rename(join(staging,'index.html'),join(config.outputDirectory,config.outputFile));
  return {output:join(config.outputDirectory,config.outputFile),destination};
 }finally{await rm(staging,{recursive:true,force:true});}
}
export async function startDevelopment({root}={}) {
 const config=await loadConfig(root);
 let development;
 try {development=(await import(pathToFileURL(config.devPath).href+'?time='+Date.now())).default;}
 catch(error){throw new Error('Browser development config could not load: '+config.devPath,{cause:error});}
 const vite=viteConfig(config,'browser',development);
 vite.server.proxy=development.proxy ?? {};
 const server=await createServer(vite);await server.listen();server.printUrls();return server;
}
export async function validateMobile({root}={}) {
 const config=await loadConfig(root);
 validateHtml(await readFile(join(config.outputDirectory,config.outputFile),'utf8'),config.appId);
 return join(config.outputDirectory,config.outputFile);
}
