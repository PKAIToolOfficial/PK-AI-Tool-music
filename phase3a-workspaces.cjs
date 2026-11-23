'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const workspaces = new Map();
const inviteIndex = new Map();
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : null;
const file = dataDir ? path.join(dataDir, 'phase3a-workspaces.json') : null;
if (file) {
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const workspace of saved.workspaces || []) workspaces.set(workspace.id, workspace);
    for (const item of saved.invites || []) inviteIndex.set(item.tokenHash, item);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Workspace data could not be loaded.');
  }
}
function persist() {
  if (!file) return;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ workspaces: [...workspaces.values()], invites: [...inviteIndex.values()] }), { mode: 0o600 });
    fs.renameSync(temp, file);
  } catch (_) { console.error('Workspace changes could not be persisted.'); }
}
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
function tokenFrom(req) { const token = String(req.get('x-session-token') || '').trim(); return /^[a-f0-9]{32,64}$/i.test(token) ? token : ''; }
async function paidSession(req) {
  const token = tokenFrom(req);
  if (!token) return null;
  try {
    const origin = `http://127.0.0.1:${process.env.PORT || 3000}`;
    const response = await fetch(`${origin}/api/health`, { headers: { 'x-session-token': token }, signal: AbortSignal.timeout(2500) });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload.session?.paid ? { tokenHash: digest(token), token, plan: payload.session.plan } : null;
  } catch (_) { return null; }
}
function validText(value, max) { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max; }
function safeTarget(raw) {
  let parsed;
  try { parsed = new URL(String(raw)); } catch (_) { return null; }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '0.0.0.0' || host === '::1' || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return null;
  const allowedHttp = ['wa.me', 'api.whatsapp.com'];
  if (parsed.protocol === 'http:' && !allowedHttp.includes(host)) return null;
  return parsed.href;
}
function member(workspace, hash) { return workspace.members.find((entry) => entry.tokenHash === hash); }
function canEdit(role) { return ['owner', 'admin', 'editor'].includes(role); }
function routeResponse(res, status, body) { res.status(status).json(body); }

