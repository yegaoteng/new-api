export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json"
    };
    if (request.method === "OPTIONS")
      return new Response(null, { headers: cors });

    const url = new URL(request.url);
    const ac = url.searchParams.get("ac") || "";
    const wd = (url.searchParams.get("wd") || "").trim().toLowerCase();
    const ids = (url.searchParams.get("ids") || "").trim();
    const pg = parseInt(url.searchParams.get("pg") || "1");

    // 从 S3 拉你现有的 latest.json
    const S3_JSON = "https://s3.hi168.com/hi168-25242-ttcarm4a-s/movies/latest.json?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=0WE7Y5ZRQJPHN2GCKDC5%2F20260618%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260618T101652Z&X-Amz-Expires=3600&X-Amz-Signature=3c0a10bc0fd9389960350083673942e54bd46b53d33dfcdf9d53596bb8faf5e3&X-Amz-SignedHeaders=host&response-content-disposition=attachment%3B%20filename%3D%22latest.json%22&response-content-type=application%2Fjson&x-id=GetObject";
    let raw;
    try {
      raw = await fetch(S3_JSON, { cf: { cacheEverything: true, cacheTtl: 300 } });
      if (!raw.ok) throw new Error("拉取S3失败");
      raw = (await raw.json()).list || [];
    } catch {
      return new Response(JSON.stringify({ code: 0, msg: "数据源异常" }), { status: 500, headers: cors });
    }

    let list = raw;

    // 搜索
    if (wd) {
      list = raw.filter(v =>
        (v.vod_name || "").includes(wd) ||
        (v.vod_blurb || "").includes(wd)
      );
    }

    // 按IDS过滤
    if (ids && !wd) {
      const idArr = ids.split(",");
      list = raw.filter(v => idArr.includes(String(v.vod_id)));
    }

    // 分页（简单处理）
    const limit = 20;
    const start = (pg - 1) * limit;
    list = list.slice(start, start + limit);

    // MacCMS V10 标准返回
    return new Response(JSON.stringify({
      code: 1,
      msg: "ok",
      page: pg,
      pagecount: 1,
      limit: String(limit),
      total: list.length,
      list: list.map(v => ({
        vod_id: v.vod_id,
        vod_name: v.vod_name,
        type_id: v.type_id,
        type_name: v.type_name,
        vod_en: v.vod_en,
        vod_time: v.vod_time,
        vod_remarks: v.vod_remarks,
        vod_pic: v.vod_pic,
        vod_blurb: v.vod_blurb,
        vod_area: v.vod_area,
        vod_lang: v.vod_lang,
        vod_year: v.vod_year,
        vod_actor: v.vod_actor,
        vod_director: v.vod_director,
        vod_play_from: v.vod_play_from,
        vod_play_url: v.vod_play_url
      }))
    }), { headers: cors });
  }
};
