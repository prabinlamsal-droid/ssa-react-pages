/** Repository-owned cache policy; DAO callbacks perform persistence only. */
export async function resolveCached({ onCache, onRemote, onSave, refresh = false }) {
  let cached;
  try { cached = await onCache(); } catch { /* A failed cache read must not prevent a network request. */ }
  if (!refresh && cached?.fresh) {
    return { ok: true, data: cached.data, source: 'cache', stale: false };
  }
  const result = await onRemote();
  if (!result.ok) {
    const offline = ['noInternet', 'networkUnreachable', 'connectionTimedOut'].includes(result.error?.code);
    if (cached && offline) return { ok: true, data: cached.data, source: 'cache', stale: true, refreshError: result.error };
    return result;
  }
  let cacheWarning;
  try { await onSave(result.data); } catch { cacheWarning = 'Could not save offline data.'; }
  return { ...result, source: 'network', stale: false, ...(cacheWarning ? { cacheWarning } : {}) };
}
