import { SsaError, createSsaClient } from './client.js';

// Development-only module. The mobile build graph rejects this entire file.
export function createBrowserTransport({appId, contract, development = {}, target = globalThis}) {
  const prefix = 'arcbridge:' + appId + ':v' + contract.version + ':shelf:';
  let disposed = false;
  let database;
  const controllers = new Set();
  const fail = (code, message) => { throw new SsaError(code, message); };
  const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
  function rule(key) {
    if (!Object.hasOwn(contract.shelf ?? {}, key)) fail('ACCESS_DENIED', 'Shelf key is not allowed.');
    return contract.shelf[key];
  }
  async function db() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = target.indexedDB.open('arcbridge:' + appId + ':v' + contract.version, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('records');
      request.onsuccess = () => {
        if (disposed) { request.result.close(); reject(new SsaError('DISPOSED','Adapter closed.')); }
        else resolve(request.result);
      };
      request.onerror = () => reject(new SsaError('DAO_ERROR', 'Browser DAO is unavailable.'));
      request.onblocked = () => reject(new SsaError('DAO_ERROR', 'Browser DAO is blocked.'));
    });
    return database;
  }
  async function dao(method, p) {
    if(typeof p.store!=='string' || !/^[A-Za-z0-9_-]{1,64}$/.test(p.store) ||
      (method!=='dao.clear' && (typeof p.key!=='string' || p.key.length===0 || p.key.length>256)))fail('INVALID_ARGUMENT','Invalid store or record key.');
    const connection = await db();
    if (disposed) fail('DISPOSED','Adapter closed.');
    return new Promise((resolve, reject) => {
      const tx = connection.transaction('records', method === 'dao.get' ? 'readonly' : 'readwrite');
      const store = tx.objectStore('records');
      let result = null;
      const key = [p.store,p.key];
      let request;
      if (method === 'dao.get') request = store.get(key);
      if (method === 'dao.put') {
        if (JSON.stringify(p).length > 262144) fail('PAYLOAD_TOO_LARGE','DAO value exceeds its transfer limit.');
        request = store.put(p.value,key);
      }
      if (method === 'dao.delete') {
        request = store.get(key);
        request.onsuccess = () => { store.delete(key); };
      } else if (method === 'dao.clear') {
        request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) { if (cursor.key[0] === p.store) cursor.delete(); cursor.continue(); }
        };
      } else {
        request.onsuccess = () => { if (method === 'dao.get') result = request.result ?? null; };
      }
      tx.oncomplete = () => JSON.stringify(result).length > 262144 ? reject(new SsaError('PAYLOAD_TOO_LARGE','DAO record exceeds its transfer limit.')) : resolve(result);
      tx.onerror = tx.onabort = () => reject(new SsaError('DAO_ERROR','Browser DAO operation failed.'));
    });
  }
  async function http(p) {
    const apiFailure = (code,message) => ({ok:false,error:{kind:'api',code,message}});
    const endpoint = contract.endpoints?.[p.endpoint];
    const mapping = development.endpoints?.[p.endpoint];
    if (!endpoint || !mapping || endpoint.method !== p.method) fail('ACCESS_DENIED','HTTP endpoint or method is not allowed.');
    const fields=(value,rules={},required=[])=>{
      if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(k=>!Object.hasOwn(rules,k)) || required.some(k=>!Object.hasOwn(value,k)))fail('INVALID_ARGUMENT','Unexpected or missing request parameters.');
      for(const [key,v] of Object.entries(value)){
        const r=rules[key];
        if((r.type==='integer'?!Number.isSafeInteger(v):typeof v!==r.type) || (r.min!==undefined&&v<r.min) || (r.max!==undefined&&v>r.max) || (r.values&&!r.values.includes(v)) || (r.pattern&&(typeof v!=='string'||!new RegExp(r.pattern).test(v))))fail('INVALID_ARGUMENT','Invalid request parameter value.');
      }
    };
    fields(p.queryParams??{},endpoint.queryFields,endpoint.requiredQuery);
    fields(p.pathParams??{},endpoint.pathFields,Object.keys(endpoint.pathFields??{}));
    if(Object.keys(p.queryParams??{}).length&&!['GET','POST'].includes(p.method))fail('INVALID_ARGUMENT','Query arguments are not supported for this method.');
    if(Object.hasOwn(p,'data')){if(p.method==='GET')fail('INVALID_ARGUMENT','GET cannot have a body.');fields(p.data,endpoint.bodyFields);}
    // Explicit per-endpoint opt-in; never attach credentials to login/other URLs.
    const sessionKey = mapping.bearerSessionKey;
    if (sessionKey !== undefined && (typeof sessionKey !== 'string' || !sessionKey || sessionKey.length > 256)) {
      fail('INVALID_ARGUMENT', 'Invalid browser authentication configuration.');
    }
    const readToken = () => {
      try {
        const token = target.sessionStorage?.getItem(sessionKey);
        return typeof token === 'string' && token.length <= 8192 && /^[A-Za-z0-9._~+-]+$/.test(token) ? token : null;
      } catch { return null; }
    };
    const token = sessionKey === undefined ? null : readToken();
    if (sessionKey !== undefined && !token) return apiFailure('unAuthorized','Sign in to the browser development app first.');
    const success=data=>{
      const result={ok:true,data};if(bytes(result)>1048576)fail('PAYLOAD_TOO_LARGE','HTTP response exceeds its transfer limit.');return result;
    };
    if (Object.hasOwn(mapping,'fixture')) return success(structuredClone(mapping.fixture));
    let path = mapping.url;
    for (const [key,value] of Object.entries(p.pathParams ?? {})) path = path.replaceAll(':'+key, encodeURIComponent(String(value)));
    if (/:[a-zA-Z]\w*(?:\/|$)/.test(path.replace(/^https?:\/\//,''))) fail('INVALID_ARGUMENT','Missing path parameter.');
    const url = new URL(path,target.location?.origin);
    if (!['http:','https:'].includes(url.protocol)) fail('INVALID_ARGUMENT','Invalid development URL.');
    if (token && url.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) {
      fail('INVALID_ARGUMENT', 'Browser credentials require HTTPS or a local development server.');
    }
    for (const [key,value] of Object.entries(p.queryParams ?? {})) {
      if (value !== null && value !== undefined) url.searchParams.set(key,String(value));
    }
    const controller = new AbortController(); controllers.add(controller);
    const timer = setTimeout(() => controller.abort(),development.httpTimeoutMs ?? 30000);
    try {
      const response = await target.fetch(url,{
        method:p.method,signal:controller.signal,redirect:'error',credentials:'omit',
        headers:{'Accept':'application/json',...(Object.hasOwn(p,'data') ? {'Content-Type':'application/json'} : {}),
          ...(token ? {Authorization:'Bearer '+token} : {})},
        ...(Object.hasOwn(p,'data') ? {body:JSON.stringify(p.data)} : {}),
      });
      // Stream and bound the body rather than buffering an unlimited response.
      const reader = response.body?.getReader();
      let text = ''; let length = 0; const decoder = new TextDecoder();
      if (reader) {
        try {
          while (true) {
            const chunk = await reader.read(); if (chunk.done) break;
            length += chunk.value.byteLength;
            if (length > 1048576) { await reader.cancel(); fail('PAYLOAD_TOO_LARGE','HTTP response exceeds its transfer limit.'); }
            text += decoder.decode(chunk.value,{stream:true});
          }
          text += decoder.decode();
        } finally { reader.releaseLock(); }
      }
      if (token && readToken() !== token) return apiFailure('unAuthorized','The browser session changed during this request.');
      if (!response.ok) return apiFailure([401,403].includes(response.status)?'unAuthorized':'HTTP_'+response.status,'Development API request failed.');
      let parsed;
      try { parsed=text ? JSON.parse(text) : null; }
      catch { return apiFailure('INVALID_RESPONSE','Development API returned invalid JSON.'); }
      return success(parsed);
    } catch (error) {
      if (error instanceof SsaError) throw error;
      return apiFailure(controller.signal.aborted ? 'connectionTimedOut' : 'networkUnreachable',
        controller.signal.aborted ? 'Request timed out; it may already have executed.' : 'No network connection is available.');
    } finally { clearTimeout(timer); controllers.delete(controller); }
  }
  async function dispatch(method,p) {
    if (disposed) fail('DISPOSED','Browser adapter closed.');
    if (method === 'bridge.ready' || method === 'bridge.failed') return null;
    if (method === 'bridge.capabilities') return {
      version:1,
      methods:['bridge.ready','bridge.failed','bridge.capabilities','http.request',
        'storage.get','storage.set','storage.remove','storage.containsKey','storage.deleteAll',
        'dao.get','dao.put','dao.delete','dao.clear','device.haptic','device.vibrate'],
      development:true, http:'implemented',storage:'implemented',dao:'implemented',
      haptics:'simulated',socket:'unavailable',sse:'unavailable',webTransport:'unavailable',
    };
    if (method === 'device.haptic' || method === 'device.vibrate') {
      target.console?.info?.('[ArcBridge development simulation]',method); return null;
    }
    if (method === 'http.request') return http(p);
    if (method.startsWith('dao.')) return dao(method,p);
    if (method === 'storage.deleteAll') {
      for (const [key,r] of Object.entries(contract.shelf ?? {})) {
        if (!r.protected) target.localStorage.removeItem(prefix+key);
      }
      return null;
    }
    if (method.startsWith('storage.')) {
      const r = rule(p.key); const key = prefix+p.key;
      if (method === 'storage.set') {
        if (typeof p.value !== r.type || (r.values && !r.values.includes(p.value))) fail('INVALID_ARGUMENT','Shelf value has the wrong type.');
        if (bytes(p.value) > 4096) fail('PAYLOAD_TOO_LARGE','Shelf value exceeds its transfer limit.');
        target.localStorage.setItem(key,JSON.stringify(p.value)); return null;
      }
      const raw = target.localStorage.getItem(key);
      if (method === 'storage.get') return raw === null ? null : JSON.parse(raw);
      if (method === 'storage.containsKey') return raw !== null;
      if (method === 'storage.remove') {
        if (r.protected) fail('KEY_NOT_ALLOWED','Shelf key is protected.');
        target.localStorage.removeItem(key); return raw !== null;
      }
    }
    fail('UNSUPPORTED_METHOD','This capability is unavailable in browser development.');
  }
  const transport = {
    onmessage:null,
    postMessage(raw) {
      const request=JSON.parse(raw);
      Promise.resolve().then(()=>dispatch(request.method,request.params)).then(
        result=>({id:request.id,ok:true,result}),
        error=>({id:request.id,ok:false,error:{
          code:error instanceof SsaError ? error.code : request.method.startsWith('dao.') ? 'DAO_ERROR' : 'STORAGE_ERROR',
          message:error instanceof SsaError ? error.message : 'Browser persistence operation failed.',
        }}),
      ).then(response=> { if (!disposed) transport.onmessage?.({data:JSON.stringify(response)}); });
    },
    dispose() {
      if (disposed) return; disposed=true; transport.onmessage=null;
      for (const controller of controllers) controller.abort();
      database?.then(connection=>connection.close(),()=>{});
    },
  };
  return transport;
}

export function createBrowserClient(configuration) {
 const target=configuration.target ?? globalThis;
 const transport=createBrowserTransport(configuration);
 const client=createSsaClient(transport,target);
 function dispose(){client.dispose();transport.dispose();target.removeEventListener?.('pagehide',dispose);}
 target.addEventListener?.('pagehide',dispose);
 return Object.freeze({...client,dispose});
}
