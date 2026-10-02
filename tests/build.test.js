import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
async function fixture(appId) {
 const root=await mkdtemp(join(tmpdir(),'arcbridge-consumer-'));
 await writeFile(join(root,'package.json'),'{"type":"module"}');
 await writeFile(join(root,'arcbridge.config.mjs'),'export default '+JSON.stringify({appId,contractFile:'./contract.json',browserDevelopmentConfig:'./dev.mjs'})+';');
 await writeFile(join(root,'contract.json'),JSON.stringify({version:1,shelf:{},endpoints:{}}));
 await writeFile(join(root,'dev.mjs'),"throw new Error('DEV_SECRET_SENTINEL');");
 await writeFile(join(root,'index.html'),'<html><head></head><body><h1>'+appId+'</h1><script type="module" src="/main.js"></script></body></html>');
 const sdk=new URL('../src/index.js',import.meta.url).pathname;
 await writeFile(join(root,'main.js'),"import {bridge} from "+JSON.stringify(sdk)+"; globalThis.demo=bridge;");
 return root;
}
test('mobile build compiles the caller without loading dev config, writes CSP, and never implicitly copies',async()=>{
 const {buildMobile}=await import('../cli/build.js');
 for (const id of ['first-app','second-app']) {
  const root=await fixture(id); await buildMobile({root});
  const html=await readFile(join(root,'dist/index.html'),'utf8');
  assert.ok(html.includes('<h1>'+id+'</h1>'));
  assert.ok(html.includes("connect-src 'none'"));
  assert.ok(!html.includes('DEV_SECRET_SENTINEL'));
  assert.ok(!html.includes('Development-only module'));
  assert.ok(html.includes('SsaNative'));
 }
});
test('mobile graph rejects even transitive development adapter imports',async()=>{
 const {buildMobile}=await import('../cli/build.js');
 const root=await fixture('bad-app');
 const browser=new URL('../src/browser.js',import.meta.url).pathname;
 await writeFile(join(root,'main.js'),'import "./transitive.js";');
 await writeFile(join(root,'transitive.js'),'import '+JSON.stringify(browser)+';');
 await assert.rejects(buildMobile({root}),/development module/i);
});
test('copy preserves previous artifact, adjacent assets, and rejects wrong app ownership',async()=>{
 const {buildMobile}=await import('../cli/build.js');
 const root=await fixture('copy-app');
 const flutter=join(root,'flutter'); const assets=join(flutter,'assets','web_bridge');
 await mkdir(assets,{recursive:true}); await writeFile(join(flutter,'pubspec.yaml'),'name: fixture');
 await writeFile(join(assets,'other.txt'),'untouched');
 await buildMobile({root,copy:true,flutterAssets:assets});
 const first=await readFile(join(assets,'index.html'),'utf8');
 await writeFile(join(root,'index.html'),'<html><head></head><body>updated<script type="module" src="/main.js"></script></body></html>');
 await buildMobile({root,copy:true,flutterAssets:assets});
 assert.equal(await readFile(join(assets,'index.html.previous'),'utf8'),first);
 assert.equal(await readFile(join(assets,'other.txt'),'utf8'),'untouched');
 const before=await readFile(join(assets,'index.html'),'utf8');
 await writeFile(join(root,'main.js'),'syntax is broken !!!');
 await assert.rejects(buildMobile({root,copy:true,flutterAssets:assets}));
 assert.equal(await readFile(join(assets,'index.html'),'utf8'),before);
 const other=await fixture('other-app');
 await assert.rejects(buildMobile({root:other,copy:true,flutterAssets:assets}),/different app/i);
});
test('artifact validation rejects remote assets and modified inline scripts',async()=>{
 const {validateHtml}=await import('../vite/audit.js');
 await assert.rejects(Promise.resolve().then(()=>validateHtml('<html><img src="https://evil.test/x.png"></html>','test')),/asset|CSP/i);
 const root=await fixture('hash-test'); const {buildMobile}=await import('../cli/build.js');
 await buildMobile({root}); const html=await readFile(join(root,'dist/index.html'),'utf8');
 assert.throws(()=>validateHtml(html.replace('</script>',';alert(1)</script>'),'hash-test'),/hash/i);
});
