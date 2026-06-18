export default {
  async fetch(request) {
    return handle(request);
  }
};

/* ====== 配置 ====== */
const BUCKET = "hi168-25242-ttcarm4a-s";
const HOST   = "s3.hi168.com";
const AK     = "U6WUPKLFGJ5DL0X1Y340";
const SK     = "919lcpy4yCOzoIy7nvoWIz0WXhAcdgvMNzTgOXJC";
const REGION = "us-east-1";
const EXPIRES = 604800; // 最大 7 天
/* ================== */

function hex(b){
  return[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function sha256(buf){
  return crypto.subtle.digest("SHA-256",typeof buf==="string"?new TextEncoder().encode(buf):buf);
}
async function hmac(key,msg){
  const k=typeof key==="string"
    ?await crypto.subtle.importKey("raw",new TextEncoder().encode(key),{name:"HMAC",hash:"SHA-256"},false,["sign"])
    :key;
  return crypto.subtle.sign("HMAC",k,new TextEncoder().encode(msg));
}

// 生成预签名 GET URL
async function presign(key){
  const now=new Date();
  const d=now.toISOString().slice(0,10).replace(/-/g,"");
  const amz=d+"T000000Z";
  const scope=`${d}/${REGION}/s3/aws4_request`;
  const credential=`${AK}/${scope}`;

  const sKey=`/${BUCKET}/${key}`;
  const encodedKey=encodeURIComponent(key).replace(/%2F/g,"/");

  // Canonical request for Presign
  const creq=
`GET\n${sKey}\n`+
`X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${encodeURIComponent(credential)}&X-Amz-Date=${amz}&X-Amz-Expires=${EXPIRES}&X-Amz-SignedHeaders=host\n`+
`host:${HOST}\n\nhost\nUNSIGNED-PAYLOAD`;

  const creqHash=hex(await sha256(new TextEncoder().encode(creq)));
  const st=`AWS4-HMAC-SHA256\n${amz}\n${scope}\n${creqHash}`;

  let kd=await hmac("AWS4"+SK,d);
  let kr=await hmac(kd,REGION);
  let ks=await hmac(kr,"s3");
  let ksig=await hmac(ks,"aws4_request");
  const sig=hex(await hmac(ksig,st));

  const base=`https://${HOST}${sKey}`;
  return base+
    `?X-Amz-Algorithm=AWS4-HMAC-SHA256`+
    `&X-Amz-Credential=${encodeURIComponent(credential)}`+
    `&X-Amz-Date=${amz}`+
    `&X-Amz-Expires=${EXPIRES}`+
    `&X-Amz-SignedHeaders=host`+
    `&X-Amz-Signature=${sig}`;
}

async function handle(req){
  const url=new URL(req.url);

  // /video/<s3-key>
  if(url.pathname.startsWith("/video/")){
    const key=decodeURIComponent(url.pathname.replace("/video/",""));
    if(!key) return new Response("missing key",{status:400});
    try{
      const signed=await presign(key);
      return Response.redirect(signed,302);
    }catch(e){
      return new Response("Sign Error:"+e.message,{status:500});
    }
  }

  // 可选：根路径返回说明
  return new Response("Hi168 S3 Presign Proxy\nUsage: /video/<s3-object-key>",{
    headers:{"Content-Type":"text/plain;charset=utf-8"}
  });
}
