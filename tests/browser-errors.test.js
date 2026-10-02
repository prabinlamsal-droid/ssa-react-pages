import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserTransport} from '../src/browser.js';
import {createSsaClient} from '../src/client.js';
import {createHttpClient} from '../src/http.js';
test('browser reports implemented/simulated capabilities in native-compatible method list',async()=>{
 const transport=createBrowserTransport({appId:'caps',contract:{version:1,shelf:{},endpoints:{}}});
 const client=createSsaClient(transport);
 try{
 const caps=await client.capabilities();
 assert.ok(caps.methods.includes('http.request'));
 assert.equal(caps.haptics,'simulated');
 assert.ok(!caps.methods.includes('socket.subscribe'));
 }finally{client.dispose();transport.dispose();}
});
test('storage quota failures are sanitized and browser HTTP timeout aborts fetch',async()=>{
 const transport=createBrowserTransport({appId:'fail',contract:{version:1,shelf:{note:{type:'string'}},endpoints:{slow:{method:'GET'}}},
 development:{httpTimeoutMs:5,endpoints:{slow:{url:'https://example.test'}}},
 target:{localStorage:{setItem(){throw Error('SECRET')}},fetch:(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))))}});
 const client=createSsaClient(transport);
 try {
 await assert.rejects(client.storage.set({key:'note',value:'x'}),error=>error.code==='STORAGE_ERROR'&&!error.message.includes('SECRET'));
 const result=await createHttpClient(client).get('slow');
 assert.equal(result.error.code,'connectionTimedOut');
 }finally{client.dispose();transport.dispose();}
});
