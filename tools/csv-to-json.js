#!/usr/bin/env node
// CSV -> JSON(配列) 変換ツール（依存なし）
// 使い方: node tools/csv-to-json.js input.csv > questions.json
// 期待カラム（ヘッダ名、大文字小文字無視・全角空白/半角空白を除去して比較）
// - subject, year, number, difficulty, stem
// - choice1, choice2, choice3, choice4（最大4択想定。choice5以降もあれば取り込み）
// - correct（1..N または A/B/C/D...）
// - explanation（任意）
// id は `${year}-${code}-${NN}` を自動生成（codeは科目短縮: eco, acc, mgt, opm, law, it, sme）

const fs = require('fs');

if (process.argv.length < 3) {
  console.error('Usage: node tools/csv-to-json.js input.csv > questions.json');
  process.exit(1);
}

const csv = fs.readFileSync(process.argv[2], 'utf8'); // UTF-8で保存してください

function norm(s) {
  return String(s || '')
    .replace(/\uFEFF/g, '')
    .replace(/[\u200B\u200C\u200D]/g, '')
    .replace(/　/g, ' ')
    .trim();
}

function parseCSV(text) {
  const out = [];
  let i = 0, field = '', row = [], inQuotes = false;
  function pushField() { row.push(field); field = ''; }
  function pushRow() { out.push(row); row = []; }
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { pushField(); i++; continue; }
    if (ch === '\n') { pushField(); pushRow(); i++; continue; }
    if (ch === '\r') { i++; continue; }
    field += ch; i++;
  }
  // last field/row
  pushField(); if (row.length) pushRow();
  return out;
}

function headerKey(s) {
  return norm(s).toLowerCase().replace(/\s+/g, '');
}

const rows = parseCSV(csv);
if (!rows.length) { console.log('[]'); process.exit(0); }
const headers = rows[0].map(headerKey);
const body = rows.slice(1).filter(r => r.some(v => norm(v)));

function subjCode(subject) {
  const base = norm(subject).replace(/（.*?）/g, '').replace(/\(.*?\)/g, '');
  if (base.includes('経済学')) return 'eco';
  if (base.includes('財務')) return 'acc';
  if (base.includes('企業経営')) return 'mgt';
  if (base.includes('運営管理')) return 'opm';
  if (base.includes('法務')) return 'law';
  if (base.includes('情報システム') || base.includes('情報')) return 'it';
  if (base.includes('中小企業')) return 'sme';
  return 'oth';
}

function pad2(n) { n = Number(n)||0; return n < 10 ? '0'+n : String(n); }

function letterToIndex(s) {
  const m = String(s||'').trim().toUpperCase();
  if (/^\d+$/.test(m)) return Number(m)-1;
  const idx = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(m);
  return idx >= 0 ? idx : null;
}

function toQuestion(obj) {
  const subject = obj.subject || '';
  const year = Number(obj.year||0);
  const number = Number(obj.number||0);
  const difficulty = Number(obj.difficulty||0) || 2;
  const stem = obj.stem || '';
  const explanation = obj.explanation || '';
  const choices = [];
  let k = 1;
  while (obj['choice'+k]) { choices.push({ text: obj['choice'+k] }); k++; }
  if (choices.length === 0) return null;
  const corrIdx = letterToIndex(obj.correct);
  if (corrIdx != null && choices[corrIdx]) choices[corrIdx].correct = true;
  else if (choices[0]) choices[0].correct = true; // フォールバック
  const id = `${year}-${subjCode(subject)}-${pad2(number)}`;
  return { id, subject, year, number, difficulty, tags: [], stem, choices, explanation };
}

const list = body.map(row => {
  const obj = {};
  headers.forEach((h, i) => obj[h] = norm(row[i]));
  return toQuestion(obj);
}).filter(Boolean);

console.log(JSON.stringify(list, null, 2));

