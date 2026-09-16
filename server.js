/*
 * server.js — 零依赖本地静态服务器
 * 用法:  node server.js [端口]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

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

const server = http.createServer((req, res) => {
  /* 只允许 GET 和 HEAD */
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end('405 Method Not Allowed');
    return;
  }

  let p = decodeURIComponent(url.parse(req.url).pathname);
  if (p === '/') p = '/index.html';

  /* 严格路径规范化: 移除 . 和 ..，禁止反斜杠 */
  p = p.replace(/\\/g, '/');
  const parts = p.split('/').filter(Boolean);
  const safeParts = [];
  for (const part of parts) {
    if (part === '.' || part === '..') continue;
    safeParts.push(part);
  }
  p = '/' + safeParts.join('/');

  const file = path.join(ROOT, path.normalize(p));

  /* 确保路径在 ROOT 之下 (防止目录穿越) */
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('403 Forbidden');
    return;
  }

  /* 禁止目录列表: 如果是目录且没有 index.html，返回 403 */
  try {
    const stat = fs.statSync(file);
    if (stat.isDirectory()) {
      res.writeHead(403);
      res.end('403 Forbidden: directory listing not allowed');
      return;
    }
  } catch (e) {
    /* 文件不存在，稍后会返回 404 */
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + p);
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('==============================================');
  console.log('  Minecraft 1.16.5 网页版已启动');
  console.log('  请在浏览器打开:  http://localhost:' + PORT + '/');
  console.log('  (按 Ctrl+C 停止服务器)');
  console.log('==============================================');
});
