const url = require('url');
const appHandler = require('../server');

module.exports = (req, res) => {
  try {
    const parsed = url.parse(req.url || '/', true);
    const q = { ...(parsed.query || {}), ...(req.query || {}) };
    const pathname = parsed.pathname || '/';

    if (q.__vpath && !String(q.__vpath).includes('$')) {
      const targetPath = Array.isArray(q.__vpath) ? q.__vpath[0] : q.__vpath;
      delete q.__vpath;
      delete q.path;
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) {
        if (Array.isArray(v)) v.forEach(item => qs.append(k, item));
        else if (v !== undefined && v !== null) qs.append(k, String(v));
      }
      const queryStr = qs.toString();
      req.url = targetPath + (queryStr ? '?' + queryStr : '');
    } else if (pathname.includes('[...path]') || pathname.startsWith('/api/index')) {
      let targetPath = '';
      if (q.path) {
        const segs = Array.isArray(q.path) ? q.path : String(q.path).split('/');
        targetPath = '/api/' + segs.filter(Boolean).join('/');
        delete q.path;
      } else {
        const origUri =
          req.headers['x-vercel-original-uri'] ||
          req.headers['x-forwarded-uri'] ||
          req.headers['x-rewrite-url'];
        if (origUri && !origUri.includes('[...path]') && !origUri.startsWith('/api/index')) {
          req.url = origUri;
          return appHandler(req, res);
        }
      }
      if (targetPath) {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(q)) {
          if (Array.isArray(v)) v.forEach(item => qs.append(k, item));
          else if (v !== undefined && v !== null) qs.append(k, String(v));
        }
        const queryStr = qs.toString();
        req.url = targetPath + (queryStr ? '?' + queryStr : '');
      }
    }
  } catch (err) {
    console.error('[Vercel Adapter Error]', err);
  }

  return appHandler(req, res);
};
