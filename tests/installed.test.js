import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const exec=promisify(execFile);
test('installed tarball CLI builds its consumer and browser dev resolves the development adapter',async()=>{
 const packageRoot=new URL('..',import.meta.url).pathname;
 const root=await mkdtemp(join(tmpdir(),'arcbridge installed '));
 const packed=JSON.parse((await exec('npm',['pack','--json','--pack-destination',root],{cwd:packageRoot})).stdout)[0].filename;
 await writeFile(join(root,'package.json'),JSON.stringify({type:'module',dependencies:{'@naasa/arcbridge':'file:'+join(root,packed)}}));
 await exec('npm',['install','--no-audit','--no-fund','--ignore-scripts'],{cwd:root});
 await writeFile(join(root,'arcbridge.config.mjs'),"import {defineConfig} from '@naasa/arcbridge/config'; export default defineConfig({appId:'installed-consumer',port:5199});");
 await writeFile(join(root,'arcbridge.contract.json'),JSON.stringify({version:1,endpoints:{},shelf:{}}));
 await writeFile(join(root,'arcbridge.dev.local.mjs'),"export default {endpoints:{marker:{url:'/DEV_SENTINEL_INSTALLED'}},proxy:{'/api':{target:'http://localhost:1',headers:{authorization:'NODE_PROXY_SECRET'}}}};");
 await writeFile(join(root,'index.html'),'<html><head></head><body>installed consumer<script type="module" src="/main.js"></script></body></html>');
 await writeFile(join(root,'main.js'),"import {bridge} from '@naasa/arcbridge'; globalThis.bridge=bridge;");
 const cli=join(root,'node_modules/@naasa/arcbridge/cli/index.js');
 await exec(process.execPath,[cli,'build','--root',root],{cwd:tmpdir()});
 const html=await readFile(join(root,'dist/index.html'),'utf8');
 assert.ok(html.includes('installed consumer'));assert.ok(html.includes('SsaNative'));
 assert.ok(!html.includes('DEV_SENTINEL_INSTALLED'));
 await exec(process.execPath,[cli,'validate','--root',root],{cwd:tmpdir()});
 const {startDevelopment}=await import('../cli/build.js');
 const server=await startDevelopment({root});
 try {
  const response=await fetch('http://127.0.0.1:5199/node_modules/@naasa/arcbridge/src/ssa.js');
  const module=await response.text();
  assert.ok(module.includes('browser-entry.js'),module);
  const entry=await (await fetch('http://127.0.0.1:5199/node_modules/@naasa/arcbridge/src/browser-entry.js')).text();
  assert.ok(entry.includes('arcbridge-browser-config'),entry);
  const configuration=await (await fetch('http://127.0.0.1:5199/@id/__x00__arcbridge-browser-config')).text();
  assert.ok(configuration.includes('DEV_SENTINEL_INSTALLED'),configuration);
  assert.ok(!configuration.includes('NODE_PROXY_SECRET'));
  await server.environments.client.depsOptimizer?.scanProcessing;
 }finally{await server.close();}
});
