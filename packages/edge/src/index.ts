interface Env { ORIGIN_URL: string; EDGE_SHARED_SECRET: string }
function base64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const incoming = new URL(request.url); const origin = new URL(env.ORIGIN_URL);
    origin.pathname = incoming.pathname; origin.search = incoming.search;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const payload = `${timestamp}\n${incoming.host}\n${incoming.pathname}${incoming.search}`;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.EDGE_SHARED_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = base64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
    const headers = new Headers(request.headers);
    headers.set('x-vibelog-host', incoming.host); headers.set('x-vibelog-timestamp', timestamp); headers.set('x-vibelog-signature', signature);
    return fetch(origin, new Request(request, { headers, redirect: 'manual' }));
  },
} satisfies ExportedHandler<Env>;
