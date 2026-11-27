// WineDog API — Cloudflare Worker
// Handles account login, remembered devices (sessions), and the /dev admin panel.

import { homeHtml } from './home.js';

const ADMIN_SESSION_HOURS = 12;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid confusion
const ROLES = ['Normal', 'Special'];

// Login rate limits (attempts per window)
const LIMITS = {
  loginIp: { max: 10, windowSec: 15 * 60 },
  adminIp: { max: 5, windowSec: 15 * 60 },
};

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    let res;
    try {
      res = await route(request, env);
    } catch (err) {
      if (err instanceof HttpError) {
        res = json({ error: err.message }, err.status);
      } else {
        console.error(err);
        res = json({ error: 'Server error' }, 500);
      }
    }
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
};

// ---------------------------------------------------------------- routing

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const m = request.method;

  // Public
  if (m === 'POST' && path === '/api/login') return login(request, env);
  if (m === 'GET' && path === '/api/me') return me(request, env);
  if (m === 'POST' && path === '/api/logout') return logout(request, env);

  // Admin
  if (m === 'POST' && path === '/api/admin/login') return adminLogin(request, env);
  if (path.startsWith('/api/admin/')) {
    await requireAdmin(request, env);
    if (m === 'POST' && path === '/api/admin/logout') return adminLogout(request, env);
    if (m === 'GET' && path === '/api/admin/accounts') return listAccounts(env);
    if (m === 'POST' && path === '/api/admin/accounts') return createAccount(request, env);
    if (m === 'GET' && path === '/api/admin/random-code') return json({ code: await uniqueRandomCode(env) });

    let p;
    if ((p = match(path, '/api/admin/accounts/:id'))) {
      if (m === 'PATCH') return updateAccount(request, env, p.id);
      if (m === 'DELETE') return deleteAccount(env, p.id);
    }
    if (m === 'POST' && (p = match(path, '/api/admin/accounts/:id/email'))) return emailCode(env, p.id);
    if (m === 'GET' && (p = match(path, '/api/admin/accounts/:id/sessions'))) return listSessions(env, p.id);
    if (m === 'DELETE' && (p = match(path, '/api/admin/accounts/:id/sessions'))) return revokeAllSessions(env, p.id);
    if (m === 'DELETE' && (p = match(path, '/api/admin/sessions/:sid'))) return revokeSession(env, p.sid);
  }

  if (path === '' || path === '/api') return json({ ok: true, service: 'winedog-api' });
  throw new HttpError(404, 'Not found');
}

function match(path, pattern) {
  const a = path.split('/');
  const b = pattern.split('/');
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < b.length; i++) {
    if (b[i].startsWith(':')) params[b[i].slice(1)] = decodeURIComponent(a[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

// ---------------------------------------------------------------- user side

async function login(request, env) {
  const body = await readJson(request);
  // Codes are not case-sensitive: they're always stored and checked in capitals.
  const code = String(body.code ?? '').trim().toUpperCase();
  if (!code) throw new HttpError(400, 'Enter your code.');

  const ip = clientIp(request);
  await checkLimit(env, `login-ip:${ip}`, LIMITS.loginIp);

  const account = await env.DB.prepare('SELECT * FROM accounts WHERE code = ?').bind(code).first();
  if (!account || account.disabled) {
    await hitLimit(env, `login-ip:${ip}`, LIMITS.loginIp);
    throw new HttpError(401, 'That code is not valid.');
  }
  await clearLimit(env, `login-ip:${ip}`);

  const token = randomToken();
  const now = nowSec();
  const loc = [request.cf?.city, request.cf?.region, request.cf?.country].filter(Boolean).join(', ');
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO sessions (id, account_id, token_hash, created_at, last_seen_at, user_agent, ip, location) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(randomId(), account.id, await sha256(token), now, now, (request.headers.get('User-Agent') || '').slice(0, 300), ip, loc),
    env.DB.prepare('UPDATE accounts SET last_login_at = ? WHERE id = ?').bind(now, account.id),
  ]);
  return json({ token, account: publicAccount(account) });
}

async function me(request, env) {
  const { account, session } = await requireUser(request, env);
  // Update "last seen" at most every 5 minutes to keep writes low.
  const now = nowSec();
  if (now - session.last_seen_at > 300) {
    await env.DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').bind(now, session.id).run();
  }
  return json({ account: publicAccount(account), home: homeHtml(account) });
}

async function logout(request, env) {
  const token = bearer(request);
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  }
  return json({ ok: true });
}

async function requireUser(request, env) {
  const token = bearer(request);
  if (!token) throw new HttpError(401, 'Not logged in');
  const row = await env.DB.prepare(
    `SELECT s.id AS s_id, s.last_seen_at AS s_last_seen, a.*
       FROM sessions s JOIN accounts a ON a.id = s.account_id
      WHERE s.token_hash = ?`
  ).bind(await sha256(token)).first();
  if (!row || row.disabled) throw new HttpError(401, 'Not logged in');
  return { account: row, session: { id: row.s_id, last_seen_at: row.s_last_seen } };
}

