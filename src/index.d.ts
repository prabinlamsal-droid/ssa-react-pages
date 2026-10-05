export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export class SsaError extends Error { constructor(code: string, message: string); code: string; }
export { SsaError as ArcBridgeError };
export interface NativeTransport { postMessage(message: string): void; onmessage?: ((event: {data: string}) => void) | null; }
export interface SocketOptions {
 endpoint?: string; params?: JsonObject;
 onMessage?: (data: Json) => void | Promise<void>;
 onState?: (data: Json) => void | Promise<void>;
 onError?: (error: SsaError) => void | Promise<void>;
}
export interface BridgeClient {
 capabilities(): Promise<{version: number; methods: string[]; development?: boolean; [key: string]: unknown}>;
 ready(): Promise<Json>; failed(kind: string): Promise<Json>; dispose(): void;
 vibrate(params?: {durationMs: number}): Promise<Json>;
 haptics: {trigger(params: {type: string}): Promise<Json>};
 device: {specs(): Promise<{screenWidth: number; screenHeight: number; contentHeight: number}>};
 symbol: {pick(): Promise<string | null>};
 market: {live(params: {action: 'start' | 'stop'}): Promise<Json>};
 http: {request(params: JsonObject): Promise<Json>};
 storage: {get(params: {key: string}): Promise<Json>; set(params: {key: string; value: Json}): Promise<null>;
 remove(params: {key: string}): Promise<boolean>; containsKey(params: {key: string}): Promise<boolean>; deleteAll(): Promise<null>};
 dao: {get(params: {store: string; key: string}): Promise<JsonObject | null>;
 put(params: {store: string; key: string; value: JsonObject}): Promise<null>;
 delete(params: {store: string; key: string}): Promise<null>; clear(params: {store: string}): Promise<null>};
 socket: {subscribe(options: SocketOptions): {id: string; ready: Promise<Json>; close(): Promise<Json>}};
}
export function createSsaClient(transport?: NativeTransport | null, lifecycle?: EventTarget, timeoutMs?: number, httpTimeoutMs?: number): BridgeClient;
export const ssa: BridgeClient; export const bridge: BridgeClient;
export class Shelf {
 constructor(client?: BridgeClient);
 put(key: string, value: Json): Promise<null>;
 get(key: string, defaultValue?: Json): Promise<Json>;
 delete(key: string): Promise<boolean>; containsKey(key: string): Promise<boolean>; deleteAll(): Promise<null>;
}
export const shelf: Shelf;
export interface DaoStore {
 get(key: string): Promise<JsonObject | null>; put(key: string, value: JsonObject): Promise<null>;
 delete(key: string): Promise<null>; clear(): Promise<null>;
}
export interface Dao {store(name: string): DaoStore;}
export function createDao(client?: BridgeClient): Dao; export const dao: Dao;
export type HttpResult = {ok: true; data: Json} | {ok: false; error: {kind: 'api' | 'bridge'; code: string; message: string}};
export interface HttpOptions {queryParams?: JsonObject; pathParams?: JsonObject;}
export interface HttpClient {
 get(endpoint: string, options?: HttpOptions): Promise<HttpResult>;
 post(endpoint: string, data: JsonObject, options?: HttpOptions): Promise<HttpResult>;
 put(endpoint: string, data: JsonObject, options?: HttpOptions): Promise<HttpResult>;
 patch(endpoint: string, data: JsonObject, options?: HttpOptions): Promise<HttpResult>;
 delete(endpoint: string, options?: HttpOptions & {data?: JsonObject}): Promise<HttpResult>;
}
export function createHttpClient(client?: BridgeClient): HttpClient; export const http: HttpClient;
export function createSocketClient(options: {call: (method: string, params?: JsonObject) => Promise<Json>; lifecycle?: EventTarget; ErrorClass: typeof SsaError}): {api: BridgeClient['socket']; dispose(): void};
