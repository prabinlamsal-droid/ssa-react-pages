import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {createBrowserTransport} from '../src/browser.js';
import {createSsaClient} from '../src/client.js';
import {createDao} from '../src/dao.js';
import {createHttpClient} from '../src/http.js';
test('browser DAO accepts native record keys, denies invalid stores, and delete returns null',async()=>{
 const transport=createBrowserTransport({appId:'parity',contract:{version:1,shelf:{},endpoints:{}},target:{indexedDB}});
 const client=createSsaClient(transport);const dao=createDao(client);
 try{
 const store=dao.store('notes');await store.put('cache:v1',{text:'x'});
 assert.deepEqual(await store.get('cache:v1'),{text:'x'});
 assert.equal(await store.delete('cache:v1'),null);
 await assert.rejects(dao.store('foo.bar').put('key',{x:1}),{code:'INVALID_ARGUMENT'});
 }finally{client.dispose();transport.dispose();}
});
test('browser HTTP denies undeclared fields and validates declared field values',async()=>{
 let fetches=0;
 const transport=createBrowserTransport({appId:'http-policy',contract:{version:1,shelf:{},endpoints:{
 plain:{method:'GET'},paged:{method:'GET',queryFields:{page:{type:'integer',min:1,max:10}},requiredQuery:['page']}
 }},development:{endpoints:{plain:{url:'https://example.test'},paged:{url:'https://example.test'}}},
 target:{fetch:async()=>{fetches++;return new Response('{}');}}});
 const client=createSsaClient(transport);const http=createHttpClient(client);
 try {
 assert.equal((await http.get('plain',{queryParams:{secret:1}})).error.code,'INVALID_ARGUMENT');
 assert.equal((await http.get('paged',{queryParams:{page:0}})).error.code,'INVALID_ARGUMENT');
 assert.equal((await http.get('paged')).error.code,'INVALID_ARGUMENT');
 assert.equal(fetches,0);
 assert.equal((await http.get('paged',{queryParams:{page:2}})).ok,true);
 }finally{client.dispose();transport.dispose();}
});
