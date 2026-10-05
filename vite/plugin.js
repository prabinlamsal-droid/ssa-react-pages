import {realpathSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,basename} from 'node:path';
import {sealHtml,validateHtml} from './audit.js';
import {resolveDevelopmentEndpoints} from '../cli/development.js';
const adapter=fileURLToPath(new URL('../src/adapter.js',import.meta.url));
const browser=fileURLToPath(new URL('../src/browser-entry.js',import.meta.url));
const browserNames=['browser.js','browser-entry.js','browser-header-profile.js'];
const browserFiles=browserNames.map(p=>fileURLToPath(new URL('../src/'+p,import.meta.url)));
const canonical=id=>{try{return realpathSync(id.split('?')[0]);}catch{return id.split('?')[0];}};
function packageModule(id, names) {
 const path=canonical(id);
 if(!names.includes(basename(path)) || basename(dirname(path))!=='src')return false;
 try{return JSON.parse(readFileSync(resolve(dirname(path),'../package.json'),'utf8')).name==='@naasa/arcbridge';}catch{return false;}
}
export function arcBridge({target='mobile',appId,contract,development={},devPath,devOnly=[]}) {
 if (!['mobile','browser'].includes(target)) throw new Error('Unsupported adapter target.');
 const endpoints=target==='browser'?resolveDevelopmentEndpoints(development):{};
 const denied=[...browserFiles,...devOnly,...(devPath?[devPath]:[])].map(canonical);
 return {
 name:'arcbridge:adapter-and-audit',enforce:'pre',
 config(){return target==='browser'?{optimizeDeps:{exclude:['@naasa/arcbridge']}}:{};},
 async resolveId(source,importer) {
   if(source==='virtual:arcbridge-browser-config') {
     if(target!=='browser')this.error('Mobile build imports a development module.');
     return '\0arcbridge-browser-config';
   }
   if (!importer || !source.endsWith('adapter.js')) return null;
   const result=await this.resolve(source,importer,{skipSelf:true});
   if(result && packageModule(result.id,['adapter.js'])) return target==='browser'?resolve(dirname(canonical(result.id)),'browser-entry.js'):result.id;
   return null;
 },
 load(id) {
   if(id==='\0arcbridge-browser-config')return 'export default '+JSON.stringify({appId,contract,development:{endpoints,httpTimeoutMs:development.httpTimeoutMs}})+';';
 },
 transform(_code,id) {
   if(target==='mobile' && (denied.includes(canonical(id)) || packageModule(id,browserNames))) this.error('Mobile build imports a development module: '+id);
 },
 };
}
export function artifactAudit(appId) {
 return {
 name:'arcbridge:final-artifact',enforce:'post',apply:'build',
 generateBundle:{order:'post',handler(_options,bundle){
  const entries=Object.values(bundle);
  if(entries.length!==1 || entries[0].type!=='asset' || entries[0].fileName!=='index.html') this.error('Expected exactly one self-contained index.html, with no chunks or public assets.');
  const html=sealHtml(String(entries[0].source),appId);
  validateHtml(html,appId); entries[0].source=html;
 }},
 };
}
