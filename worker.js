// ====== 配置区 ======
const S3_HOST     = "s3.hi168.com";      // 不含 http://
const S3_ENDPOINT = "https://s3.hi168.com";
const BUCKET      = "hi168-25242-ttcarm4a-s";
const REGION      = "us-east-1";
const AK          = "U6WUPKLFGJ5DL0X1Y340";
const SK          = "919lcpy4yCOzoIy7nvoWIz0WXhAcdgvMNzTgOXJC";
// ===================

addEventListener("fetch", e => e.respondWith(handler(e.request)));

async function handler(req) {
  const u = new URL(req.url);
  // /files/a/b.jpg -> a/b.jpg
  let key = u.pathname.replace(/^\/files\//, "");
  if (!key) return new Response("missing key", {status:400});

  const now = new Date();
  const amzDate  = dateISO(now);
  const dateStamp = amzDate.slice(0,8);

  const canonicalUri     = `/${BUCKET}/${key}`;
  const canonicalQuery   = "";
  const canonicalHeaders = `host:${S3_HOST}\nx-amz-content-sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\nx-amz-date:${amzDate}\n`;
  const signedHeaders    = "host;x-amz-content-sha256;x-amz-date";
  const payloadHash      = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

  const creq =
    `GET\n${canonicalUri}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const creqHash = await sha256(creq);

  const scope = `${dateStamp}/${REGION}/s3/aws4_request`;
  const sts = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${creqHash}`;

  const kDate    = await hmac("AWS4"+SK, dateStamp);
  const kRegion  = await hmac(kDate, REGION);
  const kService = await hmac(kRegion, "s3");
  const kSigning = await hmac(kService, "aws4_request");
  const sig      = await hexhmac(kSigning, sts);

  const auth = `AWS4-HMAC-SHA256 Credential=${AK}/${scope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;

  const s3Url = `${S3_ENDPOINT}/${encodeURIComponent(BUCKET)}/${key.split("/").map(encodeURIComponent).join("/")}`;

  const hdrs = new Headers();
  hdrs.set("Host", S3_HOST);
  hdrs.set("x-amz-date", amzDate);
  hdrs.set("x-amz-content-sha256", payloadHash);
  hdrs.set("Authorization", auth);
  if (req.headers.get("range")) hdrs.set("Range", req.headers.get("range"));

  const resp = await fetch(s3Url, { method:"GET", headers:hdrs });
  if (!resp.ok) {
    const txt = await resp.text().catch(()=>"");
    return new Response(`S3 Error ${resp.status}\n${txt}`, {status:resp.status});
  }

  return new Response(resp.body, {
    status: resp.status,
    headers: resp.headers
  });
}

// ---- crypto helpers ----
function dateISO(d){ return d.toISOString().replace(/[:-]/g,"").slice(0,15)+"Z"; }
async function sha256(s){
  const buf=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));
  return buf;
}
async function hmac(key,msg){
  const a=typeof key==="string"?new TextEncoder().encode(key):key;
  const k=await crypto.subtle.importKey("raw",a,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return crypto.subtle.sign("HMAC",k,new TextEncoder().encode(msg));
}
async function hexhmac(key,msg){
  const buf=await hmac(key,msg);
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
