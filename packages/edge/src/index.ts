interface Env { ORIGIN_URL: string; EDGE_SHARED_SECRET: string; ROOT_DOMAIN: string; MAINTENANCE_STAGE?: string }
function base64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function isPublicBlogRequest(request: Request, url: URL, rootDomain: string): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const suffix = `.${rootDomain}`;
  if (!url.hostname.endsWith(suffix)) return false;
  const label = url.hostname.slice(0, -suffix.length);
  return Boolean(label) && !label.includes('.') && label !== 'preview';
}
export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const incoming = new URL(request.url); const origin = new URL(env.ORIGIN_URL);
  if (env.MAINTENANCE_STAGE && env.MAINTENANCE_STAGE !== 'normal' && incoming.pathname !== '/health') {
    return new Response(request.method === 'HEAD' ? null : 'VibeLog is temporarily unavailable for maintenance. Please try again shortly.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '300' },
    });
  }
  origin.pathname = incoming.pathname; origin.search = incoming.search;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = `${timestamp}\n${incoming.host}\n${incoming.pathname}${incoming.search}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.EDGE_SHARED_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = base64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
  const headers = new Headers(request.headers);
  headers.set('x-vibelog-host', incoming.host); headers.set('x-vibelog-timestamp', timestamp); headers.set('x-vibelog-signature', signature);
  const init: RequestInit = { method: request.method, headers, body: request.body, redirect: 'manual' };
  if (isPublicBlogRequest(request, incoming, env.ROOT_DOMAIN)) init.cf = {
    cacheEverything: true,
    cacheKey: incoming.toString(),
    cacheTtlByStatus: { '200-299': 60, '300-599': 0 },
  };
  return fetch(origin, init);
}
export default { fetch: handleRequest } satisfies ExportedHandler<Env>;
