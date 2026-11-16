// Vercel Serverless Function entry point
const url = require('url');
const appHandler = require('../server');

module.exports = (req, res) => {
  try {
    const parsed = url.parse(req.url || '/', true);
    const q = { ...(parsed.query || {}) };

    if (q.__vpath) {
      const targetPath = Array.isArray(q.__vpath) ? q.__vpath[0] : q.__vpath;
      delete q.__vpath;
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) {
        if (Array.isArray(v)) v.forEach(item => qs.append(k, item));
        else if (v !== undefined && v !== null) qs.append(k, String(v));
      }
      const queryStr = qs.toString();
      req.url = targetPath + (queryStr ? '?' + queryStr : '');
    } else if (req.url && req.url.startsWith('/api/index')) {
      const origUri =
        req.headers['x-vercel-original-uri'] ||
        req.headers['x-forwarded-uri'] ||
        req.headers['x-rewrite-url'];
      if (origUri) {
        req.url = origUri;
      }
    }
  } catch (err) {
    console.error('[Vercel Adapter Error]', err);
  }

  return appHandler(req, res);
};
