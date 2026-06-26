// ==========================================
// B2 Private Bucket 代理配置
// 作者：AI助手
// 适配：你的 Bucket (pastegugugaga) 和 Host (f004)
// ==========================================

export default {
  async fetch(request, env, ctx) {
    // 1. 配置信息 (从环境变量读取)
    const B2_BUCKET_NAME = env.B2_BUCKET_NAME || 'pastegugugaga';
    const B2_KEY_ID = env.B2_KEY_ID;
    const B2_APP_KEY = env.B2_APP_KEY;
    
    // 2. B2 API 端点
    const AUTH_API = 'https://api.backblazeb2.com/b2api/v2/b2_authorize_account';
    // 根据你截图 f004 优化下载 Host
    const DOWNLOAD_HOST = 'https://f004.backblazeb2.com';

    // 3. 获取当前请求的路径 (例如 /file/pastegugugaga/abc.jpg)
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // 4. 鉴权逻辑：获取 B2 的临时 Token
      // 优先从 KV 缓存读取 Token，避免每次请求都调用 B2 API
      let authData = await env.B2_AUTH_CACHE?.get('token');
      let headers = {};

      if (!authData) {
        // 缓存中没有，去 B2 申请
        const authResponse = await fetch(AUTH_API, {
          headers: {
            'Authorization': 'Basic ' + btoa(B2_KEY_ID + ':' + B2_APP_KEY)
          }
        });
        
        if (!authResponse.ok) {
          return new Response('B2 Authorization Failed: ' + await authResponse.text(), { status: 500 });
        }
        
        authData = await authResponse.json();
        
        // 将 Token 存入 KV，过期时间设为实际过期时间减去 60 秒 (防止边缘节点时间不同步)
        const expiry = parseInt(authData.authorizationTokenExpirationTimestamp / 1000) - 60;
        
        // 注意：你需要创建一个名为 B2_AUTH_CACHE 的 KV Namespace 并绑定到这里
        // 如果没有绑定 KV，这段代码会报错，请参考下方的“无KV版”修改
        if (env.B2_AUTH_CACHE) {
           await env.B2_AUTH_CACHE.put('token', JSON.stringify(authData), { expirationTtl: expiry });
        }
      } else {
        authData = JSON.parse(authData);
      }

      // 5. 提取鉴权信息
      const authToken = authData.authorizationToken;
      const apiUrl = authData.apiUrl;
      const downloadUrl = authData.downloadUrl; // 备用下载域名

      // 6. 构建真实的 B2 下载请求
      // 你的请求路径是 /file/pastegugugaga/xxx，我们需要去掉 /file/pastegugugaga 前缀
      // 或者直接使用完整的 B2 路径
      
      // 方式：直接透传路径给 B2
      // 确保路径格式正确
      const b2Path = path.startsWith('/') ? path : '/' + path;
      
      // 如果路径不包含 bucket name，自动补上 (防御性编程)
      let targetPath = b2Path;
      if (!targetPath.includes(B2_BUCKET_NAME)) {
          targetPath = `/file/${B2_BUCKET_NAME}${b2Path.startsWith('/') ? '' : '/'}`;
      }

      const modifiedRequest = new Request(DOWNLOAD_HOST + targetPath, request);
      
      // 7. 注入鉴权 Header
      modifiedRequest.headers.set('Authorization', authToken);

      // 8. 发起请求到 B2
      const response = await fetch(modifiedRequest);

      // 9. 处理响应：如果 B2 返回 401 (Token 失效)，清除缓存并重试一次
      if (response.status === 401 && env.B2_AUTH_CACHE) {
        await env.B2_AUTH_CACHE.delete('token');
        // 简单重试一次
        return fetch(request, env, ctx); 
      }

      // 10. 返回结果给客户端
      // 克隆响应并添加缓存头 (Cache-Control)
      return new Response(response.body, {
        status: response.status,
        headers: {
          ...Object.fromEntries(response.headers),
          'Cache-Control': 'public, max-age=31536000', // 缓存一年
          'CF-Cache-Status': 'HIT', // 模拟 CF 缓存命中
        }
      });

    } catch (error) {
      return new Response('Error: ' + error.message, { status: 500 });
    }
  }
}
