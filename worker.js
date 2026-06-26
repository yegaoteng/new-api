export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const filePath = url.pathname.replace(/^\/+/, '');

      if (!filePath) {
        return new Response('Missing file path', { status: 400 });
      }

      const BUCKET = env.B2_BUCKET_NAME || 'pastegugugaga';
      const KEY_ID = '004d276434d8c0c0000000002';
      const APP_KEY = 'K004o2BFIEsFi2nIm3iN6NhFW6yf6bg';
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

      const authData = await authRes.json();
      const apiUrl = authData.apiUrl;
      const downloadUrl = authData.downloadUrl;
      const authorizationToken = authData.authorizationToken;

      // 2️⃣ 获取上传/下载 URL（这里用 downloadUrl）
      const fileRes = await fetch(
        `${downloadUrl}/file/${BUCKET}/${filePath}`,
        {
          headers: {
            Authorization: authorizationToken,
          },
        }
      );

      if (!fileRes.ok) {
        return new Response('File not found or access denied: ' + (await fileRes.text()), {
          status: fileRes.status,
        });
      }

      // 3️⃣ 返回文件内容
      const contentType = fileRes.headers.get('content-type') || 'application/octet-stream';
      const contentLength = fileRes.headers.get('content-length');
      const headers = {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000',
      };

      if (contentLength) {
        headers['Content-Length'] = contentLength;
      }

      return new Response(fileRes.body, { headers });

    } catch (e) {
      return new Response('Internal Error: ' + e.message, { status: 500 });
    }
  },
};
