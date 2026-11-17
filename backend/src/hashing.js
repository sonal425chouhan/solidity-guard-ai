import { createHash } from 'node:crypto';

// sg-json-v1: sorted object keys, preserved array order, JSON string escaping,
// finite numbers, UTF-8. Reject values that JSON would silently discard/coerce.
export function serializeDeterministically(value) {
  const ancestors = new Set();
  function encode(item) {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (typeof item !== 'object' || item === null) throw new TypeError('Unsupported JSON value.');
    if (ancestors.has(item)) throw new TypeError('Circular JSON value.');
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
      throw new TypeError('Expected a plain JSON object.');
    }
    if (Object.getOwnPropertySymbols(item).length) throw new TypeError('Symbol keys are not JSON.');
    ancestors.add(item);
    let result;
    if (Array.isArray(item)) {
      if (Object.keys(item).length !== item.length) throw new TypeError('Expected a dense JSON array.');
      result = '[' + Array.from(item, encode).join(',') + ']';
    } else {
      result = '{' + Object.keys(item).sort().map(key => JSON.stringify(key) + ':' + encode(item[key])).join(',') + '}';
    }
    ancestors.delete(item);
    return result;
  }
  return encode(value);
}

export function sha256(text) {
  return '0x' + createHash('sha256').update(text, 'utf8').digest('hex');
}

export function hashPayload(payload) {
  return sha256(serializeDeterministically(payload));
}

export function freezeJson(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}
