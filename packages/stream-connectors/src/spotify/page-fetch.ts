import type { PageFetchRequest, PageFetchResult } from './partner.js';
import { pageSafeHeaders } from './partner.js';

export function pageFetchScript(request: PageFetchRequest): string {
  const payload = JSON.stringify({ ...request, headers: pageSafeHeaders(request.headers) });
  return `(async () => {
    const req = ${payload};
    try {
      const extra = req.body != null && req.method !== 'GET' && req.method !== 'HEAD' ? { body: req.body } : {};
      const res = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        credentials: 'include',
        ...extra,
      });
      const text = await res.text();
      let body = {};
      if (text) {
        try { body = JSON.parse(text); } catch { body = text; }
      }
      return { ok: res.ok, status: res.status, body };
    } catch (err) {
      return { ok: false, status: 0, body: { error: String(err) } };
    }
  })()`;
}

export async function nodeFetch(request: PageFetchRequest): Promise<PageFetchResult> {
  try {
    const extra =
      request.body != null && request.method !== 'GET' && request.method !== 'HEAD'
        ? { body: request.body }
        : {};
    const res = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...extra,
    });
    const text = await res.text();
    let body: unknown = {};
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = text;
      }
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: { error: String(err) } };
  }
}
