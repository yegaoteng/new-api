// ==========================================
// B2 Private 免流代理 (完整修复版)
// 适配 Bucket: pastegugugaga
// 缓存: B2_AUTH_CACHE
// ==========================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.slice(1); // 去掉开头的 /

    // 1. 获取 B2 认证信息（带 KV 缓存）
    let authData = null;
    if (env.B2_AUTH_CACHE) {
      const cached = await env.B2_AUTH_CACHE.get('token', 'json');
      if (cached) {
        authData = cached;
      }
    }

    // 如果没有缓存，重新获取
    if (!authData) {
      const b2AuthUrl = "https://api.backblazeb2.com/b2api/v2/b2_authorize_account";
      const b2KeyId = env.B2_KEY_ID;
      const b2AppKey = env.B2_APP_KEY;

      if (!b2KeyId || !b2AppKey) {
        return new Response("B2 账号信息未配置", { status: 500 });
      }

      const authResponse = await fetch(b2AuthUrl, {
        headers: {
          Authorization: "Basic " + btoa(b2KeyId + ":" + b2AppKey),
        },
      });

      if (!authResponse.ok) {
        return new Response("B2 Auth Failed: " + await authResponse.text(), { status: 500 });
      }

      authData = await authResponse.json();

      // 缓存到 KV（安全写入，TTL 至少 60 秒）
      if (env.B2_AUTH_CACHE) {
        const ttl = 86400; // 24小时
        await env.B2_AUTH_CACHE.put('token', JSON.stringify(authData), { expirationTtl: ttl });
      }
    }

    // 2. 构造 B2 下载链接
    const downloadUrl = `https://${authData.downloadUrl}/file/${authData.bucketId}/${path}`;
    const b2Headers = {
      Authorization: authData.authorizationToken,
    };

    // 3. 转发请求到 B2
    const b2Response = await fetch(downloadUrl, {
      method: request.method,
      headers: b2Headers,
      body: request.body,
      redirect: "follow",
    });

    // 4. 返回响应
    return new Response(b2Response.body, {
      status: b2Response.status,
      headers: b2Response.headers,
    });
  },
};
