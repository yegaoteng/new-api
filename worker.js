export default {
  async fetch(request, env) {
    const B2_BUCKET_NAME = env.B2_BUCKET_NAME || 'pastegugugaga';
    const AUTH_API = 'https://api.backblazeb2.com/b2api/v2/b2_authorize_account';
    const DOWNLOAD_HOST = 'https://f004.backblazeb2.com';

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      let authData = await env.B2_AUTH_CACHE?.get('token', 'json');

      if (!authData) {
        const authRes = await fetch(AUTH_API, {
          headers: {
            Authorization: 'Basic ' + btoa(env.B2_KEY_ID + ':' + env.B2_APP_KEY)
          }
        });
        if (!authRes.ok) return new Response('B2 Auth Failed', { status: 500 });
        authData = await authRes.json();

        const ttl = Math.floor(
          (authData.authorizationTokenExpirationTimestamp - Date.now()) / 1000
        ) - 60;

        await env.B2_AUTH_CACHE.put('token', JSON.stringify(authData), {
          expirationTtl: Math.max(ttl, 60)
        });
      }

      const targetPath = `/file/${B2_BUCKET_NAME}${path}`;
      const b2Req = new Request(DOWNLOAD_HOST + targetPath, request);
      b2Req.headers.set('Authorization', authData.authorizationToken);

      const b2Res = await fetch(b2Req);
      if (b2Res.status === 401) {
        await env.B2_AUTH_CACHE.delete('token');
        return fetch(request, env);
      }

      const headers = new Headers(b2Res.headers);
      headers.set('Cache-Control', 'public, max-age=31536000');

      return new Response(b2Res.body, {
        status: b2Res.status,
        headers
      });
    } catch (e) {
      return new Response(e.message, { status: 500 });
    }
  }
};
