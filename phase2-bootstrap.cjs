'use strict';
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const security = require('./phase2-security.cjs');

// Keep the app's original middleware and routes intact. The wrapper only adds
// the Phase 2 API layer after static files, and injects its UI bootstrap script.
const originalStatic = express.static;
express.static = function phase2Static(root, options) {
  const staticHandler = originalStatic(root, options);
  const publicRoot = path.resolve(root);
  return function staticWithPhase2(req, res, next) {
    if (req.method === 'GET' && (req.path === '/' || req.path === '/index.html')) {
      fs.readFile(path.join(publicRoot, 'index.html'), 'utf8', (error, html) => {
        if (error) return next(error);
        const script = '<script src="/phase2.js" defer></script>';
        const output = html.includes('/phase2.js') ? html : html.replace(/<\/body>/i, `${script}</body>`);
        res.status(200).type('html').send(output);
      });
      return;
    }
    staticHandler(req, res, (error) => error ? next(error) : security(req, res, next));
  };
};