module.exports = function workspaceRoutes() {
  return async function handleWorkspaceRoutes(req, res, next) {
    if (!req.path.startsWith('/api/workspaces')) return next();
    if (!['GET', 'POST', 'DELETE'].includes(req.method)) return routeResponse(res, 405, { error: 'Method not allowed.' });
    const session = await paidSession(req);
    if (!session) return routeResponse(res, 403, { error: 'Workspace tools require an active paid plan.' });
    const parts = req.path.split('/').filter(Boolean);
    try {
      if (parts.length === 2 && req.method === 'GET') {
        const own = [...workspaces.values()].filter((item) => member(item, session.tokenHash)).map(({ id, name, createdAt, members }) => ({ id, name, createdAt, role: member({ members }, session.tokenHash).role }));
        return routeResponse(res, 200, { ok: true, workspaces: own });
      }
      if (parts.length === 2 && req.method === 'POST') {
        const name = req.body?.name;
        if (!validText(name, 80)) return routeResponse(res, 400, { error: 'Workspace name must be 1–80 characters.' });
        const workspace = { id: crypto.randomUUID(), name: name.trim(), createdAt: new Date().toISOString(), ownerHash: session.tokenHash, members: [{ tokenHash: session.tokenHash, role: 'owner', joinedAt: new Date().toISOString() }], links: [], invites: [] };
        workspaces.set(workspace.id, workspace); persist();
        return routeResponse(res, 201, { ok: true, workspace: { id: workspace.id, name: workspace.name, role: 'owner', links: [], members: [{ role: 'owner' }] } });
      }
      const id = parts[2]; const workspace = workspaces.get(id);
      if (!workspace) return routeResponse(res, 404, { error: 'Workspace not found.' });
      const access = member(workspace, session.tokenHash);
      if (!access) return routeResponse(res, 403, { error: 'Workspace access denied.' });
      if (parts.length === 3 && req.method === 'GET') return routeResponse(res, 200, { ok: true, workspace: { id: workspace.id, name: workspace.name, createdAt: workspace.createdAt, role: access.role, links: workspace.links, members: workspace.members.map(({ role, joinedAt }) => ({ role, joinedAt })), invites: access.role === 'owner' || access.role === 'admin' ? workspace.invites.map(({ id: inviteId, email, role, createdAt, expiresAt }) => ({ id: inviteId, email, role, createdAt, expiresAt })) : [] } });
      if (parts[3] === 'links' && req.method === 'POST') {
        if (!canEdit(access.role)) return routeResponse(res, 403, { error: 'You do not have permission to edit this workspace.' });
        const title = req.body?.title; const url = safeTarget(req.body?.url); const category = String(req.body?.category || 'work');
        if (!validText(title, 80) || !url || !['social', 'messaging', 'work'].includes(category)) return routeResponse(res, 400, { error: 'Enter a valid title and secure public web address.' });
        const link = { id: crypto.randomUUID(), title: title.trim(), url, category, createdAt: new Date().toISOString(), addedBy: session.tokenHash };
        workspace.links.push(link); persist(); return routeResponse(res, 201, { ok: true, link });
      }
      if (parts[3] === 'links' && parts[4] && req.method === 'DELETE') {
        if (!canEdit(access.role)) return routeResponse(res, 403, { error: 'You do not have permission to edit this workspace.' });
        const before = workspace.links.length; workspace.links = workspace.links.filter((link) => link.id !== parts[4]);
        if (before === workspace.links.length) return routeResponse(res, 404, { error: 'Link not found.' });
        persist(); return routeResponse(res, 200, { ok: true });
      }
      if (parts[3] === 'invites' && req.method === 'POST') {
        if (!['owner', 'admin'].includes(access.role)) return routeResponse(res, 403, { error: 'Only workspace owners and admins can invite members.' });
        const email = String(req.body?.email || '').trim().toLowerCase(); const role = String(req.body?.role || 'editor');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return routeResponse(res, 400, { error: 'Enter a valid invite email address.' });
        if (!['admin', 'editor', 'viewer'].includes(role)) return routeResponse(res, 400, { error: 'Choose an allowed team role.' });
        if (workspace.members.length >= 50) return routeResponse(res, 409, { error: 'This workspace has reached its member limit.' });
        const rawToken = crypto.randomBytes(32).toString('base64url'); const invite = { id: crypto.randomUUID(), email, role, tokenHash: digest(rawToken), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), invitedBy: session.tokenHash };
        workspace.invites.push(invite); inviteIndex.set(invite.tokenHash, { workspaceId: workspace.id, inviteId: invite.id }); persist();
        const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
        return routeResponse(res, 201, { ok: true, invite: { email, role, expiresAt: invite.expiresAt, url: `${baseUrl}/?workspace_invite=${encodeURIComponent(rawToken)}`, delivery: 'copy_link' }, message: 'Invite created. Copy and share the invite link securely; this service does not send email.' });
      }
      if (parts[3] === 'members' && parts[4] && req.method === 'DELETE') {
        if (!['owner', 'admin'].includes(access.role)) return routeResponse(res, 403, { error: 'Only workspace owners and admins can manage members.' });
        const target = workspace.members.find((item) => item.tokenHash === parts[4]);
        if (!target || target.role === 'owner' || (access.role === 'admin' && target.role === 'admin')) return routeResponse(res, 404, { error: 'Member not found or cannot be removed.' });
        workspace.members = workspace.members.filter((item) => item !== target); persist(); return routeResponse(res, 200, { ok: true });
      }
      if (parts[3] === 'members' && parts[4] && req.method === 'POST') {
        if (!['owner', 'admin'].includes(access.role)) return routeResponse(res, 403, { error: 'Only workspace owners and admins can manage members.' });
        const target = workspace.members.find((item) => item.tokenHash === parts[4]); const role = String(req.body?.role || '');
        if (!target || target.role === 'owner' || !['admin', 'editor', 'viewer'].includes(role) || (access.role === 'admin' && role === 'admin')) return routeResponse(res, 400, { error: 'Member or role is invalid.' });
        target.role = role; persist(); return routeResponse(res, 200, { ok: true, role });
      }
      return routeResponse(res, 404, { error: 'Workspace action not found.' });
    } catch (error) {
      console.error('Workspace operation failed:', error.message);
      return routeResponse(res, 500, { error: 'Workspace request could not be completed.' });
    }
  };
};

// A separate invite redemption endpoint is handled before normal workspace path matching.
module.exports.redeemInvite = async function redeemInvite(req, res) {
  const token = String(req.body?.token || '').trim();
  const hash = digest(token); const index = inviteIndex.get(hash);
  if (!index) return routeResponse(res, 404, { error: 'Invite is invalid or expired.' });
  const workspace = workspaces.get(index.workspaceId); const invite = workspace?.invites.find((item) => item.id === index.inviteId && item.tokenHash === hash);
  if (!workspace || !invite || Date.parse(invite.expiresAt) < Date.now()) return routeResponse(res, 410, { error: 'Invite is invalid or expired.' });
  const session = await paidSession(req); if (!session) return routeResponse(res, 403, { error: 'Workspace access requires an active paid plan.' });
  if (workspace.members.some((item) => item.tokenHash === session.tokenHash)) return routeResponse(res, 409, { error: 'You are already a workspace member.' });
  workspace.members.push({ tokenHash: session.tokenHash, role: invite.role, joinedAt: new Date().toISOString() });
  workspace.invites = workspace.invites.filter((item) => item.id !== invite.id); inviteIndex.delete(hash); persist();
  return routeResponse(res, 200, { ok: true, workspace: { id: workspace.id, name: workspace.name, role: invite.role }, message: 'You joined the workspace.' });
};
module.exports.inviteIndex = inviteIndex;
