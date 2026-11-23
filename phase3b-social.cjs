'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const profiles = new Map();
const follows = new Map();
const referrals = new Map();
const signupReferrals = new Map();
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : null;
const file = dataDir ? path.join(dataDir, 'phase3b-social.json') : null;

if (file) {
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const profile of saved.profiles || []) profiles.set(profile.tokenHash, profile);
    for (const [key, value] of Object.entries(saved.follows || {})) follows.set(key, new Set(value));
    for (const referral of saved.referrals || []) referrals.set(referral.tokenHash, referral);
    for (const event of saved.signupReferrals || []) signupReferrals.set(event.id, event);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Profile data could not be loaded.');
  }
}

function persist() {
  if (!file) return;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({
      profiles: [...profiles.values()],
      follows: Object.fromEntries([...follows.entries()].map(([key, value]) => [key, [...value]])),
      referrals: [...referrals.values()],
      signupReferrals: [...signupReferrals.values()]
    }), { mode: 0o600 });
    fs.renameSync(temp, file);
  } catch (_) { console.error('Profile changes could not be persisted.'); }
}

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const tokenHashFrom = (req) => {
  const token = String(req.get('x-session-token') || '').trim();
  return /^[a-f0-9]{32,64}$/i.test(token) ? digest(token) : null;
};

async function currentSession(req) {
  const token = String(req.get('x-session-token') || '').trim();
  if (!/^\d?[a-f0-9]{32,64}$/i.test(token) && !/^[a-f0-9]{32,64}$/i.test(token)) return null;
  try {
    const origin = `http://127.0.0.1:${process.env.PORT || 3000}`;
    const response = await fetch(`${origin}/api/health`, { headers: { 'x-session-token': token }, signal: AbortSignal.timeout(2500) });
    if (!response.ok) return null;
    const payload = await response.json();
    if (!payload.session?.token) return null;
    return { token, tokenHash: digest(token), paid: Boolean(payload.session.paid), verified: Boolean(payload.session.verified), plan: payload.session.plan };
  } catch (_) { return null; }
}

