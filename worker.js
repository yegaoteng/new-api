export default {
  async fetch(request) {
    const url = new URL(request.url);

    // /files/a/b.jpg → OpenList /d/hi168/a/b.jpg
    // 如果你的 OpenList 存储名不是 hi168，改成对应存储名
    if (url.pathname.startsWith("/files/")) {
      url.pathname = "/d/s3/" + url.pathname.slice("/files/".length);
    }

    // ★ 换成你的 Sealos OpenList 域名（不要加结尾斜杠）
    url.hostname = "fmptdghi.sealosbja.site";

    // 保留原始请求（Header / Method / Range）
    const newReq = new Request(url.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: "manual"
    });

    return fetch(newReq);
  }
};
