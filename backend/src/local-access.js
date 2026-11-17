import { AppError } from './errors.js';

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function localAccess(request, _response, next) {
  // Never trust forwarded host/origin headers. Vite preserves its local Host.
  const host = request.headers.host;
  if (typeof host !== 'string' || !/^(127\.0\.0\.1|localhost|\[::1\])(?::[0-9]{1,5})?$/.test(host)) {
    return next(new AppError(403, 'LOCAL_ACCESS_ONLY', 'Only local application hosts are allowed.'));
  }
  const origin = request.headers.origin;
  if (origin !== undefined) {
    try {
      const url = new URL(origin);
      const allowedPorts = new Set(['5173', String(request.socket.localPort)]);
      if (url.origin !== origin || url.protocol !== 'http:' || !loopbackHosts.has(url.hostname) || !allowedPorts.has(url.port)) {
        throw new Error('Origin is not the local application.');
      }
    } catch {
      return next(new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Use the local application at http://127.0.0.1:5173.'));
    }
  }
  next();
}
