// Covers the bounded scanner/AI/registry operations, including response-body reads.
export async function request(path, body, { timeoutMs = 90_000, fetchImpl = globalThis.fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(`/api/reports${path}`, {
        signal: controller.signal,
        ...(body === undefined ? {} : {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        }),
      });
    } catch {
      throw new Error('Cannot reach the backend. Start the API server and try again.');
    }
    let result;
    try { result = await response.json(); }
    catch { throw new Error('The backend is unavailable or returned an invalid response. Check the API server.'); }
    if (response.status === 503 && result.data?.status === 'unavailable') return result.data;
    if (!response.ok || !result.success) throw new Error(result.error?.message ?? 'The request failed. Try again.');
    return result.data;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(path.endsWith('/register')
        ? 'Registration request timed out. The transaction may still confirm. Verify or retry registration to check the actual chain state.'
        : 'The backend request timed out. Check the local API server and try again.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  scan: input => request('', input),
  get: id => request(`/${encodeURIComponent(id)}`),
  register: id => request(`/${encodeURIComponent(id)}/register`, {}),
  verify: (id, reportPackage) => request(`/${encodeURIComponent(id)}/verify`, reportPackage ? { reportPackage } : {}),
};
