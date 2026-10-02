import {readFile, realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname,basename,join} from 'node:path';
import {pathToFileURL} from 'node:url';
export const defineConfig = value => value;
export async function loadConfig(root=process.cwd()) {
 root=await realpath(resolve(root));
 await readFile(resolve(root,'package.json'),'utf8');
 const file=resolve(root,'arcbridge.config.mjs');
 const config=(await import(pathToFileURL(file).href+'?time='+Date.now())).default;
 if (!config || !/^[a-zA-Z0-9_.-]{1,80}$/.test(config.appId ?? '')) throw new Error('Configure a valid appId.');
 const outputFile=config.outputFile ?? 'index.html';
 if (outputFile !== 'index.html') throw new Error('Initial version supports outputFile index.html only.');
 const entry=await realpath(resolve(root,config.htmlEntry ?? 'index.html'));
 const inside=relative(root,entry);
 if (inside.startsWith('..') || isAbsolute(inside)) throw new Error('Entry must belong to the consumer root.');
 const contract=JSON.parse(await readFile(resolve(root,config.contractFile ?? 'arcbridge.contract.json'),'utf8'));
 if (contract.version !== 1 || typeof contract.endpoints !== 'object' || typeof contract.shelf !== 'object') throw new Error('Invalid ArcBridge contract version or definitions.');
 const outputDirectory=resolve(root,config.outputDirectory ?? 'dist');
 if (outputDirectory===root || relative(root,outputDirectory).startsWith('..')) throw new Error('Output must be a child directory of the consumer root.');
 let existing=outputDirectory;const suffix=[];
 while(true){try{existing=await realpath(existing);break;}catch(error){if(error.code!=='ENOENT')throw error;suffix.unshift(basename(existing));existing=dirname(existing);}}
 const canonicalOutput=join(existing,...suffix);
 if(canonicalOutput===root || relative(root,canonicalOutput).startsWith('..') || isAbsolute(relative(root,canonicalOutput)))throw new Error('Output symlink escapes the consumer root.');
 return {...config,root,entry,contract,outputFile,outputDirectory,
 devPath:resolve(root,config.browserDevelopmentConfig ?? 'arcbridge.dev.local.mjs')};
}