function publicAccount(a) {
  return { email: a.email, name: a.name, role: a.role };
}

// ---------------------------------------------------------------- admin auth

async function adminLogin(request, env) {
  if (!env.ADMIN_PASSWORD) throw new HttpError(500, 'ADMIN_PASSWORD secret is not set on the Worker.');
  const body = await readJson(request);
  const ip = clientIp(request);
  await checkLimit(env, `admin-ip:${ip}`, LIMITS.adminIp);
  if (!safeEqual(env.ADMIN_PASSWORD, String(body.password ?? ''))) {
    await hitLimit(env, `admin-ip:${ip}`, LIMITS.adminIp);
    throw new HttpError(401, 'Wrong password.');
  }
  await clearLimit(env, `admin-ip:${ip}`);
  const token = randomToken();
  const now = nowSec();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').bind(now),
    env.DB.prepare('INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)')
      .bind(await sha256(token), now, now + ADMIN_SESSION_HOURS * 3600),
  ]);
  return json({ token, expiresIn: ADMIN_SESSION_HOURS * 3600 });
}

async function requireAdmin(request, env) {
  const token = bearer(request);
  if (!token) throw new HttpError(401, 'Admin login required');
  const row = await env.DB.prepare('SELECT expires_at FROM admin_sessions WHERE token_hash = ?')
    .bind(await sha256(token)).first();
  if (!row || row.expires_at < nowSec()) throw new HttpError(401, 'Admin login required');
}

async function adminLogout(request, env) {
  await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(await sha256(bearer(request))).run();
  return json({ ok: true });
}

// ---------------------------------------------------------------- admin: accounts

async function listAccounts(env) {
  const { results } = await env.DB.prepare(
    `SELECT a.*, (SELECT COUNT(*) FROM sessions s WHERE s.account_id = a.id) AS session_count
       FROM accounts a ORDER BY a.created_at DESC`
  ).all();
  return json({ accounts: results, emailConfigured: !!env.RESEND_API_KEY });
}

async function createAccount(request, env) {
  const body = await readJson(request);
  const email = normEmail(body.email);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email.');
  const role = ROLES.includes(body.role) ? body.role : 'Normal';
  const code = body.code ? cleanCode(body.code) : await uniqueRandomCode(env);
  await assertCodeFree(env, code);
  const now = nowSec();
  const exists = await env.DB.prepare('SELECT id FROM accounts WHERE email = ?').bind(email).first();
  if (exists) throw new HttpError(409, 'An account with that email already exists.');
  const r = await env.DB.prepare(
    'INSERT INTO accounts (email, name, role, code, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(email, String(body.name ?? '').trim().slice(0, 100), role, code, String(body.notes ?? '').slice(0, 2000), now, now).run();
  const id = r.meta.last_row_id;

  let emailResult = null;
  if (body.sendEmail) emailResult = await sendCodeEmail(env, id);
  return json({ ok: true, id, code, email: emailResult });
}

async function updateAccount(request, env, id) {
  const account = await getAccount(env, id);
  const body = await readJson(request);
  const sets = [];
  const vals = [];
  const stmts = [];

  if (body.email !== undefined) {
    const email = normEmail(body.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email.');
    const clash = await env.DB.prepare('SELECT id FROM accounts WHERE email = ? AND id != ?').bind(email, account.id).first();
    if (clash) throw new HttpError(409, 'Another account already uses that email.');
    sets.push('email = ?'); vals.push(email);
  }
  if (body.name !== undefined) { sets.push('name = ?'); vals.push(String(body.name).trim().slice(0, 100)); }
  if (body.notes !== undefined) { sets.push('notes = ?'); vals.push(String(body.notes).slice(0, 2000)); }
  if (body.role !== undefined) {
    if (!ROLES.includes(body.role)) throw new HttpError(400, 'Role must be Normal or Special.');
    sets.push('role = ?'); vals.push(body.role);
  }
  let logoutAll = false;
  if (body.code !== undefined && body.code !== '') {
    const code = body.code === '__random__' ? await uniqueRandomCode(env) : cleanCode(body.code);
    if (code !== account.code) {
      await assertCodeFree(env, code, account.id);
      sets.push('code = ?'); vals.push(code);
      logoutAll = true; // changing the code logs them out everywhere
    }
  }
  if (body.disabled !== undefined) {
    sets.push('disabled = ?'); vals.push(body.disabled ? 1 : 0);
    if (body.disabled) logoutAll = true;
  }
  if (!sets.length) return json({ ok: true });

  sets.push('updated_at = ?'); vals.push(nowSec());
  stmts.push(env.DB.prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, account.id));
  if (logoutAll) stmts.push(env.DB.prepare('DELETE FROM sessions WHERE account_id = ?').bind(account.id));
  await env.DB.batch(stmts);
  return json({ ok: true, loggedOut: logoutAll });
}

async function deleteAccount(env, id) {
  const account = await getAccount(env, id);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE account_id = ?').bind(account.id),
    env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(account.id),
  ]);
  return json({ ok: true });
}

