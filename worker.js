// ============================================================
// 不知名社区 · Cloudflare Worker
// 零 npm 依赖：D1（结构化数据）+ KV（会话/验证码/OAuth state/限流）
//            + B2 S3 兼容 API（图片，自实现 SigV4）+ Brevo（邮件）+ Prism（OAuth）
// ============================================================
import HTML from './index.html';

/* ---------------- 配置 ---------------- */
const cfg = (env) => ({
  siteName:       env.SITE_NAME || '不知名社区',
  pageSize:       clamp(parseInt(env.PAGE_SIZE || '20', 10), 1, 50),
  maxUploadMB:    clamp(parseInt(env.MAX_UPLOAD_MB || '10', 10), 1, 25),
  hotDedup:       Math.max(0, parseInt(env.HOT_DEDUP_SECONDS || '300', 10) || 0),
  sessionDays:    clamp(parseInt(env.SESSION_DAYS || '30', 10), 1, 365),
  prismBase:      (env.PRISM_BASE || 'https://auth.ffurry.cc.cd').replace(/\/$/, ''),
  prismId:        env.PRISM_CLIENT_ID || '',
  prismSecret:    env.PRISM_CLIENT_SECRET || '',
  prismRedirect:  env.PRISM_REDIRECT_URI || '',
  brevoKey:       env.BREVO_API_KEY || '',
  brevoLogin:     env.BREVO_LOGIN_EMAIL || '',
  brevoFrom:      env.BREVO_FROM_EMAIL || '',
  brevoName:      env.BREVO_FROM_NAME || '不知名社区',
  b2KeyId:        env.B2_KEY_ID || '',
  b2AppKey:       env.B2_APP_KEY || '',
  b2Bucket:       env.B2_BUCKET || '',
  b2Endpoint:     (env.B2_ENDPOINT || 'https://s3.us-west-004.backblazeb2.com').replace(/^https?:\/\//, '').replace(/\/$/, ''),
  b2Region:       env.B2_REGION || '',
  proxyAlias:     env.B2_PROXY_ALIAS || 'images',
  publicBase:     (env.B2_PUBLIC_BASE || 'https://b.yenb.cc.cd/').replace(/\/$/, '') + '/',
  adminEmails:    (env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  devShowCode:    env.DEV_SHOW_CODE === '1',
});

const clamp = (n, lo, hi) => Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
const now = () => Math.floor(Date.now() / 1000);
const uid = () => crypto.randomUUID();

/* ---------------- 响应 / 错误 ---------------- */
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      ...extra,
    },
  });
}
const ok   = (data = {}, extra = {}) => json({ ok: true, ...data }, 200, extra);
const fail = (msg, status = 400, code = '') => json({ ok: false, error: msg, code }, status);
class ApiError extends Error {
  constructor(msg, status = 400, code = '') { super(msg); this.status = status; this.code = code; }
}
const need = (cond, msg, status = 400) => { if (!cond) throw new ApiError(msg, status); };

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  });
}

/* ---------------- 输入校验 / 清洗 ---------------- */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const USER_RE  = /^[\w\u4e00-\u9fa5-]{2,20}$/;
function normEmail(v) { return String(v || '').trim().toLowerCase(); }
function normLine(v, max) { return String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, max); }
function cleanText(v, max) { return String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, max); }
function asArray(v, max = 30, itemMax = 80) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, max).map(x => String(x).trim().slice(0, itemMax)).filter(Boolean);
}
function parseJSON(s, fallback) { try { const v = JSON.parse(s); return Array.isArray(v) ? v : fallback; } catch { return fallback; } }
function excerpt(body, n = 140) {
  return cleanText(body, 4000).replace(/[#*`>\[\]()!]/g, '').replace(/\s+/g, ' ').slice(0, n);
}

/* ---------------- Cookie / Session ---------------- */
function parseCookies(request) {
  const out = {};
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function sessionCookie(token, days) {
  return `bzm_session=${encodeURIComponent(token)}; Path=/; Max-Age=${days * 86400}; HttpOnly; Secure; SameSite=Lax`;
}
const clearCookie = () => 'bzm_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax';

async function makeSession(env, user, c) {
  const token = uid() + uid().replace(/-/g, '');
  await env.KV.put(`sess:${token}`, JSON.stringify({
    uid: user.id, ver: user.token_version || 0, exp: now() + c.sessionDays * 86400,
  }), { expirationTtl: c.sessionDays * 86400 });
  return token;
}
async function currentUser(request, env) {
  const token = parseCookies(request)['bzm_session'];
  if (!token) return null;
  const raw = await env.KV.get(`sess:${token}`);
  if (!raw) return null;
  let s;
  try { s = JSON.parse(raw); } catch { return null; }
  if (!s.uid || s.exp < now()) return null;
  const u = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(s.uid).first();
  if (!u || u.status !== 'active' || (u.token_version || 0) !== (s.ver || 0)) return null;
  return u;
}
async function requireUser(request, env) {
  const u = await currentUser(request, env);
  if (!u) throw new ApiError('请先登录', 401, 'need_login');
  return u;
}
async function requireAdmin(request, env) {
  const u = await requireUser(request, env);
  if (u.role !== 'admin') throw new ApiError('需要管理员权限', 403, 'need_admin');
  return u;
}

/* ---------------- 密码（PBKDF2 / WebCrypto） ---------------- */
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iters = 50000;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iters, hash: 'SHA-256' }, key, 256);
  return `pbkdf2$${iters}$${b64(salt)}$${b64(bits)}`;
}
async function verifyPassword(pw, stored) {
  if (!stored || !stored.startsWith('pbkdf2$')) return false;
  const [, itersStr, saltStr, hashStr] = stored.split('$');
  const iters = parseInt(itersStr, 10) || 50000;
  const salt = unb64(saltStr);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iters, hash: 'SHA-256' }, key, 256);
  const a = new Uint8Array(bits), b = unb64(hashStr);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* ---------------- KV：限流 / 验证码 ---------------- */
