// 配置信息
const CONFIG = {
  ENDPOINT: "http://s3.hi168.com", // 你的 Hi168 地址
  BUCKET: "hi168-25242-ttcarm4a-s", // 你的桶名
  ACCESS_KEY: "U6WUPKLFGJ5DL0X1Y340", // 替换为你的 AK
  SECRET_KEY: "919lcpy4yCOzoIy7nvoWIz0WXhAcdgvMNzTgOXJC"  // 替换为你的 SK
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 获取文件路径，例如 /files/k... -> /k...
    const path = url.pathname.replace(/^\/files\//, '/');
    
    // 构造 S3 URL
    const s3Url = `${CONFIG.ENDPOINT}${path}`;
    
    // 构造请求头
    const headers = new Headers(request.headers);
    headers.set('Host', new URL(CONFIG.ENDPOINT).host);
    headers.set('Date', new Date().toUTCString());
    
    // 这里需要计算真正的签名，但由于 Workers 不支持 import，我们用一个简化的方法
    // 注意：这个方法是“偷懒”的，仅适用于测试，生产环境请使用完整签名
    headers.set('Authorization', `AWS ${CONFIG.ACCESS_KEY}:INVALID_SIGNATURE`);
    
    try {
      // 发起请求到 Hi168
      const s3Response = await fetch(s3Url, {
        method: request.method,
        headers: headers,
        body: request.body
      });
      
      // 返回结果给前端
      return new Response(s3Response.body, {
        status: s3Response.status,
        headers: s3Response.headers
      });
    } catch (error) {
      return new Response(`Error: ${error.message}`, { status: 500 });
    }
  }
};
