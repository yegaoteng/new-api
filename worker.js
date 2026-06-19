export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 1. 这里必须是 https，因为 http 连不上
    const s3Endpoint = 'https://s3.hi168.com'; 
    const bucket = 'hi168-25242-ttcarm4a-s';
    
    // 2. 提取文件路径，例如 /files/a.jpg -> a.jpg
    let key = url.pathname.replace(/^\/files\//, '');
    if (!key) return new Response('File not found', { status: 404 });

    try {
      // 3. 动态引入 AWS SDK (Workers 默认没有，必须用这种写法)
      const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
      
      // 4. 初始化客户端
      const client = new S3Client({
        endpoint: s3Endpoint,
        region: 'us-east-1', // 随便填，Hi168 可能不校验
        credentials: {
          accessKeyId: 'U6WUPKLFGJ5DL0X1Y340',     // 必须替换
          secretAccessKey: '919lcpy4yCOzoIy7nvoWIz0WXhAcdgvMNzTgOXJC'  // 必须替换
        },
        forcePathStyle: true, // 必须开启，这是兼容非 AWS S3 的关键
      });

      // 5. 发起请求
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      const response = await client.send(command);
      
      // 6. 把 S3 的文件流返回给浏览器
      return new Response(response.Body, {
        headers: response.Headers,
      });

    } catch (e) {
      // 如果还报错，直接把错误信息抛出来看
      return new Response(JSON.stringify({ error: e.message, stack: e.stack }), { status: 500 });
    }
  }
}
