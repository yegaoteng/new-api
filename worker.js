export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const filePath = url.pathname.replace(/^\/+/, '');

      if (!filePath) {
        return new Response('Missing file path', { status: 400 });
      }

      const BUCKET = env.B2_BUCKET_NAME || 'pastegugugaga';
      const KEY_ID = env.B2_KEY_ID;
      const APP_KEY = env.B2_APP_KEY;
      const DOWNLOAD_HOST = 'https://f004.backblazeb2.com';

      // 1️⃣ 每次请求都去 B2 拿授权（无 KV）
      const authRes = await fetch(
        'https://api.backblazeb2.com/b2api/v2/b2_authorize_account',
        {
          headers: {
            Authorization: 'Basic ' + btoa(KEY_ID + ':' + APP_KEY),
          },
        }
      );

      if (!authRes.ok) {
        return new Response('B2 Auth Failed: ' + (await authRes.text()), {
          status: 500,
        });
      }

      const auth = await authRes.json();

      // 2️⃣ 构造 B2 下载地址
      const b2Url = `${DOWNLOAD_HOST}/file/${BUCKET}/${filePath}`;

      const b2Req = new Request(b2Url, {
        method: request.method,
        headers: {
          Authorization: auth.authorizationToken,
          ...(request.headers.get('Range')
            ? { Range: request.headers.get('Range') }
            : {}),
        },
      });

      // 3️⃣ 请求 B2
      const b2Res = await fetch(b2Req);

      // 4️⃣ 返回给客户端 + 强缓存
      const headers = new Headers(b2Res.headers);
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');

      return new Response(b2Res.body, {
        status: b2Res.status,
        headers,
      });
    } catch (err) {
      return new Response(err.message, { status: 500 });
    }
  },
};
