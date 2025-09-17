// 軽量バックエンド（依存なし / Node.js内蔵モジュールのみ）
// 使い方:
//   1) Node.jsをインストール
//   2) コマンド: node server/mini-backend.js
//   3) 既定ポート: 8787 で起動

const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const DATA_DIR = path.join(__dirname, 'data');
const QUESTIONS_FILE = path.join(DATA_DIR, 'questions.json');
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');
const DOWNLOAD_DIR = path.join(DATA_DIR, 'downloads');
const EXTRACT_DIR = path.join(DATA_DIR, 'extracted');

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(QUESTIONS_FILE)) fs.writeFileSync(QUESTIONS_FILE, '[]');
if (!fs.existsSync(PROGRESS_FILE)) fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ byQuestionId: {}, stat: { total: 0, correct: 0 } }));
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
fs.mkdirSync(EXTRACT_DIR, { recursive: true });
const { parsePdfText, extractQuestionsFromText } = require('./pdf');

function send(res, code, body, headers = {}) {
  const h = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...headers,
  };
  res.writeHead(code, h);
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : null);
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function mergeProgress(current, incoming) {
  const out = { byQuestionId: { ...current.byQuestionId }, stat: { ...current.stat } };
  const inc = incoming?.byQuestionId || {};
  for (const [qid, v] of Object.entries(inc)) {
    const a = out.byQuestionId[qid];
    if (!a || (v.updatedAt || 0) > (a.updatedAt || 0)) {
      out.byQuestionId[qid] = v;
    }
  }
  // statは簡易に再計算
  let total = 0, correct = 0;
  for (const v of Object.values(out.byQuestionId)) {
    total += (v.timesCorrect || 0) + (v.timesIncorrect || 0);
    correct += (v.timesCorrect || 0);
  }
  out.stat = { total, correct };
  return out;
}

