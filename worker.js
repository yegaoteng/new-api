addEventListener("fetch", e => e.respondWith(handle(e.request)));

/* ====== ↓ 只改这里 ↓ ====== */
const S3_HOST   = "s3.hi168.com";          // Hi168 S3 host
const S3_BUCKET = "hi168-25242-ttcarm4a-s"; // 你的桶名
const S3_KEY    = "movies/latest.json";     // S3 内路径
const AK        = "U6WUPKLFGJ5DL0X1Y340";
const SK        = "919lcpy4yCOzoIy7nvoWIz0WXhAcdgvMNzTgOXJC";
/* ====== ↑ 只改这里 ↑ ====== */

const REGION = "us-east-1";

function hmac(key, data) {
  return crypto.subtle.sign(
    "HMAC",
    typeof key === "string"
      ? awaitImport(key)
      : key,
    typeof data === "string" ? new TextEncoder().encode(data) : data
  );
}
function awaitImport(k) {
  return crypto.subtle.importKey(
    "raw", new TextEncoder().encode(k),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
}
async function sha256(buf) {
  return crypto.subtle.digest("SHA-256", buf);
}
function hex(b) {
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2,"0")).join("");
}

async function signedGet() {
  const now = new Date();
  const dateStamp = now.toISOString().slice(0,10).replace(/-/g,"");
  const amzDate   = dateStamp + "T000000Z";

  const canonicalUri  = `/${S3_BUCKET}/${S3_KEY}`;
  const payloadHash   = hex(await sha256(new Uint8Array(0)));
  const canonReq =
    `GET\n${canonicalUri}\n\n` +
    `host:${S3_HOST}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n\n` +
    `host;x-amz-content-sha256;x-amz-date\n${payloadHash}`;

  const creqHash = hex(await sha256(new TextEncoder().encode(canonReq)));
  const scope = `${dateStamp}/${REGION}/s3/aws4_request`;
  const str2sign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${creqHash}`;

  let kDate = await hmac("AWS4" + SK, dateStamp);
  let kRegion = await hmac(kDate, REGION);
  let kService = await hmac(kRegion, "s3");
  let kSigning = await hmac(kService, "aws4_request");
  const signature = hex(await hmac(kSigning, str2sign));

  const auth =
    `AWS4-HMAC-SHA256 Credential=${AK}/${scope},` +
    `SignedHeaders=host;x-amz-content-sha256;x-amz-date,` +
    `Signature=${signature}`;

  return fetch(`https://${S3_HOST}${canonicalUri}`, {
    method: "GET",
    headers: {
      "Host": S3_HOST,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      "Authorization": auth
    }
  });
}

async function handle(req) {
  const url = new URL(req.url);
  const cors = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  };

  if (url.pathname.includes("/provide/vod")) {
    try {
      const res = await signedGet();
      if (!res.ok) throw new Error("S3 "+res.status);
      let data = await res.json();
      let list = data.list || [];
      const wd = url.searchParams.get("wd");
      if (wd) list = list.filter(i=>(i.vod_name||"").includes(wd)||(i.vod_blurb||"").includes(wd));
      data.total = list.length;
      data.list = list;
      data.code = 1; data.msg = "ok";
      return new Response(JSON.stringify(data), {headers:cors});
    } catch(e){
      return new Response(JSON.stringify({code:-1,msg:e.message,list:[],total:0}),{status:500,headers:cors});
    }
  }

  if (url.pathname.includes("/provide/type")) {
    try {
      const res = await signedGet();
      const data = await res.json();
      const types=[...new Set((data.list||[]).map(i=>i.type_name))];
      return new Response(JSON.stringify({
        code:1,msg:"ok",list:types.map((n,i)=>({type_id:i+1,type_name:n}))
      }),{headers:cors});
    } catch(e){
      return new Response(JSON.stringify({code:-1,msg:e.message}),{status:500,headers:cors});
    }
  }

  return new Response("Movie VOD API OK",{headers:cors});
}