async function emailCode(env, id) {
  await getAccount(env, id);
  return json(await sendCodeEmail(env, id));
}

async function listSessions(env, id) {
  const account = await getAccount(env, id);
  const { results } = await env.DB.prepare(
    'SELECT id, created_at, last_seen_at, user_agent, ip, location FROM sessions WHERE account_id = ? ORDER BY last_seen_at DESC'
  ).bind(account.id).all();
  return json({ sessions: results });
}

async function revokeAllSessions(env, id) {
  const account = await getAccount(env, id);
  await env.DB.prepare('DELETE FROM sessions WHERE account_id = ?').bind(account.id).run();
  return json({ ok: true });
}

async function revokeSession(env, sid) {
  await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
  return json({ ok: true });
}

async function getAccount(env, id) {
  const a = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(Number(id)).first();
  if (!a) throw new HttpError(404, 'Account not found.');
  return a;
}

// ---------------------------------------------------------------- email

async function sendCodeEmail(env, id) {
  const a = await getAccount(env, id);
  const text = `Your code for Winedog.site is ${a.code}`;
  if (!env.RESEND_API_KEY) {
    return { sent: false, reason: 'Email sending is not set up yet (RESEND_API_KEY missing).', to: a.email, text };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM || 'WineDog <noreply@winedog.site>',
      to: [a.email],
      subject: 'Your WineDog code',
      text,
      html: `<div style="font-family:system-ui,sans-serif;font-size:16px;color:#111">Your code for Winedog.site is <b style="font-size:20px;letter-spacing:2px">${escapeHtml(a.code)}</b></div>`,
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error('Resend error', res.status, detail);
    return { sent: false, reason: `Email provider error (${res.status}): ${detail.slice(0, 200)}`, to: a.email, text };
  }
  await env.DB.prepare('UPDATE accounts SET code_sent_at = ? WHERE id = ?').bind(nowSec(), a.id).run();
  return { sent: true, to: a.email };
}

// ---------------------------------------------------------------- rate limiting

async function checkLimit(env, key, { max }) {
  const row = await env.DB.prepare('SELECT count, reset_at FROM rate_limits WHERE key = ?').bind(key).first();
  if (row && row.reset_at > nowSec() && row.count >= max) {
    const mins = Math.ceil((row.reset_at - nowSec()) / 60);
    throw new HttpError(429, `Too many attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
  }
}

async function hitLimit(env, key, { windowSec }) {
  const now = nowSec();
  await env.DB.prepare(
    `INSERT INTO rate_limits (key, count, reset_at) VALUES (?1, 1, ?2)
     ON CONFLICT(key) DO UPDATE SET
       count    = CASE WHEN reset_at <= ?3 THEN 1 ELSE count + 1 END,
       reset_at = CASE WHEN reset_at <= ?3 THEN ?2 ELSE reset_at END`
  ).bind(key, now + windowSec, now).run();
}

async function clearLimit(env, key) {
  await env.DB.prepare('DELETE FROM rate_limits WHERE key = ?').bind(key).run();
}

// ---------------------------------------------------------------- helpers

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function readJson(request) {
  try { return await request.json(); } catch { throw new HttpError(400, 'Bad request'); }
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function bearer(request) {
  const h = request.headers.get('Authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

function normEmail(e) { return String(e ?? '').trim().toLowerCase(); }

function cleanCode(c) {
  const code = String(c).trim().toUpperCase();
  if (code.length < 1 || code.length > 64) throw new HttpError(400, 'Code must be 1 to 64 characters.');
  return code;
}

async function assertCodeFree(env, code, exceptId = 0) {
  const taken = await env.DB.prepare('SELECT id FROM accounts WHERE code = ? AND id != ?').bind(code, exceptId).first();
  if (taken) throw new HttpError(409, 'Another account already uses that code. Codes must be unique.');
}

async function uniqueRandomCode(env) {
  for (let len = 3; len <= 8; len++) {
    for (let i = 0; i < 20; i++) {
      const code = randomCode(len);
      const taken = await env.DB.prepare('SELECT 1 FROM accounts WHERE code = ?').bind(code).first();
      if (!taken) return code;
    }
  }
  throw new HttpError(500, 'Could not find a free code.');
}

function randomCode(len = 3) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  // alphabet length is 32, so modulo is unbiased
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

function randomToken() { return b64url(crypto.getRandomValues(new Uint8Array(32))); }
function randomId() { return b64url(crypto.getRandomValues(new Uint8Array(9))); }

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function nowSec() { return Math.floor(Date.now() / 1000); }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