function safeUrl(raw) {
  try {
    const url = new URL(String(raw).trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '0.0.0.0' || host === '::1' || host.endsWith('.localhost') || host.endsWith('.local') || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return null;
    return url.href;
  } catch (_) { return null; }
}

function validSlug(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{2,29}$/.test(value.toLowerCase());
}
function profileSlug(profile) { return profile.slug || profile.tokenHash.slice(0, 12); }
function isSlugTaken(slug, ownHash) {
  for (const profile of profiles.values()) {
    if (profile.tokenHash !== ownHash && profileSlug(profile) === slug) return true;
  }
  return false;
}
function publicProfile(profile) {
  if (!profile) return null;
  const followers = followersCount(profile.tokenHash);
  const following = followingCount(profile.tokenHash);
  return {
    slug: profileSlug(profile),
    displayName: profile.displayName,
    bio: profile.bio || '',
    avatarUrl: profile.avatarUrl || null,
    coverUrl: profile.coverUrl || null,
    socialLinks: profile.socialLinks || [],
    verified: Boolean(profile.verified),
    followers,
    following
  };
}
function followersCount(tokenHash) {
  let count = 0;
  for (const targets of follows.values()) if (targets.has(tokenHash)) count++;
  return count;
}
function followingCount(tokenHash) { return (follows.get(tokenHash)?.size || 0); }
function referralCode(tokenHash) {
  let referral = referrals.get(tokenHash);
  if (!referral) {
    const code = base62(crypto.randomBytes(6)).replace(/[^A-Za-z0-9]/g, '').slice(0, 10).toUpperCase();
    referral = { tokenHash, code: code || crypto.randomBytes(5).toString('hex').toUpperCase(), signups: 0, conversions: 0, createdAt: new Date().toISOString() };
    referrals.set(tokenHash, referral);
    persist();
  }
  return referral;
}
function base62(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = Buffer.from(buffer).readBigUInt64BE();
  let output = '';
  while (value > 0n) { output = alphabet[Number(value % 62n)] + output; value /= 62n; }
  return output;
}

module.exports = function socialRoutes() {
  return async function handleSocialRoutes(req, res, next) {
    if (!req.path.startsWith('/api/profile') && !req.path.startsWith('/api/follows') && !req.path.startsWith('/api/referrals')) return next();

    try {
      if (req.path === '/api/profile/me' && req.method === 'GET') {
        const session = await currentSession(req);
        if (!session) return res.status(401).json({ error: 'Session required.' });
        let profile = profiles.get(session.tokenHash);
        if (!profile) {
          profile = { tokenHash: session.tokenHash, slug: session.tokenHash.slice(0, 12), displayName: 'Creator', bio: '', avatarUrl: null, coverUrl: null, socialLinks: [], verified: session.verified || session.paid, createdAt: new Date().toISOString() };
          profiles.set(session.tokenHash, profile); persist();
        }
        profile.verified = Boolean(session.verified || session.paid);
        persist();
        return res.json({ ok: true, profile: { ...publicProfile(profile), referralCode: referralCode(session.tokenHash).code } });
      }

      if (req.path === '/api/profile/me' && req.method === 'PUT') {
        const session = await currentSession(req);
        if (!session) return res.status(401).json({ error: 'Session required.' });
        const displayName = String(req.body?.displayName || '').trim();
        const bio = String(req.body?.bio || '').trim();
        const slug = String(req.body?.slug || '').trim().toLowerCase();
        const avatarUrl = req.body?.avatarUrl ? safeUrl(req.body.avatarUrl) : null;
        const coverUrl = req.body?.coverUrl ? safeUrl(req.body.coverUrl) : null;
        if (!validSlug(slug)) return res.status(400).json({ error: 'Profile address must be 3–30 characters using letters, numbers, underscores or hyphens.' });
        if (displayName.length < 1 || displayName.length > 50) return res.status(400).json({ error: 'Display name must be 1–50 characters.' });
        if (bio.length > 300) return res.status(400).json({ error: 'Bio must be 300 characters or fewer.' });
        if (req.body?.avatarUrl && !avatarUrl) return res.status(400).json({ error: 'Avatar address is not a valid public web address.' });
        if (req.body?.coverUrl && !coverUrl) return res.status(400).json({ error: 'Cover address is not a valid public web address.' });
        if (isSlugTaken(slug, session.tokenHash)) return res.status(409).json({ error: 'That profile address is already in use.' });

        const rawLinks = Array.isArray(req.body?.socialLinks) ? req.body.socialLinks : [];
        if (rawLinks.length > 12) return res.status(400).json({ error: 'No more than 12 social links are allowed.' });
        const socialLinks = [];
        for (const link of rawLinks) {
          const label = String(link?.label || '').trim();
          const url = safeUrl(link?.url);
          if (!label || label.length > 40) return res.status(400).json({ error: 'A social link label is invalid.' });
          if (!url) return res.status(400).json({ error: 'A social link is not a valid public web address.' });
          socialLinks.push({ label, url });
        }

        let profile = profiles.get(session.tokenHash);
        profile = { ...(profile || { tokenHash: session.tokenHash, createdAt: new Date().toISOString() }), slug, displayName, bio, avatarUrl, coverUrl, socialLinks, verified: Boolean(session.verified || session.paid), updatedAt: new Date().toISOString() };
        profiles.set(session.tokenHash, profile); persist();
        return res.json({ ok: true, profile: publicProfile(profile) });
      }

      if (req.path.startsWith('/api/profile/') && req.method === 'GET') {
        const slug = decodeURIComponent(req.path.split('/').pop()).toLowerCase();
        let profile = null;
        for (const item of profiles.values()) if (profileSlug(item) === slug) { profile = item; break; }
        if (!profile) return res.status(404).json({ error: 'Creator profile not found.' });
        const viewer = await currentSession(req);
        const result = publicProfile(profile);
        result.viewerFollowing = Boolean(viewer && (follows.get(viewer.tokenHash)?.has(profile.tokenHash)));
        return res.json({ ok: true, profile: result });
      }

      if (req.path.startsWith('/api/follows/') && ['POST', 'DELETE'].includes(req.method)) {
        const slug = decodeURIComponent(req.path.split('/').pop()).toLowerCase();
        let target = null;
        for (const item of profiles.values()) if (profileSlug(item) === slug) { target = item; break; }
        if (!target) return res.status(404).json({ error: 'Creator profile not found.' });
        const session = await currentSession(req);
        if (!session) return res.status(401).json({ error: 'Session required.' });
        if (session.tokenHash === target.tokenHash) return res.status(400).json({ error: 'You cannot follow your own profile.' });
        const set = follows.get(session.tokenHash) || new Set();
        if (req.method === 'POST') set.add(target.tokenHash); else set.delete(target.tokenHash);
        follows.set(session.tokenHash, set); persist();
        return res.json({ ok: true, following: req.method === 'POST', followers: followersCount(target.tokenHash), following: followingCount(target.tokenHash) });
      }

      if (req.path === '/api/referrals/me' && req.method === 'GET') {
        const session = await currentSession(req);
        if (!session) return res.status(401).json({ error: 'Session required.' });
        const referral = referralCode(session.tokenHash);
        const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
        const events = [...signupReferrals.values()].filter((event) => event.referrerHash === session.tokenHash);
        return res.json({ ok: true, code: referral.code, link: `${baseUrl}/?ref=${encodeURIComponent(referral.code)}`, signups: referral.signups, conversions: referral.conversions, events: events.map(({ createdAt, convertedAt }) => ({ createdAt, convertedAt: convertedAt || null })) });
      }

      if (req.path === '/api/referrals/track' && req.method === 'POST') {
        const code = String(req.body?.code || '').trim().toUpperCase();
        if (!code || code.length > 32) return res.status(400).json({ error: 'Invalid referral code.' });
        let referrer = null;
        for (const referral of referrals.values()) if (referral.code === code) { referrer = referral; break; }
        if (!referrer) return res.status(404).json({ error: 'Referral code not found.' });
        const session = await currentSession(req);
        if (!session) return res.status(401).json({ error: 'Session required.' });
        if (session.tokenHash === referrer.tokenHash) return res.status(400).json({ error: 'You cannot refer your own account.' });
        const id = session.tokenHash;
        if (!signupReferrals.has(id)) {
          signupReferrals.set(id, { id, referrerHash: referrer.tokenHash, createdAt: new Date().toISOString(), convertedAt: null });
          referrer.signups += 1;
          persist();
        }
        return res.json({ ok: true, tracked: true });
      }

      if (req.path === '/api/referrals/convert' && req.method === 'POST') {
        const session = await currentSession(req);
        if (!session) return res.status(401).json({ error: 'Session required.' });
        if (!session.paid) return res.status(400).json({ error: 'Paid conversion has not been verified.' });
        const event = signupReferrals.get(session.tokenHash);
        if (!event || event.convertedAt) return res.json({ ok: true, converted: false });
        event.convertedAt = new Date().toISOString();
        const referrer = referrals.get(event.referrerHash);
        if (referrer) referrer.conversions += 1;
        persist();
        return res.json({ ok: true, converted: true });
      }

      return res.status(404).json({ error: 'Route not found.' });
    } catch (_) {
      return res.status(500).json({ error: 'The request could not be completed.' });
    }
  };
};
