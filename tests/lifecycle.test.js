import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserTransport} from '../src/browser.js';
import {createSsaClient} from '../src/client.js';
test('browser pagehide disposes underlying fetch transport',async()=>{
 const {createBrowserClient}=await import('../src/browser.js');
 const target=new EventTarget();let signal;let started;
 const began=new Promise(resolve=>started=resolve);
 target.fetch=(_url,options)=>{signal=options.signal;started();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))));};
 const client=createBrowserClient({appId:'closing',contract:{version:1,shelf:{},endpoints:{slow:{method:'GET'}}},development:{endpoints:{slow:{url:'https://example.test'}}},target});
 const request=client.http.request({method:'GET',endpoint:'slow'});
 const rejected=assert.rejects(request,{code:'DISPOSED'});
 await began;target.dispatchEvent(new Event('pagehide'));
 await rejected;assert.equal(signal.aborted,true);
 client.dispose();
});
test('large development HTTP fixtures respect normalized response size limit',async()=>{
 const transport=createBrowserTransport({appId:'fixture-budget',contract:{version:1,shelf:{},endpoints:{big:{method:'GET'}}},development:{endpoints:{big:{fixture:'x'.repeat(1048576)}}}});
 const client=createSsaClient(transport);
 try{await assert.rejects(client.http.request({method:'GET',endpoint:'big'}),{code:'PAYLOAD_TOO_LARGE'});}
 finally{client.dispose();transport.dispose();}
});
