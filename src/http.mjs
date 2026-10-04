/**
 * Shared HTTP for the platform clients.
 *
 * Credentials go in headers, never in URLs: platforms echo request URLs in
 * their error messages, and a token in a query string ends up in logs. Every
 * string this module throws is passed through redact() first.
 */

const SECRET_ENV = /TOKEN|SECRET|KEY|PASSWORD/i;

/** Every credential value present in the environment, longest first. */
function secretValues() {
  return Object.entries(process.env)
    .filter(([k, v]) => SECRET_ENV.test(k) && v && v.length >= 8)
    .map(([, v]) => v)
    .sort((a, b) => b.length - a.length);
}

/** Replace credential values and token-shaped strings in `text`. */
export function redact(text) {
  let s = String(text);
  for (const v of secretValues()) s = s.split(v).join('[redacted]');
  return s
    .replace(/(access_token|refresh_token|client_secret|developer[-_]token)=([^&\s"']+)/gi, '$1=[redacted]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/g, '$1[redacted]')
    .replace(/\bEA[A-Za-z0-9]{40,}\b/g, '[redacted]') // Meta user/system tokens
    .replace(/\bAQ[A-Za-z0-9_-]{40,}\b/g, '[redacted]') // LinkedIn tokens
    .replace(/\bya29\.[A-Za-z0-9._-]+/g, '[redacted]') // Google access tokens
    .replace(/\b1\/\/[A-Za-z0-9._-]{20,}/g, '[redacted]'); // Google refresh tokens
}

export class ApiError extends Error {
  constructor(platform, status, body) {
    super(redact(`${platform} API ${status}: ${String(body).slice(0, 500)}`));
    this.platform = platform;
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch JSON with retries on 429/5xx. `fetchImpl` is injectable for tests.
 * Rate-limit buckets on ad platforms recover in minutes, not seconds, so the
 * backoff is generous and bounded.
 */
export async function getJson(platform, url, { headers = {}, method = 'GET', body, fetchImpl = globalThis.fetch, retries = 3 } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, { method, headers, body });
    } catch (e) {
      last = new ApiError(platform, 'network', e.message);
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    const text = await res.text();
    if (res.ok) {
      try {
        return text ? JSON.parse(text) : {};
      } catch {
        throw new ApiError(platform, res.status, `non-JSON response: ${text.slice(0, 200)}`);
      }
    }
    last = new ApiError(platform, res.status, text);
    if (res.status !== 429 && res.status < 500) throw last;
    await sleep(2000 * 2 ** attempt);
  }
  throw last;
}

/** Read a required env var, with a setup hint instead of a stack trace. */
export function env(name, hint) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. ${hint}`);
  return v;
}