const server = http.createServer(async (req, res) => {
  const { pathname } = url.parse(req.url);

  if (req.method === 'OPTIONS') {
    return send(res, 200, '');
  }

  if (req.method === 'GET' && pathname === '/api/health') {
    return send(res, 200, { ok: true });
  }

  // Simple proxy to fetch remote JSON/text (CORS bypass for the SPA)
  if (req.method === 'GET' && pathname === '/api/proxy') {
    const q = url.parse(req.url, true).query;
    const target = (q.url || '').toString();
    if (!/^https?:\/\//i.test(target)) return send(res, 400, { error: 'invalid url' });
    try {
      const data = await fetchRemote(target);
      // Return as text; client parses JSON
      return send(res, 200, data, { 'Content-Type': 'text/plain; charset=utf-8' });
    } catch (e) {
      return send(res, 502, { error: 'fetch failed' });
    }
  }

  // Parse a single PDF into raw text
  if (req.method === 'GET' && pathname === '/api/parse-pdf') {
    const q = url.parse(req.url, true).query;
    const rel = (q.file || '').toString();
    const abs = path.normalize(path.join(DATA_DIR, rel));
    if (!abs.startsWith(DATA_DIR)) return send(res, 400, { error: 'invalid path' });
    if (!fs.existsSync(abs)) return send(res, 404, { error: 'not found' });
    try {
      const { text, numPages } = await parsePdfText(abs);
      return send(res, 200, { ok: true, numPages, text });
    } catch (e) {
      return send(res, 500, { error: 'parse_failed' });
    }
  }

  // Extract questions from a single PDF and save as JSON under data/extracted
  if (req.method === 'POST' && pathname === '/api/extract-questions') {
    try {
      const body = await parseBody(req);
      const rel = body?.file || '';
      const meta = body?.meta || {};
      const abs = path.normalize(path.join(DATA_DIR, rel));
      if (!abs.startsWith(DATA_DIR)) return send(res, 400, { error: 'invalid path' });
      if (!fs.existsSync(abs)) return send(res, 404, { error: 'not found' });
      const { text } = await parsePdfText(abs);
      const questions = extractQuestionsFromText(text, meta);
      const outName = path.basename(rel, path.extname(rel)) + '.json';
      const outPath = path.join(EXTRACT_DIR, outName);
      fs.writeFileSync(outPath, JSON.stringify(questions, null, 2));
      return send(res, 200, { ok: true, count: questions.length, file: path.relative(DATA_DIR, outPath) });
    } catch (e) {
      return send(res, 500, { error: 'extract_failed' });
    }
  }

  // Extract questions for all PDFs under downloads/
  if (req.method === 'POST' && pathname === '/api/extract-all') {
    const files = fs.readdirSync(DOWNLOAD_DIR).filter(f => /\.pdf$/i.test(f));
    const results = [];
    for (const f of files) {
      try {
        const rel = path.relative(DATA_DIR, path.join(DOWNLOAD_DIR, f));
        const { text } = await parsePdfText(path.join(DOWNLOAD_DIR, f));
        const questions = extractQuestionsFromText(text, {});
        const outName = path.basename(f, path.extname(f)) + '.json';
        const outPath = path.join(EXTRACT_DIR, outName);
        fs.writeFileSync(outPath, JSON.stringify(questions, null, 2));
        results.push({ file: rel, count: questions.length, out: path.relative(DATA_DIR, outPath) });
      } catch (e) {
        results.push({ file: f, error: 'extract_failed' });
      }
    }
    return send(res, 200, { ok: true, results });
  }

  // Extract links from a remote HTML page (PDF by default; regex filter via ?pattern=)
  if (req.method === 'GET' && pathname === '/api/extract-links') {
    const q = url.parse(req.url, true).query;
    const target = (q.url || '').toString();
    if (!/^https?:\/\//i.test(target)) return send(res, 400, { error: 'invalid url' });
    try {
      const html = await fetchRemote(target);
      const list = extractLinks(html, target, q.pattern);
      return send(res, 200, list);
    } catch (e) {
      return send(res, 502, { error: 'fetch failed' });
    }
  }

  // Download all matching links from a page into server/data/downloads
  if (req.method === 'POST' && pathname === '/api/download') {
    const q = url.parse(req.url, true).query;
    const target = (q.url || '').toString();
    if (!/^https?:\/\//i.test(target)) return send(res, 400, { error: 'invalid url' });
    const pattern = q.pattern; // optional
    try {
      const html = await fetchRemote(target);
      const list = extractLinks(html, target, pattern);
      const results = [];
      for (const item of list) {
        try {
          const savedAs = await downloadIntoDir(item.href, DOWNLOAD_DIR);
          results.push({ href: item.href, file: path.relative(DATA_DIR, savedAs), ok: true });
        } catch (e) {
          results.push({ href: item.href, error: 'download_failed' });
        }
      }
      return send(res, 200, { ok: true, count: results.filter(r => r.ok).length, items: results });
    } catch (e) {
      return send(res, 502, { error: 'fetch failed' });
    }
  }

  if (pathname === '/api/questions') {
    if (req.method === 'GET') {
      return send(res, 200, readJson(QUESTIONS_FILE, []));
    }
    if (req.method === 'POST') {
      try {
        const body = await parseBody(req);
        if (!Array.isArray(body)) return send(res, 400, { error: 'questions must be array' });
        writeJson(QUESTIONS_FILE, body);
        return send(res, 200, { ok: true, count: body.length });
      } catch (e) {
        return send(res, 400, { error: 'bad json' });
      }
    }
  }

  if (pathname === '/api/progress') {
    if (req.method === 'GET') {
      return send(res, 200, readJson(PROGRESS_FILE, { byQuestionId: {}, stat: { total: 0, correct: 0 } }));
    }
    if (req.method === 'POST') {
      try {
        const incoming = await parseBody(req);
        if (!incoming || typeof incoming !== 'object') return send(res, 400, { error: 'progress must be object' });
        const current = readJson(PROGRESS_FILE, { byQuestionId: {}, stat: { total: 0, correct: 0 } });
        const merged = mergeProgress(current, incoming);
        writeJson(PROGRESS_FILE, merged);
        return send(res, 200, { ok: true });
      } catch (e) {
        return send(res, 400, { error: 'bad json' });
      }
    }
  }

  send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

function fetchRemote(target) {
  return new Promise((resolve, reject) => {
    const u = new URL(target);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      method: 'GET',
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      headers: { 'User-Agent': 'mini-backend/1.0' },
    }, r => {
      if (r.statusCode && r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        // one redirect hop
        try { resolve(fetchRemote(new URL(r.headers.location, u).toString())); } catch (e) { reject(e); }
        return;
      }
      const chunks = [];
      let size = 0;
      r.on('data', c => { size += c.length; if (size > 5 * 1024 * 1024) { req.destroy(); reject(new Error('too large')); } else chunks.push(c); });
      r.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    });
    req.on('error', reject);
    req.end();
  });
}

function extractLinks(html, baseUrl, pattern) {
  const out = [];
  const reA = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let filter;
  if (pattern) {
    try { filter = new RegExp(pattern, 'i'); } catch (_) { /* ignore invalid */ }
  }
  const defaultPdf = /\.pdf(\?|#|$)/i;
  let m;
  while ((m = reA.exec(html))) {
    const href = (m[2] || '').trim();
    const text = stripTags(m[3] || '').trim().replace(/\s+/g, ' ');
    if (filter ? !filter.test(href) : !defaultPdf.test(href)) continue;
    try {
      const abs = new URL(href, baseUrl).toString();
      out.push({ title: text || abs, href: abs });
    } catch (_) { /* ignore invalid */ }
  }
  const seen = new Set();
  return out.filter(x => (seen.has(x.href) ? false : seen.add(x.href)));
}

function sanitizeFilename(name) {
  return name.replace(/[\x00-\x1f\x7f<>:"/\\|?*]+/g, '_');
}

async function downloadIntoDir(href, dir) {
  const u = new URL(href);
  let base = decodeURIComponent(u.pathname.split('/').pop() || 'file');
  base = sanitizeFilename(base);
  if (!base) base = 'file';
  let dest = path.join(dir, base);
  // ensure unique
  if (fs.existsSync(dest)) {
    const ext = path.extname(base);
    const stem = path.basename(base, ext);
    let i = 1;
    do { dest = path.join(dir, `${stem}(${i})${ext}`); i++; } while (fs.existsSync(dest));
  }
  await downloadFile(href, dest);
  return dest;
}

function downloadFile(href, dest) {
  return new Promise((resolve, reject) => {
    const u = new URL(href);
    const lib = u.protocol === 'https:' ? https : http;
    const file = fs.createWriteStream(dest);
    const req = lib.get(href, (r) => {
      if (r.statusCode && r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        // follow one redirect
        file.close();
        fs.unlink(dest, () => {
          downloadFile(new URL(r.headers.location, u).toString(), dest).then(resolve).catch(reject);
        });
        return;
      }
      if (r.statusCode !== 200) { file.close(); fs.unlink(dest, () => reject(new Error('HTTP ' + r.statusCode))); return; }
      r.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
    });
    req.on('error', (e) => { file.close(); fs.unlink(dest, () => reject(e)); });
  });
}

function stripTags(s) { return String(s).replace(/<[^>]*>/g, ''); }
