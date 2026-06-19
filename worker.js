// Hi168 配置
const S3_ENDPOINT = 'https://s3.hi168.com'; // 官方地址
const BUCKET_NAME = 'hi168-25242-ttcarm4a-s'; // 你的桶名，截图里看到的那个
const ACCESS_KEY = 'U6WUPKLFGJ5DL0X1Y340'; // 替换为你的 AK
const SECRET_KEY = '919lcpy4yCOzoIy7nvoWIz0WXhAcdgvMNzTgOXJC'; // 替换为你的 SK

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 1. 路径重写：将 /files/xxx 映射到 S3 的 /xxx
    // 例如：https://worker.yourdomain.com/files/a/b.jpg -> s3://paste/a/b.jpg
    if (url.pathname.startsWith('/files/')) {
      url.pathname = url.pathname.substring('/files'.length);
    } else {
      // 如果不是 /files 开头，可以返回 404 或者首页
      return new Response('Not found', { status: 404 });
    }
    
    // 2. 构造 S3 请求地址
    const s3Url = `${S3_ENDPOINT}${url.pathname}${url.search}`;
    
    // 3. 复制原始请求的 Headers (如 Range 断点续传)
    const headers = new Headers(request.headers);
    
    // 4. 重要：强制设置 Host，有些 S3 兼容服务需要
    headers.set('Host', new URL(S3_ENDPOINT).host);

    // 5. 创建 S3 请求
    const s3Request = new Request(s3Url, {
      method: request.method,
      headers: headers,
      body: request.body
    });

    // 6. 使用 AWS SDK for JavaScript v3 进行签名（Workers 环境支持）
    // 如果你不想用 SDK，也可以用下方的手动签名函数，但 SDK 更简单稳定
    try {
        const { S3Client, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
        const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

        const s3Client = new S3Client({
            endpoint: S3_ENDPOINT,
            region: 'auto', // 或者填 us-east-1
            credentials: {
                accessKeyId: ACCESS_KEY,
                secretAccessKey: SECRET_KEY
            },
            forcePathStyle: true, // 必须开启路径风格
        });

        let command;
        if (request.method === 'GET') {
            command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: url.pathname.substring(1) });
        } else if (request.method === 'PUT') {
            command = new PutObjectCommand({ Bucket: BUCKET_NAME, Key: url.pathname.substring(1), Body: request.body });
        } else {
            return new Response('Method Not Allowed', { status: 405 });
        }
        
        // 生成预签名 URL
        const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        
        // 重定向到这个临时的、安全的 URL
        return Response.redirect(signedUrl, 302);

    } catch (e) {
        return new Response('Error: ' + e.message, { status: 500 });
    }
  }
}