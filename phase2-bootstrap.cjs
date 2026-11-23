'use strict';
const expressPath = require.resolve('express');
const originalExpress = require(expressPath);
const originalStatic = originalExpress.static;
let middlewareInstalled = false;

function instrumentedExpress(...args) {
  const app = originalExpress(...args);
  const originalUse = app.use;
  app.use = function(...handlers) {
    const result = originalUse.apply(this, handlers);
    if (!middlewareInstalled && handlers.some((handler) => handler?.name === 'jsonParser')) {
      // Security first, followed by additive workspace and creator-network routes.
      originalUse.call(this, require('./phase2-security.cjs'));
      originalUse.call(this, require('./phase3a-workspaces.cjs')());
      originalUse.call(this, inviteRedeemer);
      originalUse.call(this, require('./phase3b-social.cjs')());
      originalUse.call(this, healthAndResponseHardening);
      middlewareInstalled = true;
    }
    return result;
  };
  return app;
}
Object.assign(instrumentedExpress, originalExpress);
instrumentedExpress.static = function(root, options) {
  const serve = originalStatic(root, options);
  const path = require('node:path');
  const fs = require('node:fs');
  const base = path.resolve(root);
  return function(req, res, next) {
    if (req.method === 'GET' && (req.path === '/' || req.path === '/index.html')) {
      return fs.readFile(path.join(base, 'index.html'), 'utf8', (error, html) => {
        if (error) return next(error);
        const assets = '<link rel="stylesheet" href="/phase3b-style.css"><script src="/phase2.js" defer></script><script src="/phase3a-loader.js" defer></script><script src="/phase3b-loader.js" defer></script>';
        const output = html.includes('/phase3b-loader.js') ? html : html.replace(/<\/body>/i, `${assets}</body>`);
        return res.type('html').send(output);
      });
    }
    return serve(req, res, next);
  };
};

const workspaceModule = require('./phase3a-workspaces.cjs');
async function inviteRedeemer(req, res, next) {
  if (req.path === '/api/workspaces/invites/redeem' && req.method === 'POST') return workspaceModule.redeemInvite(req, res);
  next();
}
function healthAndResponseHardening(req, res, next) {
  if (req.path === '/healthz' && req.method === 'GET') return res.status(200).json({ ok: true });
  const send = res.json.bind(res);
  res.json = (body) => {
    if (req.path === '/api/health' && body && typeof body === 'object') {
      const session = body.session || {};
      const configured = body.providers || {};
      body = {
        ok: Boolean(body.ok),
        service: 'PK AI Tool',
        timestamp: body.timestamp,
        providers: {
          chat: Boolean(configured.llm),
          audio: Boolean(configured.speech),
          media: Boolean(configured.musicOrVisual)
        },
        session: {
          token: session.token,
          credits: session.credits,
          maxCredits: session.maxCredits,
          plan: session.plan || 'Free',
          paid: Boolean(session.paid || (session.plan && session.plan !== 'Free')),
          verified: Boolean(session.verified),
          kycStatus: session.kycStatus || 'not_started'
        },
        wallets: body.wallets || {}
      };
    }
    return send(body);
  };
  next();
}
require.cache[expressPath].exports = instrumentedExpress;