async function rateLimit(env, key, seconds) {
  if (seconds <= 0) return;
  const hit = await env.KV.get(`rl:${key}`);
  if (hit) throw new ApiError('操作太频繁，请稍后再试', 429, 'rate_limited');
  await env.KV.put(`rl:${key}`, '1', { expirationTtl: seconds });
}
async function sendCode(env, c, email, scene) {
  if (!c.brevoKey || !c.brevoFrom) {
    throw new ApiError('邮件服务未配置，请联系管理员（检查 BREVO_API_KEY / BREVO_FROM_EMAIL）', 503, 'mail_unconfigured');
  }
  await rateLimit(env, `code:${scene}:${email}`, 60);              // 按邮箱隔离的 60s 冷却
  const day = new Date().toISOString().slice(0, 10);
  const dailyKey = `codeday:${email}:${day}`;
  const used = parseInt((await env.KV.get(dailyKey)) || '0', 10);
  if (used >= 10) throw new ApiError('今天发送次数已达上限，请明天再试', 429, 'daily_limit');

  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
  await env.KV.put(`vcode:${scene}:${email}`, JSON.stringify({ code, tries: 0 }), { expirationTtl: 600 });
  await env.KV.put(dailyKey, String(used + 1), { expirationTtl: 90000 });

  const sceneName = { register: '注册账号', login: '登录', reset: '重置密码' }[scene] || '验证';
  const subject = `【${c.siteName}】${sceneName}验证码`;
  const text = `你的${sceneName}验证码是：${code}\n10 分钟内有效。若非本人操作请忽略此邮件。`;
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;max-width:480px;margin:auto;padding:28px;border:1px solid #e8eaf1;border-radius:14px">
    <h2 style="margin:0 0 6px;font-size:19px">${escapeHtml(c.siteName)}</h2>
    <p style="color:#6b7280;font-size:13px;margin:0 0 20px">${sceneName}验证码</p>
    <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#4f46e5;background:#f4f5fa;padding:18px;border-radius:10px;text-align:center">${code}</div>
    <p style="color:#6b7280;font-size:13px;line-height:1.7;margin:18px 0 0">10 分钟内有效。若非本人操作，请忽略此邮件，无需做任何处理。</p>
  </div>`;
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': c.brevoKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: c.brevoName, email: c.brevoFrom },
      to: [{ email }],
      subject, htmlContent: html, textContent: text,
    }),
  });
  if (!res.ok) {
    await env.KV.delete(`vcode:${scene}:${email}`);
    throw new ApiError('验证码发送失败：Brevo ' + res.status, 502, 'mail_failed');
  }
  return c.devShowCode ? code : null;   // 仅本地调试时回显
}
async function checkCode(env, email, scene, code) {
  const key = `vcode:${scene}:${email}`;
  const raw = await env.KV.get(key);
  if (!raw) throw new ApiError('验证码已过期，请重新获取', 400, 'code_expired');
  let d;
  try { d = JSON.parse(raw); } catch { throw new ApiError('验证码无效', 400, 'code_invalid'); }
  if ((d.tries || 0) >= 5) { await env.KV.delete(key); throw new ApiError('尝试次数过多，请重新获取', 429, 'code_tries'); }
  if (String(code || '').trim() !== d.code) {
    d.tries = (d.tries || 0) + 1;
    await env.KV.put(key, JSON.stringify(d), { expirationTtl: 600 });
    throw new ApiError('验证码不正确', 400, 'code_wrong');
  }
  await env.KV.delete(key);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/* ---------------- 用户装配 ---------------- */
async function uniqueUsername(env, email) {
  let base = email.split('@')[0].replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, '');
  if (base.length < 2) base = 'user' + String(Math.floor(Math.random() * 9000) + 1000);
  base = base.slice(0, 16);
  let name = base, i = 1;
  while (await env.DB.prepare('SELECT 1 FROM users WHERE username=?').bind(name).first()) {
    name = `${base}${i++}`;
  }
  return name;
}
async function createUser(env, c, { email, username, passwordHash, prismSub = null, displayName = '' }) {
  const id = uid();
  const t = now();
  const role = c.adminEmails.includes(email.toLowerCase()) ? 'admin' : 'user';
  await env.DB.prepare(`INSERT INTO users
    (id,email,username,display_name,password_hash,bio,avatar,prism_sub,role,status,token_version,created_at,last_login_at)
    VALUES (?,?,?,?,?,'','',?,?,'active',0,?,?)`)
    .bind(id, email, username, displayName || username, passwordHash, prismSub, role, t, t).run();
  return env.DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first();
}
function publicUser(u) {
  return {
    id: u.id, email: u.email, username: u.username,
    displayName: u.display_name || u.username, bio: u.bio || '', avatar: u.avatar || '',
    role: u.role, createdAt: u.created_at, lastLoginAt: u.last_login_at,
    hasPassword: !!u.password_hash && !u.prism_sub,
  };
}
const authorOf = (r) => ({
  id: r.author_id, username: r.username || '已注销',
  displayName: r.display_name || r.username || '已注销', avatar: r.avatar || '',
});

/* ---------------- Prism OAuth（PKCE S256） ---------------- */
async function prismLogin(request, env, c) {
  if (!c.prismId || !c.prismSecret || !c.prismRedirect) {
    return fail('Prism 授权未配置（检查 PRISM_CLIENT_ID / SECRET / REDIRECT_URI）', 503, 'prism_unconfigured');
  }
  const state = uid();
  const verifier = uid().replace(/-/g, '') + uid().replace(/-/g, '');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await env.KV.put(`oauth_state:${state}`, JSON.stringify({ verifier }), { expirationTtl: 300 });

  const u = new URL(`${c.prismBase}/api/oauth/authorize`);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', c.prismId);
  u.searchParams.set('redirect_uri', c.prismRedirect);
  u.searchParams.set('scope', 'openid profile email');
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return Response.redirect(u.toString(), 302);
}
async function prismCallback(request, env, c) {
  const url = new URL(request.url);
  const origin = url.origin;
  const go = (q) => Response.redirect(`${origin}/#/login?${q}`, 302);
  const e = url.searchParams.get('error');
  if (e) return go('err=' + encodeURIComponent(e));
  const code = url.searchParams.get('code'), state = url.searchParams.get('state');
  if (!code || !state) return go('err=missing_code');
  const raw = await env.KV.get(`oauth_state:${state}`);
  if (!raw) return go('err=invalid_state');
  await env.KV.delete(`oauth_state:${state}`);
  let verifier;
  try { verifier = JSON.parse(raw).verifier; } catch { return go('err=invalid_state'); }

  try {
    const tr = await fetch(`${c.prismBase}/api/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code,
        redirect_uri: c.prismRedirect,
        client_id: c.prismId, client_secret: c.prismSecret,
        code_verifier: verifier,
      }),
    });
    if (!tr.ok) throw new Error('token ' + tr.status);
    const td = await tr.json();
    const ur = await fetch(`${c.prismBase}/api/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${td.access_token}` },
    });
    if (!ur.ok) throw new Error('userinfo ' + ur.status);
    const p = await ur.json();
    const email = normEmail(p.email);
    if (!EMAIL_RE.test(email)) throw new Error('no email');

    let user = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
    if (!user) {
      const uname = await uniqueUsername(env, email);
      const ph = await hashPassword(uid() + uid());   // Prism 用户不可密码登录
      user = await createUser(env, c, {
        email, username: uname, passwordHash: ph,
        prismSub: p.sub || null,
        displayName: normLine(p.name || p.preferred_username || uname, 30),
      });
    } else {
      await env.DB.prepare('UPDATE users SET prism_sub=?, last_login_at=? WHERE id=?')
        .bind(p.sub || user.prism_sub, now(), user.id).run();
      user = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(user.id).first();
    }
    if (user.status !== 'active') return go('err=account_banned');

    const token = await makeSession(env, user, c);
    const h = new Headers();
    h.set('Set-Cookie', sessionCookie(token, c.sessionDays));
    h.set('Location', `${origin}/#/community`);
    return new Response(null, { status: 302, headers: h });
  } catch (err) {
    console.error('[prism]', err.message);
    return go('err=oauth_failed');
  }
}

/* ---------------- B2：AWS SigV4 PUT（零依赖） ---------------- */
const toHex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
async function sha256Hex(data) {
  return toHex(await crypto.subtle.digest('SHA-256', data));
}
async function hmac(keyBytes, msg) {
  const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)));
}
function deriveRegion(endpoint) {
  const parts = endpoint.split('.');
  return parts.length >= 2 && parts[0] === 's3' ? parts[1] : 'us-west-004';
}
function awsEncode(seg) {
  return encodeURIComponent(seg).replace(/[!'()*]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
}
async function b2Put(env, c, key, body, contentType) {
  need(c.b2KeyId && c.b2AppKey && c.b2Bucket, 'B2 存储未配置', 503);
  const region = c.b2Region || deriveRegion(c.b2Endpoint);
  const host = `${c.b2Bucket}.${c.b2Endpoint}`;
  const canonicalUri = '/' + key.split('/').map(awsEncode).join('/');
  const iso = new Date().toISOString();
  const amzDate = iso.replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex(body);

  const headers = {
    'content-type': contentType,
    'host': host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const signedNames = Object.keys(headers).sort();
  const canonicalHeaders = signedNames.map(n => `${n}:${String(headers[n]).trim()}\n`).join('');
  const signedHeaders = signedNames.join(';');
  const canonicalRequest = [
    'PUT', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash,
  ].join('\n');
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(new TextEncoder().encode(canonicalRequest)),
  ].join('\n');

  const kDate = await hmac(new TextEncoder().encode('AWS4' + c.b2AppKey), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, 's3');
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = toHex(await hmac(kSigning, stringToSign));
  const authorization = `AWS4-HMAC-SHA256 Credential=${c.b2KeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`https://${host}${canonicalUri}`, {
    method: 'PUT',
    headers: { ...headers, Authorization: authorization },
    body,
  });
  if (!res.ok) {
    const t = (await res.text()).slice(0, 200);
    throw new ApiError('上传到 B2 失败：HTTP ' + res.status + ' ' + t, 502, 'b2_failed');
  }
  return `${c.publicBase}${c.proxyAlias}/${key}`;
}
function safeImageUrl(env, c, u) {
  const base = `${c.publicBase}${c.proxyAlias}/`;
  return typeof u === 'string' && u.startsWith(base) && u.length < 500 ? u : '';
}

