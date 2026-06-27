const ASSET_URL = 'https://hunshcn.github.io/gh-proxy/';
const PREFIX = '/';

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  let target = url.searchParams.get('q') || url.pathname.replace(PREFIX, '');
  
  // 去掉协议头若带完整URL
  if (/^https?:\/\//.test(target)) {
    return fetchAndStream(target, request);
  }
  
  // 拼接 github.com
  if (!target.startsWith('/')) target = '/' + target;
  return fetchAndStream('https://github.com' + target, request);
}

async function fetchAndStream(upstreamUrl, request) {
  try {
    const resp = await fetch(upstreamUrl, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' },
      redirect: 'follow'
    });
    // 流式转发，不缓存整个 body
    return new Response(resp.body, {
      status: resp.status,
      headers: resp.headers
    });
  } catch(e) {
    return new Response('Proxy error: ' + e.message, { status: 500 });
  }
}
