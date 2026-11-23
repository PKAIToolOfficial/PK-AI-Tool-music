'use strict';
const crypto = require('node:crypto');
const sessions = new Map();
const rates = new Map();
const tickets = new Map();
const languages = new Set(['en', 'es', 'fr', 'de', 'pt', 'ar', 'ur', 'hi', 'zh', 'ja']);
const supported = new Set(['chat', 'image', 'photo', 'video', 'voice', 'audio', 'music', 'audio_enhance', 'noiz']);
const harmful = [
  /\b(?:child|minor|underage)\b.{0,50}\b(?:sex|sexual|nude|explicit|porn(?:ographic)?)\b/i,
  /\b(?:sex|sexual|nude|explicit|porn(?:ographic)?)\b.{0,50}\b(?:child|minor|underage)\b/i,
  /\b(?:make|build|assemble)\b.{0,40}\b(?:bomb|explosive|weapon)\b/i,
  /\b(?:kill|murder|attack)\b.{0,40}\b(?:person|people|school|workplace)\b/i
];
const exempt = new Set(['/api/health', '/api/security/pin/status', '/api/security/pin/setup', '/api/security/pin/verify', '/api/security/pin/change', '/api/preferences/language']);
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function getToken(req) { const token = String(req.get('x-session-token') || '').trim(); return /^[a-f0-9]{32,64}$/i.test(token) ? token : ''; }
function limit(req, res, key, max, windowMs) {
  const now = Date.now(); const entry = rates.get(key) || [];
  const recent = entry.filter((time) => now - time < windowMs);
  if (recent.length >= max) { res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' }); return false; }
  recent.push(now); rates.set(key, recent); return true;
}
function pinRecord(req) { const token = getToken(req); return token ? sessions.get(digest(token)) : null; }
function checkPasscode(record, passcode) {
  if (!record?.salt || !/^\d{4,5}$/.test(String(passcode || ''))) return false;
  const attempt = crypto.scryptSync(String(passcode), record.salt, 32);
  return crypto.timingSafeEqual(attempt, Buffer.from(record.hash, 'hex'));
}
function safeError(res, status, message) { return res.status(status).json({ error: message }); }
function containsHarmful(value) {
  if (typeof value === 'string') return harmful.some((pattern) => pattern.test(value));
  if (Array.isArray(value)) return value.some(containsHarmful);
  if (value && typeof value === 'object') return Object.values(value).some(containsHarmful);
  return false;
}
function json(res, status, body) { res.status(status).json(body); }

module.exports = function phase2Security(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  if (!req.path.startsWith('/api/')) return next();
  const ip = String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 100);
  if (!limit(req, res, `ip:${ip}`, 120, 60_000)) return;
  if (req.method === 'POST' && !limit(req, res, `post:${ip}`, 40, 60_000)) return;
  if (req.path === '/api/route' || req.path === '/api/assistant/chat') {
    if (!limit(req, res, `ai:${ip}`, 12, 60_000)) return;
    const prompt = req.body?.prompt;
    if (typeof prompt !== 'string' || !prompt.trim()) return safeError(res, 400, 'Please enter a prompt.');
    const max = ['voice', 'audio', 'audio_enhance'].includes(req.body?.action) ? 8000 : 12000;
    if (prompt.length > max) return safeError(res, 413, 'Your input is too long. Shorten it and try again.');
    if (containsHarmful(prompt)) return safeError(res, 400, 'This request cannot be processed. Please change the content and try again.');
    if (Array.isArray(req.body?.history) && (req.body.history.length > 20 || req.body.history.some((item) => typeof item?.content !== 'string' || item.content.length > 8000))) return safeError(res, 400, 'Conversation history is invalid or too long.');
  }
  if (req.path === '/api/security/pin/status' && req.method === 'GET') {
    const token = getToken(req);
    if (!token) return json(res, 200, { ok: true, configured: false });
    const record = sessions.get(digest(token));
    return json(res, 200, { ok: true, configured: Boolean(record?.salt), unlocked: Boolean(record && tickets.get(digest(token))?.expires > Date.now()) });
  }
  if (req.path === '/api/security/pin/setup' && req.method === 'POST') {
    if (!limit(req, res, `pin:${ip}`, 5, 15 * 60_000)) return;
    const token = getToken(req); const pin = String(req.body?.pin || '');
    if (!token) return safeError(res, 401, 'Start or refresh your session, then try again.');
    if (!/^\d{4,5}$/.test(pin)) return safeError(res, 400, 'Choose a 4- or 5-digit PIN.');
    const id = digest(token); const salt = crypto.randomBytes(16).toString('hex'); const hash = crypto.scryptSync(pin, salt, 32).toString('hex');
    sessions.set(id, { salt, hash }); tickets.delete(id);
    return json(res, 201, { ok: true, configured: true, message: 'PIN set. You will need it to unlock this session.' });
  }
  if (req.path === '/api/security/pin/verify' && req.method === 'POST') {
    if (!limit(req, res, `pin:${ip}`, 8, 15 * 60_000)) return;
    const token = getToken(req); const record = token && sessions.get(digest(token));
    if (!record?.salt) return safeError(res, 404, 'No PIN is configured for this session.');
    if (!checkPasscode(record, req.body?.pin)) return safeError(res, 401, 'That PIN is incorrect.');
    const id = digest(token); const ticket = crypto.randomBytes(32).toString('hex'); tickets.set(id, { value: digest(ticket), expires: Date.now() + 15 * 60_000 });
    return json(res, 200, { ok: true, ticket, expiresIn: 900 });
  }
  if (req.path === '/api/security/pin/change' && req.method === 'POST') {
    if (!limit(req, res, `pin:${ip}`, 5, 15 * 60_000)) return;
    const token = getToken(req); const id = token && digest(token); const record = id && sessions.get(id);
    if (!record || !checkPasscode(record, req.body?.currentPin)) return safeError(res, 401, 'The current PIN could not be verified.');
    const pin = String(req.body?.newPin || ''); if (!/^\d{4,5}$/.test(pin)) return safeError(res, 400, 'Choose a 4- or 5-digit PIN.');
    const salt = crypto.randomBytes(16).toString('hex'); sessions.set(id, { salt, hash: crypto.scryptSync(pin, salt, 32).toString('hex') }); tickets.delete(id);
    return json(res, 200, { ok: true, message: 'PIN changed.' });
  }
  if (req.path === '/api/preferences/language' && ['GET', 'PUT'].includes(req.method)) {
    const token = getToken(req); if (!token) return safeError(res, 401, 'Session required.');
    const id = digest(token); const record = sessions.get(id) || {};
    if (req.method === 'PUT') {
      const language = String(req.body?.language || '').toLowerCase();
      if (!languages.has(language)) return safeError(res, 400, 'Choose a supported language.');
      record.language = language; sessions.set(id, record);
    }
    return json(res, 200, { ok: true, language: record.language || null, supported: [...languages] });
  }
  if (exempt.has(req.path)) return next();
  const token = getToken(req); const id = token && digest(token); const pin = id && sessions.get(id); const ticket = id && tickets.get(id);
  if (pin?.salt && (!ticket || ticket.expires < Date.now() || digest(String(req.get('x-app-pin-ticket') || '')) !== ticket.value)) return safeError(res, 423, 'Unlock this session with your PIN to continue.');
  if (req.method === 'POST' && containsHarmful(req.body)) return safeError(res, 400, 'This request cannot be processed. Please change the content and try again.');
  if (req.path === '/api/payments/crypto' || req.path === '/api/plans/verify-crypto') {
    if (typeof req.body?.txid !== 'string' || req.body.txid.trim().length < 8 || req.body.txid.length > 200) return safeError(res, 400, 'Enter a valid transaction reference.');
  }
  if (req.path.startsWith('/api/tracks/') && !/^[a-zA-Z0-9_-]{1,100}$/.test(req.params?.id || req.path.split('/').pop())) return safeError(res, 400, 'Invalid item reference.');
  return next();
};
