import { CORS_ORIGIN } from './config.js';
import { SECURITY_HEADERS } from './security.js';

export class HttpError extends Error {
  constructor(status, message, headers = {}, code = undefined) {
    super(message);
    this.status = status;
    this.headers = headers;
    this.code = code; // optional machine-readable reason, e.g. EMAIL_NOT_VERIFIED
  }
}

export const str = (v) => (typeof v === 'string' ? v.trim() : '');

// Trimmed string with a maximum length.
export function text(v, max, label) {
  const s = str(v);
  if (s.length > max) throw new HttpError(400, `${label} must be ${max} characters or fewer`);
  return s;
}

export function requireFields(body, fields) {
  for (const f of fields) {
    if (!str(body[f])) throw new HttpError(400, `${f} is required`);
  }
}

export function send(res, status, payload, extraHeaders = {}) {
  const headers = { ...SECURITY_HEADERS, ...extraHeaders };
  if (CORS_ORIGIN) {
    headers['Access-Control-Allow-Origin'] = CORS_ORIGIN;
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, PATCH, DELETE, OPTIONS';
    headers.Vary = 'Origin';
  }
  if (status === 204) {
    res.writeHead(204, headers);
    return res.end();
  }
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...headers,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function sendHtml(res, html, csp) {
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Security-Policy': csp,
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
  });
  res.end(html);
}

const MAX_BODY_BYTES = 100_000;

export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) tooLarge = true;
      else chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return reject(new HttpError(413, 'Request body too large'));
      if (!chunks.length) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          return reject(new HttpError(400, 'JSON body must be an object'));
        resolve(parsed);
      } catch {
        reject(new HttpError(400, 'Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

export function createRouter() {
  const routes = [];
  return {
    add(method, path, opts, handler) {
      const keys = [];
      const pattern = new RegExp(
        '^' + path.replace(/:([A-Za-z]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$'
      );
      routes.push({ method, pattern, keys, handler, ...opts });
    },
    match(method, path) {
      let pathExists = false;
      for (const r of routes) {
        const m = r.pattern.exec(path);
        if (!m) continue;
        pathExists = true;
        if (r.method !== method) continue;
        let params;
        try {
          params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        } catch {
          throw new HttpError(400, 'Bad request');
        }
        return { route: r, params };
      }
      throw new HttpError(pathExists ? 405 : 404, pathExists ? 'Method not allowed' : 'Not found');
    },
  };
}
