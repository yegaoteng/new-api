import { AwsClient } from 'aws4fetch'

// ====== 改成你自己的配置 ======
const BUCKET_NAME = 'pastegugugaga'
const S3_ENDPOINT = 'https://s3.us-west-004.backblazeb2.com'  // 去掉尾部斜杠
const AWS_REGION  = 'us-west-004'  // 从 endpoint 里取，如 us-west-002
const ACCESS_KEY = '004d276434d8c0c0000000001'
const SECRET_KEY = 'K004o2BFIEsFi2nIm3iN6NhFW6yf6bg'
// =================================

const aws = new AwsClient({
  accessKeyId: ACCESS_KEY,
  secretAccessKey: SECRET_KEY,
  region: AWS_REGION,
})

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url)
  // 去掉首段斜杠，得到 B2 中的对象路径
  // 访问 https://cdn.xxx.com/images/logo.png → 请求 B2 中 images/logo.png
  const objectKey = url.pathname.replace(/^\/+/, '')

  if (!objectKey) {
    return new Response('Not Found', { status: 404 })
  }

  // 构造 S3 GET 目标 URL
  const s3Url = new URL(`https://${BUCKET_NAME}.s3.us-west-004.backblazeb2.com/${objectKey}`)
  // 或用 S3_ENDPOINT 拼：new URL(`${S3_ENDPOINT}/${BUCKET_NAME}/${objectKey}`)

  const signedReq = await aws.sign(s3Url, {
    method: 'GET',
    headers: { 'Host': s3Url.hostname },
  })

  // 开启 CF 边缘缓存
  const response = await fetch(signedReq, {
    cf: {
      cacheEverything: true,
      cacheTtl: 2592000,       // 缓存 30 天（可按文件后缀改）
    }
  })

  // 复制响应并加浏览器缓存头
  const newResp = new Response(response.body, response)
  newResp.headers.set('Cache-Control', 'public, max-age=31536000, immutable')

  return newResp
}
