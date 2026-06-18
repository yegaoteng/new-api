export default {
  async fetch(request, env, ctx) {
    return handle(request);
  }
};

/* ====== 配置区 ====== */
const BUCKET = "hi168-25242-ttcarm4a-s";
const KEY    = "movies/latest.json";
const AK     = "U6WUPKLFGJ5DL0X1Y340";
const SK     = "919lcpy4yCOzoIy7nvoWIz0WXhAcdgvMNzTgOXJC";
const REGION = "us-east-1";
const HOST   = "s3.hi168.com";
/* =================== */

/* ====== AWS SigV4 ====== */
function hex(b){
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function sha256(buf){
  return crypto.subtle.digest("SHA-256", buf);
}
async function hmac(key,msg){
  const k=typeof key==="string"
    ?await crypto.subtle.importKey("raw",new TextEncoder().encode(key),{name:"HMAC",hash:"SHA-256"},false,["sign"])
    :key;
  return crypto.subtle.sign("HMAC",k,new TextEncoder().encode(msg));
}
async function signedGet(){
  const now=new Date();
  const d=now.toISOString().slice(0,10).replace(/-/g,"");
  const amz=d+"T000000Z";
  const uri=`/${BUCKET}/${KEY}`;
  const ph=hex(await sha256(new Uint8Array(0)));
  const cr=
`GET\n${uri}\n\nhost:${HOST}\nx-amz-content-sha256:${ph}\nx-amz-date:${amz}\n\nhost;x-amz-content-sha256;x-amz-date\n${ph}`;
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
  return fetch(`https://${HOST}${uri}`,{
    headers:{
      "Host":HOST,
      "x-amz-date":amz,
      "x-amz-content-sha256":ph,
      "Authorization":auth
    }
  });
}

/* ====== Handler ====== */
async function handle(req){
  const url=new URL(req.url);
  const cors={
    "Content-Type":"application/json;charset=utf-8",
    "Access-Control-Allow-Origin":"*"
  };

  if(url.pathname.includes("/provide/vod")){
    try{
      const res=await signedGet();
      if(!res.ok) throw new Error("S3 "+res.status);
      let data=await res.json();
      let list=data.list||[];
      const wd=url.searchParams.get("wd");
      if(wd) list=list.filter(i=>(i.vod_name||"").includes(wd)||(i.vod_blurb||"").includes(wd));
      data.total=list.length; data.list=list; data.code=1; data.msg="ok";
      return new Response(JSON.stringify(data),{headers:cors});
    }catch(e){
      return new Response(JSON.stringify({code:-1,msg:e.message,list:[],total:0}),{status:500,headers:cors});
    }
  }

  if(url.pathname.includes("/provide/type")){
    try{
      const res=await signedGet();
      const data=await res.json();
      const types=[...new Set((data.list||[]).map(i=>i.type_name))];
      return new Response(JSON.stringify({
        code:1,msg:"ok",list:types.map((n,i)=>({type_id:i+1,type_name:n}))
      }),{headers:cors});
    }catch(e){
      return new Response(JSON.stringify({code:-1,msg:e.message}),{status:500,headers:cors});
    }
  }

  return new Response("Movie VOD API OK",{headers:cors});
}