/* ---------------- 组装查询 ---------------- */
async function listPosts(env, c, me, page, q) {
  const kw = q ? `%${q.replace(/[%_]/g, '')}%` : null;
  const where = kw
    ? "p.status='normal' AND (p.title LIKE ? OR p.body LIKE ?)"
    : "p.status='normal'";
  const args = kw ? [kw, kw] : [];
  const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS n FROM posts p WHERE ${where}`).bind(...args).first();
  const total = totalRow ? Number(totalRow.n) : 0;
  const rows = await env.DB.prepare(`
    SELECT p.*, u.username, u.display_name, u.avatar,
      CASE WHEN ? IS NULL THEN 0 ELSE EXISTS(
        SELECT 1 FROM post_likes l WHERE l.post_id=p.id AND l.user_id=?
      ) END AS liked
    FROM posts p JOIN users u ON u.id=p.author_id
    WHERE ${where}
    ORDER BY p.created_at DESC, p.rowid DESC
    LIMIT ? OFFSET ?`)
    .bind(me ? me.id : null, me ? me.id : null, ...args, c.pageSize, (page - 1) * c.pageSize).all();
  return {
    items: (rows.results || []).map(r => ({
      id: r.id, title: r.title, excerpt: excerpt(r.body), format: r.format,
      images: parseJSON(r.images, []), author: authorOf(r),
      views: r.views, likes: r.likes, commentCount: r.comment_count,
      liked: !!r.liked, createdAt: r.created_at,
    })),
    page, pageSize: c.pageSize, total,
    hasMore: page * c.pageSize < total,
  };
}
async function listMods(env, c, page, q) {
  const kw = q ? `%${q.replace(/[%_]/g, '')}%` : null;
  const where = kw ? "m.status='normal' AND (m.name LIKE ? OR m.summary LIKE ?)" : "m.status='normal'";
  const args = kw ? [kw, kw] : [];
  const total = Number((await env.DB.prepare(`SELECT COUNT(*) AS n FROM mods m WHERE ${where}`).bind(...args).first())?.n || 0);
  const rows = await env.DB.prepare(`
    SELECT m.*, u.username, u.display_name, u.avatar
    FROM mods m JOIN users u ON u.id=m.author_id
    WHERE ${where} ORDER BY m.created_at DESC, m.rowid DESC
    LIMIT ? OFFSET ?`)
    .bind(...args, c.pageSize, (page - 1) * c.pageSize).all();
  return {
    items: (rows.results || []).map(r => ({
      id: r.id, name: r.name, summary: r.summary, image: r.image,
      versions: parseJSON(r.versions, []), loaders: parseJSON(r.loaders, []),
      author: { username: r.username, displayName: r.display_name, avatar: r.avatar },
      views: r.views, createdAt: r.created_at,
    })),
    page, pageSize: c.pageSize, total, hasMore: page * c.pageSize < total,
  };
}

/* ============================================================
   API 路由
   ============================================================ */
async function handleApi(request, env, c, path, me) {
  const method = request.method;
  const readBody = async () => { try { return await request.json(); } catch { return {}; } };
  const pageOf = (u) => clamp(parseInt(u.searchParams.get('page') || '1', 10) || 1, 1, 100000);
  const qOf = (u) => cleanText(u.searchParams.get('q') || '', 60);

  /* ---- 基础 ---- */
  if (path === '/api/health') {
    return ok({
      service: c.siteName, time: now(),
      checks: {
        d1: !!env.DB, kv: !!env.KV,
        prism: !!(c.prismId && c.prismSecret && c.prismRedirect),
        brevo: !!(c.brevoKey && c.brevoFrom),
        b2: !!(c.b2KeyId && c.b2AppKey && c.b2Bucket),
      },
      config: {
        pageSize: c.pageSize, maxUploadMB: c.maxUploadMB,
        proxyBase: c.publicBase, proxyAlias: c.proxyAlias,
        mailFrom: c.brevoFrom || null,        // 只显示发件邮箱，绝不回显 API Key
        mailName: c.brevoName,
        prismRedirect: c.prismRedirect || null,
      },
    });
  }
  if (path === '/api/bootstrap') {
    return ok({
      siteName: c.siteName,
      me: me ? publicUser(me) : null,
      prismEnabled: !!(c.prismId && c.prismSecret && c.prismRedirect),
      mailEnabled: !!(c.brevoKey && c.brevoFrom),
      pageSize: c.pageSize, maxUploadMB: c.maxUploadMB,
      proxyBase: c.publicBase, proxyAlias: c.proxyAlias,
    });
  }

  /* ---- 认证 ---- */
  if (path === '/api/auth/code' && method === 'POST') {
    const d = await readBody();
    const email = normEmail(d.email), scene = String(d.scene || 'register');
    need(EMAIL_RE.test(email), '邮箱格式不正确');
    need(['register', 'login', 'reset'].includes(scene), '验证码场景不正确');
    if (scene === 'register' && await env.DB.prepare('SELECT 1 FROM users WHERE email=?').bind(email).first()) {
      throw new ApiError('该邮箱已注册，请直接登录', 409, 'email_taken');
    }
    if ((scene === 'login' || scene === 'reset') && !await env.DB.prepare('SELECT 1 FROM users WHERE email=?').bind(email).first()) {
      throw new ApiError('该邮箱尚未注册', 404, 'email_missing');
    }
    const dev = await sendCode(env, c, email, scene);
    return ok({ sent: true, ...(dev ? { devCode: dev } : {}) });
  }
  if (path === '/api/auth/register' && method === 'POST') {
    const d = await readBody();
    const email = normEmail(d.email);
    const username = cleanText(d.username, 20);
    const pw = String(d.password || '');
    need(EMAIL_RE.test(email), '邮箱格式不正确');
    need(USER_RE.test(username), '用户名需 2~20 位，仅支持中英文、数字、下划线和短横线');
    need(pw.length >= 8 && pw.length <= 128, '密码需 8~128 位');
    await checkCode(env, email, 'register', d.code);
    if (await env.DB.prepare('SELECT 1 FROM users WHERE email=?').bind(email).first()) throw new ApiError('该邮箱已注册', 409);
    if (await env.DB.prepare('SELECT 1 FROM users WHERE username=?').bind(username).first()) throw new ApiError('该用户名已被占用', 409);
    const user = await createUser(env, c, { email, username, passwordHash: await hashPassword(pw) });
    const token = await makeSession(env, user, c);
    return ok({ me: publicUser(user) }, { 'Set-Cookie': sessionCookie(token, c.sessionDays) });
  }
  if (path === '/api/auth/login' && method === 'POST') {
    const d = await readBody();
    const email = normEmail(d.email);
    const user = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
    need(user && user.password_hash && !user.prism_sub, '邮箱或密码错误', 401);
    need(user.status === 'active', '账号已被禁用', 403);
    need(await verifyPassword(String(d.password || ''), user.password_hash), '邮箱或密码错误', 401);
    await env.DB.prepare('UPDATE users SET last_login_at=? WHERE id=?').bind(now(), user.id).run();
    const token = await makeSession(env, user, c);
    return ok({ me: publicUser(user) }, { 'Set-Cookie': sessionCookie(token, c.sessionDays) });
  }
  if (path === '/api/auth/login_code' && method === 'POST') {
    const d = await readBody();
    const email = normEmail(d.email);
    const user = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
    need(user && user.status === 'active', '账号不存在或已被禁用', 404);
    await checkCode(env, email, 'login', d.code);
    await env.DB.prepare('UPDATE users SET last_login_at=? WHERE id=?').bind(now(), user.id).run();
    const token = await makeSession(env, user, c);
    return ok({ me: publicUser(user) }, { 'Set-Cookie': sessionCookie(token, c.sessionDays) });
  }
  if (path === '/api/auth/reset' && method === 'POST') {
    const d = await readBody();
    const email = normEmail(d.email), pw = String(d.password || '');
    need(pw.length >= 8 && pw.length <= 128, '密码需 8~128 位');
    const user = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
    need(user && !user.prism_sub, '该账号不支持密码重置', 400);
    await checkCode(env, email, 'reset', d.code);
    await env.DB.prepare('UPDATE users SET password_hash=?, token_version=token_version+1 WHERE id=?')
      .bind(await hashPassword(pw), user.id).run();
    return ok({ reset: true });
  }
  if (path === '/api/auth/logout' && method === 'POST') {
    const t = parseCookies(request)['bzm_session'];
    if (t) await env.KV.delete(`sess:${t}`);
    return ok({}, { 'Set-Cookie': clearCookie() });
  }
  if (path === '/api/auth/prism/login' && method === 'GET') return prismLogin(request, env, c);
  if (path === '/api/auth/prism/callback' && method === 'GET') return prismCallback(request, env, c);

  /* ---- 个人中心 ---- */
  if (path === '/api/me' && method === 'GET') {
    const u = await requireUser(request, env);
    const stats = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM posts WHERE author_id=?) AS posts,
      (SELECT COUNT(*) FROM comments WHERE author_id=?) AS comments,
      (SELECT COUNT(*) FROM post_likes WHERE user_id=?) AS likes,
      (SELECT COUNT(*) FROM mods WHERE author_id=?) AS mods`).bind(u.id, u.id, u.id, u.id).first();
    return ok({ me: publicUser(u), stats: {
      posts: Number(stats?.posts || 0), comments: Number(stats?.comments || 0),
      likes: Number(stats?.likes || 0), mods: Number(stats?.mods || 0),
    } });
  }
  if (path === '/api/me/update' && method === 'POST') {
    const u = await requireUser(request, env);
    const d = await readBody();
    const username = cleanText(d.username, 20);
    const displayName = normLine(d.displayName, 30) || username;
    const bio = cleanText(d.bio, 200);
    need(USER_RE.test(username), '用户名需 2~20 位，仅支持中英文、数字、下划线和短横线');
    const dup = await env.DB.prepare('SELECT id FROM users WHERE username=? AND id<>?').bind(username, u.id).first();
    if (dup) throw new ApiError('该用户名已被占用', 409);
    const avatar = safeImageUrl(env, c, d.avatar) || '';
    await env.DB.prepare('UPDATE users SET username=?, display_name=?, bio=?, avatar=? WHERE id=?')
      .bind(username, displayName, bio, avatar, u.id).run();
    const fresh = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(u.id).first();
    return ok({ me: publicUser(fresh) });
  }
  if (path === '/api/me/password' && method === 'POST') {
    const u = await requireUser(request, env);
    const d = await readBody();
    need(!u.prism_sub, 'Prism 授权账号不支持修改本站密码', 400);
    need(await verifyPassword(String(d.oldPassword || ''), u.password_hash), '原密码不正确', 401);
    const pw = String(d.newPassword || '');
    need(pw.length >= 8 && pw.length <= 128, '新密码需 8~128 位');
    await env.DB.prepare('UPDATE users SET password_hash=?, token_version=token_version+1 WHERE id=?')
      .bind(await hashPassword(pw), u.id).run();
    const fresh = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(u.id).first();
    const token = await makeSession(env, fresh, c);
    return ok({ me: publicUser(fresh) }, { 'Set-Cookie': sessionCookie(token, c.sessionDays) });
  }

  /* ---- 帖子 ---- */
  if (path === '/api/posts' && method === 'GET') {
    const u = new URL(request.url);
    return ok(await listPosts(env, c, me, pageOf(u), qOf(u)));
  }
  if (path === '/api/posts' && method === 'POST') {
    const u = await requireUser(request, env);
    const d = await readBody();
    const title = normLine(d.title, 100);
    const body = cleanText(d.body, 20000);
    const format = d.format === 'markdown' ? 'markdown' : 'plain';
    need(title.length >= 2, '标题至少 2 个字');
    need(body.length >= 2, '内容不能为空');
    await rateLimit(env, `post:${u.id}`, 20);
    const images = asArray(d.images, 9).map(x => safeImageUrl(env, c, x)).filter(Boolean);
    const id = uid(), t = now();
    await env.DB.prepare(`INSERT INTO posts
      (id,author_id,title,body,format,images,views,likes,comment_count,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,0,0,0,'normal',?,?)`)
      .bind(id, u.id, title, body, format, JSON.stringify(images), t, t).run();
    return ok({ id });
  }
  let m;
  if ((m = path.match(/^\/api\/posts\/([a-f0-9-]{36})$/)) && method === 'GET') {
    const id = m[1];
    const r = await env.DB.prepare(`
      SELECT p.*, u.username, u.display_name, u.avatar,
        CASE WHEN ? IS NULL THEN 0 ELSE EXISTS(
          SELECT 1 FROM post_likes l WHERE l.post_id=p.id AND l.user_id=?
        ) END AS liked
      FROM posts p JOIN users u ON u.id=p.author_id WHERE p.id=? AND p.status='normal'`)
      .bind(me ? me.id : null, me ? me.id : null, id).first();
    if (!r) throw new ApiError('帖子不存在或已隐藏', 404, 'not_found');

    // 热度：按点进帖子的次数累加，同一访客 N 秒内只计一次
    let counted = false;
    if (c.hotDedup > 0) {
      const visitor = me ? `u:${me.id}` : `ip:${hashIp(request.headers.get('CF-Connecting-IP') || 'anon')}`;
      const key = `hot:${id}:${visitor}`;
      if (!await env.KV.get(key)) {
        await env.KV.put(key, '1', { expirationTtl: c.hotDedup });
        counted = true;
      }
    } else counted = true;
    if (counted) await env.DB.prepare('UPDATE posts SET views=views+1 WHERE id=?').bind(id).run();

    return ok({
      post: {
        id: r.id, title: r.title, body: r.body, format: r.format,
        images: parseJSON(r.images, []), author: authorOf(r),
        views: r.views + (counted ? 1 : 0), likes: r.likes,
        commentCount: r.comment_count, liked: !!r.liked,
        createdAt: r.created_at, updatedAt: r.updated_at,
        mine: !!me && me.id === r.author_id,
      },
    });
  }
  if ((m = path.match(/^\/api\/posts\/([a-f0-9-]{36})\/like$/)) && method === 'POST') {
    const u = await requireUser(request, env);
    const id = m[1];
    const p = await env.DB.prepare('SELECT id FROM posts WHERE id=? AND status=\'normal\'').bind(id).first();
    if (!p) throw new ApiError('帖子不存在', 404);
    const existing = await env.DB.prepare('SELECT 1 FROM post_likes WHERE post_id=? AND user_id=?').bind(id, u.id).first();
    if (existing) {
      await env.DB.prepare('DELETE FROM post_likes WHERE post_id=? AND user_id=?').bind(id, u.id).run();
      await env.DB.prepare('UPDATE posts SET likes=MAX(0,likes-1) WHERE id=?').bind(id).run();
    } else {
      await env.DB.prepare('INSERT INTO post_likes (post_id,user_id,created_at) VALUES (?,?,?)').bind(id, u.id, now()).run();
      await env.DB.prepare('UPDATE posts SET likes=likes+1 WHERE id=?').bind(id).run();
    }
    const row = await env.DB.prepare('SELECT likes FROM posts WHERE id=?').bind(id).first();
    return ok({ liked: !existing, likes: Number(row?.likes || 0) });
  }
  if ((m = path.match(/^\/api\/posts\/([a-f0-9-]{36})\/comments$/)) && method === 'GET') {
    const id = m[1];
    const r = await env.DB.prepare(`
      SELECT c.id,c.content,c.created_at,c.author_id,u.username,u.display_name,u.avatar
      FROM comments c JOIN users u ON u.id=c.author_id
      WHERE c.post_id=? AND c.status='normal'
      ORDER BY c.created_at ASC, c.id ASC LIMIT 200`).bind(id).all();
    return ok({ items: (r.results || []).map(x => ({
      id: x.id, content: x.content, createdAt: x.created_at,
      author: { id: x.author_id, username: x.username, displayName: x.display_name, avatar: x.avatar },
    })) });
  }
  if ((m = path.match(/^\/api\/posts\/([a-f0-9-]{36})\/comments$/)) && method === 'POST') {
    const u = await requireUser(request, env);
    const id = m[1], d = await readBody();
    const content = cleanText(d.content, 1000);
    need(content.length >= 1, '评论不能为空');
    const p = await env.DB.prepare('SELECT id FROM posts WHERE id=? AND status=\'normal\'').bind(id).first();
    if (!p) throw new ApiError('帖子不存在', 404);
    await rateLimit(env, `comment:${u.id}`, 5);
    const cid = uid(), t = now();
    await env.DB.prepare('INSERT INTO comments (id,post_id,author_id,content,status,created_at) VALUES (?,?,?,?,\'normal\',?)')
      .bind(cid, id, u.id, content, t).run();
    await env.DB.prepare('UPDATE posts SET comment_count=comment_count+1 WHERE id=?').bind(id).run();
    return ok({ id: cid, createdAt: t });
  }
  if (path === '/api/hot' && method === 'GET') {
    const limit = clamp(parseInt(new URL(request.url).searchParams.get('limit') || '10', 10) || 10, 1, 20);
    const r = await env.DB.prepare(`SELECT id,title,views,likes,created_at FROM posts
      WHERE status='normal' AND views>0 ORDER BY views DESC, likes DESC, created_at DESC LIMIT ?`).bind(limit).all();
    return ok({ items: (r.results || []).map(x => ({
      id: x.id, title: x.title, views: x.views, likes: x.likes, createdAt: x.created_at,
    })) });
  }
  if (path === '/api/reports' && method === 'POST') {
    const u = await requireUser(request, env);
    const d = await readBody();
    const type = String(d.targetType || ''), id = String(d.targetId || '');
    const reason = cleanText(d.reason, 40), detail = cleanText(d.detail, 300);
    need(['post', 'comment', 'mod'].includes(type), '举报类型不正确');
    need(/^[a-f0-9-]{36}$/.test(id), '举报对象不正确');
    need(reason.length >= 2, '请选择举报原因');
    const dup = await env.DB.prepare('SELECT 1 FROM reports WHERE target_type=? AND target_id=? AND reporter_id=?')
      .bind(type, id, u.id).first();
    if (dup) throw new ApiError('你已经举报过这个内容了', 409, 'already_reported');
    await env.DB.prepare(`INSERT INTO reports (id,target_type,target_id,reporter_id,reason,detail,status,created_at)
      VALUES (?,?,?,?,?,?,'open',?)`).bind(uid(), type, id, u.id, reason, detail, now()).run();
    return ok({ reported: true });
  }

  /* ---- 模组中心 ---- */
  if (path === '/api/mods' && method === 'GET') {
    const u = new URL(request.url);
    return ok(await listMods(env, c, pageOf(u), qOf(u)));
  }
  if (path === '/api/mods' && method === 'POST') {
    const u = await requireUser(request, env);
    const d = await readBody();
    const name = normLine(d.name, 80), summary = cleanText(d.summary, 1000);
    need(name.length >= 2, '模组名称至少 2 个字');
    need(summary.length >= 5, '模组简介至少 5 个字');
    const versions = asArray(d.versions, 20, 40);
    const loaders = asArray(d.loaders, 10, 40);
    need(versions.length > 0, '请至少填写一个支持的版本');
    need(loaders.length > 0, '请至少选择一个加载器');
    await rateLimit(env, `mod:${u.id}`, 20);
    const image = safeImageUrl(env, c, d.image) || '';
    const id = uid(), t = now();
    await env.DB.prepare(`INSERT INTO mods
      (id,author_id,name,summary,image,versions,loaders,views,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,0,'normal',?,?)`)
      .bind(id, u.id, name, summary, image, JSON.stringify(versions), JSON.stringify(loaders), t, t).run();
    return ok({ id });
  }
  if ((m = path.match(/^\/api\/mods\/([a-f0-9-]{36})$/)) && method === 'GET') {
    const r = await env.DB.prepare(`SELECT m.*,u.username,u.display_name,u.avatar FROM mods m
      JOIN users u ON u.id=m.author_id WHERE m.id=? AND m.status='normal'`).bind(m[1]).first();
    if (!r) throw new ApiError('模组不存在', 404);
    await env.DB.prepare('UPDATE mods SET views=views+1 WHERE id=?').bind(m[1]).run();
    return ok({ mod: {
      id: r.id, name: r.name, summary: r.summary, image: r.image,
      versions: parseJSON(r.versions, []), loaders: parseJSON(r.loaders, []),
      author: { id: r.author_id, username: r.username, displayName: r.display_name, avatar: r.avatar },
      views: r.views + 1, createdAt: r.created_at,
    } });
  }

  /* ---- 图片上传（Worker 中转，前端不接触密钥、无需配 B2 CORS）---- */
  if (path === '/api/upload' && method === 'POST') {
    const u = await requireUser(request, env);
    const rawName = decodeURIComponent(request.headers.get('X-File-Name') || 'image.png');
    const ct = String(request.headers.get('Content-Type') || 'application/octet-stream').split(';')[0].trim();
    const allowed = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg' };
    need(!!allowed[ct], '仅支持 PNG / JPG / GIF / WebP / AVIF / SVG 图片', 415);
    const buf = await request.arrayBuffer();
    need(buf.byteLength > 0, '文件为空');
    need(buf.byteLength <= c.maxUploadMB * 1024 * 1024, `图片不能超过 ${c.maxUploadMB}MB`, 413);
    await rateLimit(env, `upload:${u.id}`, 2);
    const ext = allowed[ct];
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const key = `community/${u.id}/${date}/${uid().replace(/-/g, '')}.${ext}`;
    const url = await b2Put(env, c, key, buf, ct);
    return ok({ url, key, name: normLine(rawName, 120) });
  }

  /* ---- 举报后台 ---- */
  if (path === '/api/admin/reports' && method === 'GET') {
    await requireAdmin(request, env);
    const r = await env.DB.prepare(`SELECT r.*,u.username AS reporter FROM reports r
      JOIN users u ON u.id=r.reporter_id WHERE r.status='open'
      ORDER BY r.created_at DESC LIMIT 100`).bind().all();
    return ok({ items: r.results || [] });
  }
  if ((m = path.match(/^\/api\/admin\/reports\/([a-f0-9-]{36})$/)) && method === 'POST') {
    await requireAdmin(request, env);
    const d = await readBody();
    const status = String(d.status || '');
    need(['resolved', 'dismissed', 'open'].includes(status), '状态不正确');
    await env.DB.prepare('UPDATE reports SET status=? WHERE id=?').bind(status, m[1]).run();
    if (status === 'resolved' && d.hideTarget === true) {
      const rep = await env.DB.prepare('SELECT target_type,target_id FROM reports WHERE id=?').bind(m[1]).first();
      if (rep?.target_type === 'post') await env.DB.prepare("UPDATE posts SET status='hidden' WHERE id=?").bind(rep.target_id).run();
      if (rep?.target_type === 'comment') await env.DB.prepare("UPDATE comments SET status='hidden' WHERE id=?").bind(rep.target_id).run();
      if (rep?.target_type === 'mod') await env.DB.prepare("UPDATE mods SET status='hidden' WHERE id=?").bind(rep.target_id).run();
    }
    return ok({ updated: true });
  }

  return fail('接口不存在：' + path, 404, 'not_found');
}

function hashIp(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/* ============================================================
   入口
   ============================================================ */
export default {
  async fetch(request, env) {
    const c = cfg(env);
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';

    // 写操作做同源校验（CSRF），同源 SPA 之外不允许
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) {
      const origin = request.headers.get('Origin');
      if (origin && origin !== 'null') {
        try {
          if (new URL(origin).origin !== url.origin) return fail('跨站请求被拒绝', 403, 'csrf');
        } catch { return fail('请求来源不合法', 403, 'csrf'); }
      }
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'Allow': 'GET, POST, OPTIONS' } });
    }

    try {
      if (path === '/' || /^\/[#a-zA-Z0-9_/-]*$/.test(path) && !path.startsWith('/api/')) {
        return htmlResponse(HTML);
      }
      if (path === '/favicon.ico') return new Response(null, { status: 204 });

      // 只解析一次当前用户，供所有需要鉴权的接口复用
      const me = await currentUser(request, env);
      return await handleApi(request, env, c, path, me);
    } catch (e) {
      if (e instanceof ApiError) return fail(e.message, e.status, e.code);
      console.error('[bzm]', e);
      return fail('服务器内部错误，请稍后再试', 500, 'internal');
    }
  },
};
