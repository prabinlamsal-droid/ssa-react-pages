import {realpath,stat,readFile,copyFile,rename,mkdtemp,rm} from 'node:fs/promises';
import {resolve,dirname,basename,parse,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {validateHtml} from '../vite/audit.js';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function copyHtml({html,appId,assetDirectory,outputFile='index.html'}) {
 if(!assetDirectory) throw new Error('Configure flutter.assetDirectory or --flutter-assets.');
 const directory=await realpath(resolve(assetDirectory));
 if(directory===parse(directory).root) throw new Error('Refusing a root asset destination.');
 let ancestor=directory,flutterRoot;
 while(ancestor!==dirname(ancestor)) {
  try{await stat(join(ancestor,'pubspec.yaml'));flutterRoot=ancestor;break;}catch{}
  ancestor=dirname(ancestor);
 }
 if(!flutterRoot || !relative(flutterRoot,directory).split(/[\\/]/).includes('assets')) throw new Error('Destination must be an assets directory inside a Flutter package.');
 const destination=join(directory,outputFile);
 try {
  const previous=await readFile(destination,'utf8');
  const identity=previous.match(/name="arcbridge-app-id" content="([^"]+)"/)?.[1];
  if(identity && identity!==appId) throw new Error('Destination belongs to a different app.');
  if(!identity) throw new Error('Existing unlabelled HTML needs explicit review/migration before replacement.');
 } catch(error) {if(error.code!=='ENOENT')throw error;}
 validateHtml(html,appId);
 const staging=await mkdtemp(join(directory,'.arcbridge-copy-'));
 try {
  const temporary=join(staging,basename(outputFile));
  const {writeFile}=await import('node:fs/promises');
  await writeFile(temporary,html,'utf8');
  const staged=await readFile(temporary);
  if(digest(staged)!==digest(Buffer.from(html)))throw new Error('Copy verification failed.');
  try {
   await copyFile(destination,join(staging,'previous'));
   await rename(join(staging,'previous'),destination+'.previous');
  }catch(error){if(error.code!=='ENOENT')throw error;}
  await rename(temporary,destination);
  if(digest(await readFile(destination))!==digest(staged))throw new Error('Published HTML hash mismatch.');
  return destination;
 } finally {await rm(staging,{recursive:true,force:true});}
}
