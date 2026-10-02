#!/usr/bin/env node
import {buildMobile,startDevelopment,validateMobile} from './build.js';
const [command,...args]=process.argv.slice(2);
function value(flag) {const i=args.indexOf(flag);if(i<0)return undefined;if(!args[i+1]||args[i+1].startsWith('--'))throw new Error('Missing value for '+flag);return args[i+1];}
try {
 const options={root:value('--root'),flutterAssets:value('--flutter-assets'),copy:args.includes('--copy')};
 const known=new Set(['--root','--flutter-assets','--copy']);
 for(let i=0;i<args.length;i++){if(!known.has(args[i]))throw new Error('Unknown option '+args[i]);if(args[i]!=='--copy')i++;}
 if(command==='dev'){if(options.copy||options.flutterAssets)throw new Error('Copy options require build.');await startDevelopment(options);}
 else if(command==='build'){const result=await buildMobile(options);console.log('Built '+result.output);if(result.destination)console.log('Copied '+result.destination);}
 else if(command==='validate'){await validateMobile(options);console.log('Mobile HTML is valid.');}
 else if(command==='--help'||!command)console.log('arcbridge dev | build [--copy] [--flutter-assets PATH] | validate [--root APP]');
 else throw new Error('Unknown command '+command);
} catch(error){console.error('ArcBridge: '+error.message);process.exitCode=1;}
