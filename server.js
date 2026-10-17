/*
 * server.js — 零依赖本地静态服务器
 * 用法:  node server.js [端口]
 *
 * 特性: ETag/304 协商缓存、文本资源 gzip、目录穿越防护、禁止目录列表。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname);
const PORT = parseInt(process.argv[2], 10) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.bin': 'application/octet-stream',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mcmeta': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

/* 值得压缩的类型 (png/bin 已经压过, 再 gzip 只是浪费 CPU) */
const COMPRESSIBLE = /^\.(html|js|css|json|txt|mcmeta|svg)$/;

/* gzip 结果缓存: 键 = ETag, 值 = Buffer */
const gzCache = new Map();
const GZ_CACHE_MAX = 48;

function sendError(res, code, text) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(code + ' ' + text);
}

/** 把 URL 路径规范化成 ROOT 之内的绝对路径, 不合法时返回 null */
function resolvePath(rawUrl) {
  let p;
  try {
    p = decodeURIComponent(new URL(rawUrl, 'http://localhost').pathname);
  } catch (e) {
    return null;
  }
  if (p === '/' || p === '') p = '/index.html';
  p = p.replace(/\\/g, '/');
  const safeParts = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.' || part === '..') continue;
    if (part.indexOf('\0') >= 0) return null;
    safeParts.push(part);
  }
  const file = path.join(ROOT, safeParts.join('/'));
  /* path.join 已经消掉了 .., 这里再确认一次确实在 ROOT 之内 */
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return null;
  return file;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendError(res, 405, 'Method Not Allowed');
  }
  const file = resolvePath(req.url);
  if (!file) return sendError(res, 403, 'Forbidden');

  fs.stat(file, (err, stat) => {
    if (err) return sendError(res, 404, 'Not Found');
    if (stat.isDirectory()) return sendError(res, 403, 'Forbidden: directory listing not allowed');

    const ext = path.extname(file).toLowerCase();
    const etag = 'W/"' + stat.size.toString(16) + '-' + Math.round(stat.mtimeMs).toString(16) + '"';
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      /* no-cache = 允许缓存但要回来验证, 改文件后刷新即可生效 */
      'Cache-Control': 'no-cache',
      'ETag': etag,
      'Last-Modified': stat.mtime.toUTCString(),
      'X-Content-Type-Options': 'nosniff'
    };

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }

    fs.readFile(file, (err2, data) => {
      if (err2) return sendError(res, 500, 'Read Error');
      const wantGzip = COMPRESSIBLE.test(ext) && data.length > 1024 &&
        /\bgzip\b/.test(req.headers['accept-encoding'] || '');

      const finish = (body, encoding) => {
        if (encoding) {
          headers['Content-Encoding'] = encoding;
          headers['Vary'] = 'Accept-Encoding';
        }
        headers['Content-Length'] = body.length;
        res.writeHead(200, headers);
        if (req.method === 'HEAD') res.end(); else res.end(body);
      };

      if (!wantGzip) return finish(data, null);

      const hit = gzCache.get(etag);
      if (hit) return finish(hit, 'gzip');

      zlib.gzip(data, (e, buf) => {
        if (e) return finish(data, null);
        if (gzCache.size >= GZ_CACHE_MAX) gzCache.clear();
        gzCache.set(etag, buf);
        finish(buf, 'gzip');
      });
    });
  });
});

server.listen(PORT, () => {
  console.log('==============================================');
  console.log('  Minecraft 1.16.5 网页版已启动');
  console.log('  请在浏览器打开:  http://localhost:' + PORT + '/');
  console.log('  (按 Ctrl+C 停止服务器)');
  console.log('==============================================');
});
