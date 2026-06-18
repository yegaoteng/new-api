
// 引入 aws4fetch 库 (Cloudflare 会自动识别并加载它)
import { AwsClient } from 'aws4fetch';

// 从环境变量读取密钥 (安全起见，不要在代码里明文写死)
const aws = new AwsClient({
  accessKeyId: AWS_ACCESS_KEY_ID,
  secretAccessKey: AWS_SECRET_ACCESS_KEY,
  region: 'us-east-1', // Hi168 默认区域
  service: 's3'
});

// ES Module 标准导出
export default {
  async fetch(request, env, ctx) {
    
    // 1. 获取前端传过来的文件名 (例如: /api.php?wd=复仇者联盟.mp4)
    const url = new URL(request.url);
    const fileName = url.searchParams.get('wd');
    
    if (!fileName) {
      return new Response('缺少 wd 参数', { status: 400 });
    }

    // 2. 构建 S3 的下载链接 (根据你的 Hi168 域名调整)
    // 注意：这里假设你的文件在 S3 根目录，如果在文件夹里请修改路径
    const s3Url = `https://s3.hi168.com/video/${fileName}`;
    
    try {
      // 3. 使用 aws4fetch 自动生成带签名的请求
      const signedReq = await aws.sign(s3Url, {
        method: 'GET',
        headers: {
          // 这里可以添加需要的 Header，比如 Range 断点续传
          'Range': request.headers.get('Range') || ''
        }
      });

      // 4. 发起请求到 Hi168 S3 并返回给前端
      const response = await fetch(signedReq);
      
      // 5. 把 S3 返回的文件流直接透传给用户
      return new Response(response.body, {
        status: response.status,
        headers: response.headers
      });

    } catch (error) {
      // 如果出错，返回错误信息方便调试
      return new Response(`签名或请求失败: ${error.message}`, { status: 500 });
    }
  }
};
