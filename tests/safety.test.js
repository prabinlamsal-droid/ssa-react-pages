import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,symlink,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {sealHtml,validateHtml} from '../vite/audit.js';
import {loadConfig} from '../cli/config.js';
import {buildMobile} from '../cli/build.js';
test('artifact validation rejects relaxed network CSP even if none is also present',()=>{
 const html=sealHtml('<html><head></head><body><script>globalThis.test=1;</script></body></html>','safety');
 assert.throws(()=>validateHtml(html.replace("connect-src 'none'","connect-src 'none' https://evil.test"),'safety'),/CSP|policy/i);
});
test('custom plugins cannot enable production sourcemaps',async()=>{
 const root=await mkdtemp(join(tmpdir(),'arcbridge-plugin-'));
 await writeFile(join(root,'package.json'),'{}');
 await writeFile(join(root,'index.html'),'<html><head></head><body></body></html>');
 await writeFile(join(root,'arcbridge.config.mjs'),"export default {appId:'safe',plugins:[{name:'override',config(){return {build:{sourcemap:true}};}}]};");
 await writeFile(join(root,'arcbridge.contract.json'),'\{"version":1,"shelf":{},"endpoints":{}\}');
 await assert.rejects(buildMobile({root}),/protected|sourcemap/i);
});
test('output symlinks cannot write outside consumer root',async()=>{
 const root=await mkdtemp(join(tmpdir(),'arcbridge-symlink-'));
 const outside=await mkdtemp(join(tmpdir(),'arcbridge-outside-'));
 await writeFile(join(root,'package.json'),'{}');
 await writeFile(join(root,'index.html'),'<html></html>');
 await writeFile(join(root,'arcbridge.config.mjs'),"export default {appId:'safe'};");
 await writeFile(join(root,'arcbridge.contract.json'),'{"version":1,"shelf":{},"endpoints":{}}');
 await symlink(outside,join(root,'dist'),'dir');
 await assert.rejects(loadConfig(root),/Output|output/);
});
