const fs = require('fs');
const pdf = require('pdf-parse');

async function parsePdfText(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const out = await pdf(dataBuffer);
  return { text: out.text || '', numPages: out.numpages || out.numpages || 0, info: out.info || {} };
}

function extractQuestionsFromText(text, meta = {}) {
  const lines = String(text || '').split(/\r?\n/).map(s => s.replace(/[\t\f]+/g, ' ').replace(/\s+$/g, ''));
  const joined = lines.join('\n');
  const splitter = /(第\s*[0-9０-９]+\s*問|問\s*[0-9０-９]+|問題\s*[0-9０-９]+)/g;
  const parts = joined.split(splitter).filter(s => s && s.trim());
  const questions = [];
  for (let i = 0; i < parts.length; i += 2) {
    const marker = parts[i];
    const body = (parts[i + 1] || '').trim();
    if (!body) continue;
    const numStr = (marker || '').replace(/[^0-9０-９]+/g, '');
    const number = toArabic(numStr) || questions.length + 1;
    const q = buildQuestionFromBody(number, body, meta);
    if (q) questions.push(q);
  }
  return questions;
}

function buildQuestionFromBody(number, body, meta) {
  // 1) 数字選択肢
  const numLead = /\s*[\(（]?(?:[1-4]|[１-４]|[①②③④])[\)）．\.、]?\s*/;
  const numSplit = body.split(new RegExp(`(?=\n${numLead.source})`));
  if (numSplit.length >= 5) {
    const stem = numSplit[0].trim();
    const texts = numSplit.slice(1).map(s => s.replace(new RegExp('^' + numLead.source), '').trim());
    const choices = texts.slice(0, 4).map(t => ({ text: t }));
    return makeQ(number, stem, choices, meta);
  }

  // 2) ア・イ・ウ・エ
  const kanaLead = /\s*(?:ア|イ|ウ|エ)[\s．\.、]+/;
  const kanaBlocks = body.split(new RegExp(`(?=\n${kanaLead.source})`));
  if (kanaBlocks.length >= 5) {
    const stem = kanaBlocks[0].trim();
    const texts = kanaBlocks.slice(1).map(s => s.replace(new RegExp('^' + kanaLead.source), '').trim());
    const choices = texts.slice(0, 4).map(t => ({ text: t }));
    return makeQ(number, stem, choices, meta);
  }

  // 3) A B C D
  const abcdLead = /\s*(?:A|B|C|D)[\s．\.、]+/i;
  const abcdBlocks = body.split(new RegExp(`(?=\n${abcdLead.source})`));
  if (abcdBlocks.length >= 5) {
    const stem = abcdBlocks[0].trim();
    const texts = abcdBlocks.slice(1).map(s => s.replace(new RegExp('^' + abcdLead.source, 'i'), '').trim());
    const choices = texts.slice(0, 4).map(t => ({ text: t }));
    return makeQ(number, stem, choices, meta);
  }

  // 4) 改行喪失の簡易救済
  const compact = body.replace(/\s+/g, ' ');
  const idxA = compact.indexOf('ア');
  if (idxA > -1) {
    const stem = compact.slice(0, idxA).trim();
    const rest = compact.slice(idxA);
    const texts = rest.split(/\s+(?:ア|イ|ウ|エ)\s*/).filter(Boolean);
    if (texts.length >= 4) {
      return makeQ(number, stem, texts.slice(0,4).map(t=>({text:t.trim()})), meta);
    }
  }
  return null;
}

function makeQ(number, stem, choices, meta) {
  const subject = meta.subject || '';
  const year = meta.year || 0;
  const id = `${year||'0000'}-auto-${String(number).padStart(2,'0')}`;
  return {
    id,
    subject,
    year,
    number,
    difficulty: 2,
    tags: [],
    stem,
    choices: choices.map(c => ({ text: c.text, correct: !!c.correct })),
    explanation: '',
  };
}

function toArabic(s) {
  if (!s) return 0;
  const map = { '０':'0','１':'1','２':'2','３':'3','４':'4','５':'5','６':'6','７':'7','８':'8','９':'9' };
  return Number(String(s).replace(/[０-９]/g, d => map[d]));
}

module.exports = {
  parsePdfText,
  extractQuestionsFromText,
};

