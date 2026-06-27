export default {
  async fetch(request) {
    const url = new URL(request.url);

    // 支持 /https://github.com/... 或 ?q=https://github.com/...
    let target =
      url.searchParams.get('q') ||
      url.pathname.replace(/^\//, '');

    if (!target) {
      return new Response('Missing target URL', { status: 400 });
    }

    // 如果是裸路径，补全 github.com
    if (!/^https?:\/\//i.test(target)) {
      target = 'https://github.com/' + target.replace(/^\//, '');
    }

    try {
      const resp = await fetch(target, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': '*/*',
        },
        redirect: 'follow',
      });

      // 流式转发，不缓存完整 body
      return new Response(resp.body, {
        status: resp.status,
        headers: resp.headers,
      });
    } catch (err) {
      return new Response('Proxy error: ' + err.message, {
        status: 500,
      });
    }
  },
};
