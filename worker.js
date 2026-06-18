addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});

// ==========================================
// 1. 配置区域（修改这里为你自己的信息）
// ==========================================
const CONFIG = {
  // Hi168 S3 信息
  S3_BUCKET: "hi168-25242-ttcarm4a-s",      // 例: hi168-25242-ttcarm4a-s
  S3_REGION: "us-east-1",         // 通常是这个，不用改
  S3_ENDPOINT: "https://s3.hi168.com",
  S3_PATH: "movies/latest.json",   // S3里的文件路径
  
  // 你的密钥
  ACCESS_KEY: "U6WUPKLFGJ5DL0X1Y340",
  SECRET_KEY: "919lcpy4yCOzoIy7nvoWIz0WXhAcdgvMNzTgOXJC"
};

// ==========================================
// 2. 工具函数（AWS SigV4 签名核心）
// ==========================================
async function hmac(key, msg) {
  // 确保 key 是 CryptoKey 类型
  if (typeof key === "string") {
    key = await crypto.subtle.importKey(
      "raw", 
      new TextEncoder().encode(key), 
      { name: "HMAC", hash: "SHA-256" }, 
      false, 
      ["sign"]
    );
  }
  
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(msg)
  );
  
  return new Uint8Array(signature);
}

async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  return new Uint8Array(hashBuffer);
}

// ==========================================
// 3. 生成 AWS SigV4 签名头
// ==========================================
async function generateSignature(method, path, queryString, headers, payload, timestamp) {
  const amzDate = timestamp.toISOString().replace(/[:\-]|\.\d{3}/g, "");
  const dateStamp = amzDate.substring(0, 8);
  
  // 1. 创建规范化请求
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map(k => `${k}:${headers[k].trim()}`)
    .join("\n") + "\n";
    
  const signedHeaders = Object.keys(headers).sort().join(";");
  
  // 2. 计算 payload hash
  const payloadHash = await sha256(payload);
  const payloadHashHex = Array.from(payloadHash).map(b => b.toString(16).padStart(2, '0')).join('');
  
  // 3. 创建规范化请求字符串
  const canonicalRequest = [
    method,
    path,
    queryString,
    canonicalHeaders,
    signedHeaders,
    payloadHashHex
  ].join("\n");
  
  // 4. 创建待签字符串
  const algorithm = "AWS4-HMAC-SHA256";
  const credentialScope = `${dateStamp}/${CONFIG.S3_REGION}/s3/aws4_request`;
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    await sha256(canonicalRequest)
  ].join("\n");
  
  // 5. 计算签名
  const kDate = await hmac("AWS4" + CONFIG.SECRET_KEY, dateStamp);
  const kRegion = await hmac(kDate, CONFIG.S3_REGION);
  const kService = await hmac(kRegion, "s3");
  const kSigning = await hmac(kService, "aws4_request");
  const signature = await hmac(kSigning, stringToSign);
  const signatureHex = Array.from(signature).map(b => b.toString(16).padStart(2, '0')).join('');
  
  // 6. 返回签名头和认证字符串
  return {
    Authorization: `${algorithm} Credential=${CONFIG.ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signatureHex}`,
    "x-amz-date": amzDate,
    "Host": CONFIG.S3_ENDPOINT.replace("https://", "")
  };
}

// ==========================================
// 4. 主处理函数
// ==========================================
async function handleRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  
  // CORS 支持
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
  
  // 处理预检请求
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  
  // === 苹果CMS兼容接口 ===
  if (path === "/api.php/provide/vod" || path.endsWith("/provide/vod")) {
    try {
      // 1. 构造 S3 请求
      const s3Path = `/${CONFIG.S3_BUCKET}/${CONFIG.S3_PATH}`;
      const s3Url = new URL(s3Path, CONFIG.S3_ENDPOINT);
      
      // 2. 准备请求头（GET 请求 payload 为空）
      const headers = {
        "Host": s3Url.host,
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      };
      
      // 3. 生成签名头
      const signatureHeaders = await generateSignature(
        "GET", 
        s3Path, 
        "",  // queryString 为空
        headers, 
        "",  // payload 为空
        new Date()
      );
      
      // 4. 合并所有请求头
      Object.assign(headers, signatureHeaders);
      
      // 5. 发送请求到 S3
      const s3Response = await fetch(s3Url, {
        method: "GET",
        headers: headers
      });
      
      // 6. 获取 S3 返回的数据
      const data = await s3Response.text();
      
      // 7. 返回给前端（保持 JSON 格式）
      return new Response(data, {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json; charset=utf-8"
        }
      });
      
    } catch (err) {
      return new Response(JSON.stringify({
        code: -1,
        msg: "Worker Error: " + err.message,
        list: [],
        total: 0
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json; charset=utf-8"
        }
      });
    }
  }
  
  // 默认返回（非 API 请求）
  return new Response("Not Found", { status: 404, headers: corsHeaders });
}
