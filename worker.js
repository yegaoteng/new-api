export default {
  async fetch(req) {
    const BUCKET = "hi168-25242-ttcarm4a-s";
    const HOST   = "s3.hi168.com";
    const AK     = "U6WUPKLFGJ5DL0X1Y340";
    const SK     = "919lcpy4yCOzoIy7nvoWIz0WXhAcdgvMNzTgOXJC";
    const REGION = "us-east-1";

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

    const policy=JSON.stringify({
      Version:"2012-10-17",
      Statement:[{
        Sid:"PublicReadGetObject",
        Effect:"Allow",
        Principal:"*",
        Action:"s3:GetObject",
        Resource:`arn:aws:s3:::${BUCKET}/*`
      }]
    });

    const bodyBuf=new TextEncoder().encode(policy);
    const bodyHash=hex(await sha256(bodyBuf));

    const now=new Date();
    const d=now.toISOString().slice(0,10).replace(/-/g,"");
    const amz=d+"T000000Z";
    const uri=`/${BUCKET}?policy`;

    const cr=
`PUT\n${uri}\n\ncontent-md5:\nhost:${HOST}\nx-amz-content-sha256:${bodyHash}\nx-amz-date:${amz}\n\nhost;x-amz-content-sha256;x-amz-date\n${bodyHash}`;

    const ch=hex(await sha256(new TextEncoder().encode(cr)));
    const sc=`${d}/${REGION}/s3/aws4_request`;
    const st=`AWS4-HMAC-SHA256\n${amz}\n${sc}\n${ch}`;
    let kd=await hmac("AWS4"+SK,d);
    let kr=await hmac(kd,REGION);
    let ks=await hmac(kr,"s3");
    let ksig=await hmac(ks,"aws4_request");
    const sig=hex(await hmac(ksig,st));

    const auth=
`AWS4-HMAC-SHA256 Credential=${AK}/${sc},SignedHeaders=host;x-amz-content-sha256;x-amz-date,Signature=${sig}`;

    const res=await fetch(`https://${HOST}${uri}`,{
      method:"PUT",
      body:policy,
      headers:{
        "Host":HOST,
        "x-amz-date":amz,
        "x-amz-content-sha256":bodyHash,
        "Authorization":auth,
        "Content-Type":"application/json"
      }
    });

    return new Response(
      `Status: ${res.status}\n${await res.text()}`,
      {headers:{"Content-Type":"text/plain;charset=utf-8"}}
    );
  }
}
