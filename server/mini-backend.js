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
// Path to pdftoppm (Poppler). Allow overriding via env to avoid PATH issues on Windows.
const PDFTOPPM = process.env.PDFTOPPM || process.env.POPPLER_BIN || 'pdftoppm';
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
const { parsePdfText, extractQuestionsFromText } = require('./pdf2');
const { createWorker } = require('tesseract.js');
const ImportNormalizer = require('../import-normalizer');

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

  // Check if pdftoppm (Poppler) is available from this Node process
  if (req.method === 'GET' && pathname === '/api/ocr-check') {
    try {
      const { spawnSync } = require('child_process');
      const r = spawnSync(PDFTOPPM, ['-v'], { encoding: 'utf-8' });
      const out = (r.stdout || '') + (r.stderr || '');
      const found = (r.status === 0) || /pdftoppm/i.test(out);
      return send(res, 200, { found, bin: PDFTOPPM, stdout: r.stdout || '', stderr: r.stderr || '' });
    } catch (e) {
      return send(res, 200, { found: false, bin: PDFTOPPM });
    }
  }

  // Questions store
  if (req.method === 'GET' && pathname === '/api/questions') {
    const qs = readJson(QUESTIONS_FILE, []);
    return send(res, 200, qs);
  }
  if (req.method === 'POST' && pathname === '/api/questions') {
    try {
      const body = await parseBody(req);
      const list = Array.isArray(body) ? body : [];
      const { valid, invalidReasons } = ImportNormalizer.normalizeQuestions(list);
      const byId = new Map(valid.filter(x => x && x.id).map(x => [x.id, x]));
      writeJson(QUESTIONS_FILE, Array.from(byId.values()));
      return send(res, 200, { ok: true, count: byId.size, skipped: invalidReasons.length });
    } catch (e) {
      return send(res, 400, { error: 'invalid_questions' });
    }
  }

  // Progress store
  if (req.method === 'GET' && pathname === '/api/progress') {
    const pr = readJson(PROGRESS_FILE, { byQuestionId: {}, stat: { total: 0, correct: 0 } });
    return send(res, 200, pr);
  }
  if (req.method === 'POST' && pathname === '/api/progress') {
    try {
      const body = await parseBody(req);
      const current = readJson(PROGRESS_FILE, { byQuestionId: {}, stat: { total: 0, correct: 0 } });
      const merged = mergeProgress(current, body || {});
      writeJson(PROGRESS_FILE, merged);
      return send(res, 200, { ok: true });
    } catch (e) {
      return send(res, 400, { error: 'invalid_progress' });
    }
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

  // Download traineddata for OCR (e.g., langs=jpn,eng)
  if (req.method === 'POST' && pathname === '/api/ocr-setup') {
    try {
      const body = await parseBody(req);
      const langs = (body?.langs || 'jpn,eng').split(',').map(s => s.trim()).filter(Boolean);
      const results = [];
      for (const lang of langs) {
        const dir = path.join(DATA_DIR, 'tessdata');
        fs.mkdirSync(dir, { recursive: true });
        // tesseract.js は <langPath>/<lang>.traineddata.gz を探すため .gz を優先取得
        const destGz = path.join(dir, `${lang}.traineddata.gz`);
        if (!fs.existsSync(destGz)) {
          const urlTdGz = `https://tessdata.projectnaptha.com/4.0.0/${lang}.traineddata.gz`;
          const buf = await fetchBuffer(urlTdGz);
          fs.writeFileSync(destGz, buf);
          results.push({ lang, downloaded: true, file: path.relative(DATA_DIR, destGz) });
        } else {
          results.push({ lang, downloaded: false, file: path.relative(DATA_DIR, destGz) });
        }
      }
      return send(res, 200, { ok: true, results });
    } catch (e) {
      return send(res, 500, { error: 'setup_failed' });
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
      const rawQuestions = extractQuestionsFromText(text, meta);
      const { valid, invalidReasons } = ImportNormalizer.normalizeQuestions(rawQuestions);
      const outName = path.basename(rel, path.extname(rel)) + '.json';
      const outPath = path.join(EXTRACT_DIR, outName);
      fs.writeFileSync(outPath, JSON.stringify(valid, null, 2));
      // 取り込みを簡単にするため、抽出結果もレスポンスで返す
      return send(res, 200, {
        ok: true,
        count: valid.length,
        skipped: invalidReasons.length,
        file: path.relative(DATA_DIR, outPath),
        questions: valid,
        invalidReasons,
      });
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
        const rawQuestions = extractQuestionsFromText(text, {});
        const { valid, invalidReasons } = ImportNormalizer.normalizeQuestions(rawQuestions);
        const outName = path.basename(f, path.extname(f)) + '.json';
        const outPath = path.join(EXTRACT_DIR, outName);
        fs.writeFileSync(outPath, JSON.stringify(valid, null, 2));
        results.push({ file: rel, count: valid.length, skipped: invalidReasons.length, out: path.relative(DATA_DIR, outPath) });
      } catch (e) {
        results.push({ file: f, error: 'extract_failed' });
      }
    }
    return send(res, 200, { ok: true, results });
  }

  // OCR a single image (PNG/JPG) under data/, return text
  if (req.method === 'POST' && pathname === '/api/ocr-image') {
    try {
      const body = await parseBody(req);
      const rel = body?.file || '';
      const abs = path.normalize(path.join(DATA_DIR, rel));
      if (!abs.startsWith(DATA_DIR)) return send(res, 400, { error: 'invalid path' });
      if (!fs.existsSync(abs)) return send(res, 404, { error: 'not found' });
      const text = await ocrImage(abs, body?.lang || 'jpn');
      return send(res, 200, { ok: true, text });
    } catch (e) {
      return send(res, 500, { error: 'ocr_failed' });
    }
  }

  // OCR a PDF by converting with pdftoppm (Poppler) if available
  if (req.method === 'POST' && pathname === '/api/ocr-pdf') {
    try {
      const body = await parseBody(req);
      const rel = body?.file || '';
      const lang = body?.lang || 'jpn';
      const dpi = Math.max(72, Math.min(600, Number(body?.dpi) || 300));
      const abs = path.normalize(path.join(DATA_DIR, rel));
      if (!abs.startsWith(DATA_DIR)) return send(res, 400, { error: 'invalid path' });
      if (!fs.existsSync(abs)) return send(res, 404, { error: 'not found' });
      const outDir = path.join(DATA_DIR, 'tmp', path.basename(rel, path.extname(rel)));
      fs.mkdirSync(outDir, { recursive: true });
      const ok = await tryPdftoppm(abs, outDir, dpi);
      if (!ok) return send(res, 400, { error: 'pdftoppm_not_found', hint: 'Install Poppler and ensure pdftoppm is in PATH, or convert PDF to images manually and call /api/ocr-image.' });
      const files = fs.readdirSync(outDir).filter(f => /\.png$/i.test(f)).map(f => path.join(outDir, f));
      const texts = [];
      for (const f of files) texts.push(await ocrImage(f, lang));
      const combined = texts.join('\n');
      const rawQuestions = extractQuestionsFromText(combined, body?.meta || {});
      const { valid, invalidReasons } = ImportNormalizer.normalizeQuestions(rawQuestions);
      const outName = path.basename(rel, path.extname(rel)) + '.ocr.json';
      const outPath = path.join(EXTRACT_DIR, outName);
      fs.writeFileSync(outPath, JSON.stringify(valid, null, 2));
      return send(res, 200, {
        ok: true,
        pages: files.length,
        count: valid.length,
        skipped: invalidReasons.length,
        file: path.relative(DATA_DIR, outPath),
        questions: valid,
        invalidReasons,
      });
    } catch (e) {
      return send(res, 500, { error: 'ocr_pdf_failed' });
    }
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
          const savedAs = await downloadIntoDir(item.href, DOWNLOAD_DIR, target);
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

  // Download a single file to downloads/
  if (req.method === 'POST' && pathname === '/api/download-file') {
    const q = url.parse(req.url, true).query;
    const target = (q.url || '').toString();
    if (!/^https?:\/\//i.test(target)) return send(res, 400, { error: 'invalid url' });
    try {
      const saved = await downloadIntoDir(target, DOWNLOAD_DIR, target);
      return send(res, 200, { ok: true, file: path.relative(DATA_DIR, saved) });
    } catch (e) {
      return send(res, 502, { error: 'download_failed' });
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
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) mini-backend/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en;q=0.8',
      },
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

  // OCR each page into a flashcard-like question (1ページ=1設問, 暫定4択)
  // (removed misplaced ocr-pages handler)
  const defaultPdf = /\.pdf(\?|#|$)/i;
  let m;
  // 1) 普通の <a href="...">
  while ((m = reA.exec(html))) {
    const href = (m[2] || '').trim();
    const text = stripTags(m[3] || '').trim().replace(/\s+/g, ' ');
    const target = href;
    if (filter ? !filter.test(target) : !defaultPdf.test(target)) continue;
    try {
      const abs = new URL(target, baseUrl).toString();
      out.push({ title: text || abs, href: abs });
    } catch (_) { /* ignore invalid */ }
  }
  // 2) HTML全体からの生URL検出（スクリプトやテキスト内に埋め込みの場合）
  const reAbs = /https?:[^\s"'<>]+\.pdf(?:\?[^\s"'<>]*)?/ig;
  while ((m = reAbs.exec(html))) {
    const target = m[0];
    if (filter ? !filter.test(target) : !defaultPdf.test(target)) continue;
    try { out.push({ title: target, href: new URL(target, baseUrl).toString() }); } catch (_) {}
  }
  // 3) 相対パスらしき .pdf をざっくり拾う
  const reRel = /(?:^|[^a-z0-9_\-\.])([\/][^\s"'<>]+?\.pdf(?:\?[^\s"'<>]*)?)/ig;
  while ((m = reRel.exec(html))) {
    const rel = m[1];
    const target = rel;
    if (filter ? !filter.test(target) : !defaultPdf.test(target)) continue;
    try { out.push({ title: target, href: new URL(target, baseUrl).toString() }); } catch (_) {}
  }
  const seen = new Set();
  return out.filter(x => (seen.has(x.href) ? false : seen.add(x.href)));
}

function sanitizeFilename(name) {
  return name.replace(/[\x00-\x1f\x7f<>:"/\\|?*]+/g, '_');
}

async function downloadIntoDir(href, dir, referer) {
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
  await downloadFile(href, dest, referer);
  return dest;
}

async function fetchBuffer(target) {
  return new Promise((resolve, reject) => {
    const u = new URL(target);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(target, (r) => {
      if (r.statusCode && r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        try { fetchBuffer(new URL(r.headers.location, u).toString()).then(resolve, reject); } catch (e) { reject(e); }
        return;
      }
      const chunks = [];
      r.on('data', c => chunks.push(c));
      r.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
  });
}

async function ocrImage(imagePath, lang) {
  const langPath = path.join(DATA_DIR, 'tessdata');
  const worker = await createWorker({ langPath });
  try {
    await worker.loadLanguage(lang);
    await worker.initialize(lang);
    // Improve OCR stability for Japanese exam PDFs
    // PSM 6: Assume a single uniform block of text
    // preserve_interword_spaces: keep spaces to help downstream splitting
    try {
      await worker.setParameters({ tessedit_pageseg_mode: 6, preserve_interword_spaces: '1' });
    } catch (_) { /* older versions may ignore setParameters */ }
    const { data } = await worker.recognize(imagePath);
    return data?.text || '';
  } finally {
    await worker.terminate();
  }
}

function downloadFile(href, dest, referer) {
  return new Promise((resolve, reject) => {
    const u = new URL(href);
    const lib = u.protocol === 'https:' ? https : http;
    const file = fs.createWriteStream(dest);
    const req = lib.get({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + (u.search || ''),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) mini-backend/1.0',
        ...(referer ? { Referer: referer } : {}),
        'Accept': '*/*',
      },
    }, (r) => {
      if (r.statusCode && r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        // follow one redirect
        file.close();
        fs.unlink(dest, () => {
          downloadFile(new URL(r.headers.location, u).toString(), dest, referer).then(resolve).catch(reject);
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

// Try calling pdftoppm to render PDF pages into PNGs under outDir.
// Returns true if command executed and exited with code 0 and at least one PNG exists.
async function tryPdftoppm(pdfPath, outDir, dpi = 200) {
  return new Promise((resolve) => {
    try {
      const { spawn } = require('child_process');
      const prefix = path.join(outDir, 'page');
      const args = ['-png', '-r', String(dpi), pdfPath, prefix];
      const proc = spawn(PDFTOPPM, args, { windowsHide: true });
      let done = false;
      proc.on('error', () => { if (!done) { done = true; resolve(false); } });
      proc.on('close', (code) => {
        if (done) return;
        try {
          const hasPng = fs.readdirSync(outDir).some(f => /\.png$/i.test(f));
          resolve(code === 0 && hasPng);
        } catch (_) { resolve(false); }
      });
    } catch (_) { resolve(false); }
  });
}
