import { AwsClient } from 'aws4fetch';

// ====== 配置区 ======
const BUCKET = "hi168-25242-ttcarm4a-s"; // ✅ 必须填
// =====================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const file = url.searchParams.get("wd");

    if (!file) {
      return new Response("missing wd param", { status: 400 });
    }

    const aws = new AwsClient({
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      region: "us-east-1",
      service: "s3",
    });

    const s3Url = `https://s3.hi168.com/${BUCKET}/video/${file}`;

    try {
      const signedReq = await aws.sign(s3Url, {
        method: "GET",
        headers: {
          "Range": request.headers.get("range") || "",
        },
      });

      const res = await fetch(signedReq);

      return new Response(res.body, {
        status: res.status,
        headers: res.headers,
      });
    } catch (e) {
      return new Response("S3 Error: " + e.message, { status: 500 });
    }
  },
};
