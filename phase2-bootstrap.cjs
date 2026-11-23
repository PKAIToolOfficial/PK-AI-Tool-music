'use strict';
const crypto = require('node:crypto');
const expressPath = require.resolve('express');
const originalExpress = require(expressPath);
let middlewareInstalled = false;
const originalStatic = originalExpress.static;
function instrumentedExpress(...args) {
  const app = originalExpress(...args); const originalUse = app.use;
  app.use = function(...handlers) {
    const result = originalUse.apply(this, handlers);
    if (!middlewareInstalled && handlers.some((handler) => handler?.name === 'jsonParser')) {
      originalUse.call(this, require('./phase3a-workspaces.cjs')());
      originalUse.call(this, inviteRedeemer);
      middlewareInstalled = true;
    }
    return result;
  };
  return app;
}
Object.assign(instrumentedExpress, originalExpress);
instrumentedExpress.static = function(root, options) {
  const serve = originalStatic(root, options); const path = require('node:path'); const fs = require('node:fs'); const base = path.resolve(root);
  return function(req, res, next) {
    if (req.method === 'GET' && (req.path === '/' || req.path === '/index.html')) return fs.readFile(path.join(base, 'index.html'), 'utf8', (error, html) => { if (error) return next(error); const tag = '<script src="/phase3a-loader.js" defer></script>'; return res.type('html').send(html.includes('/phase3a-loader.js') ? html : html.replace(/<\/body>/i, `${tag}</body>`)); });
    return serve(req, res, next);
  };
};
const workspaceModule = require('./phase3a-workspaces.cjs');
async function inviteRedeemer(req, res, next) {
  if (req.path === '/api/workspaces/invites/redeem' && req.method === 'POST') return workspaceModule.redeemInvite(req, res);
  next();
}
require.cache[expressPath].exports = instrumentedExpress;
