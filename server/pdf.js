const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

async function parsePdfText(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const out = await pdf(dataBuffer);
  return { text: out.text || '', numPages: out.numpages || out.numpages || 0, info: out.info || {} };
}

// Very naive heuristic extractor for Japanese exam PDFs.
// Splits by question markers like 「第1問」「問1」「問題1」 etc.
// Tries to detect choices like (1)(2)(3)(4) / ア イ ウ エ / A B C D
function extractQuestionsFromText(text, meta = {}) {
  const lines = text.split(/\r?\n/).map(s => s.replace(/[\t\f]+/g, ' ').replace(/\s+$/g, ''));
  const joined = lines.join('\n');
  const splitter = /(第\s*[0-9０-９]+\s*問|問\s*[0-9０-９]+|問題\s*[0-9０-９]+)/g;
  const parts = joined.split(splitter).filter(s => s && s.trim());
  const questions = [];
  for (let i = 0; i < parts.length; i += 2) {
    const marker = parts[i];
    const body = (parts[i + 1] || '').trim();
    if (!body) continue;
    const number = toArabic((marker || '').replace(/[^0-9０-９]+/g, '')) || questions.length + 1;
    const q = buildQuestionFromBody(number, body, meta);
    if (q) questions.push(q);
  }
  return questions;
}

function buildQuestionFromBody(number, body, meta) {
  // Identify choices by markers
  const choicePatterns = [
    /[（\(]?1[）\)]\s*|１\s*/g,
    /[（\(]?2[）\)]\s*|２\s*/g,
    /[（\(]?3[）\)]\s*|３\s*/g,
    /[（\(]?4[）\)]\s*|４\s*/g,
  ];
  let choices = [];
  // Try numeric choices split
  let m;
  const numSplit = body.split(/(?=\s*[（\(]?[1１][）\)]?\s)|(?=\n\s*[1１]\.\s)/);
  if (numSplit.length >= 5) {
    const stem = numSplit[0].trim();
    const texts = numSplit.slice(1).map(s => s.replace(/^\s*[（\(]?[0-9０-９][）\)]?\s*|^\s*[0-9０-９]\.\s*/, '').trim());
    choices = texts.slice(0, 4).map(t => ({ text: t }));
    return makeQ(number, stem, choices, meta);
  }
  // Try katakana markers ア イ ウ エ
  const kanaSplit = body.split(/(?=\s*[アあ]\s)|(?=\s*ア\s)|(?=\s*イ\s)|(?=\s*ウ\s)|(?=\s*エ\s)/);
  if (kanaSplit.length >= 5) {
    const stem = kanaSplit[0].trim();
    const labels = ['ア','イ','ウ','エ'];
    const texts = [];
    let tmp = stem;
    let rest = body.substring(stem.length);
    const re = /(ア|イ|ウ|エ)\s*/g;
    let idx = 0, last = 0, arr = [];
    const blocks = body.split(/\n(?=(ア|イ|ウ|エ)\s)/);
    if (blocks.length >= 5) {
      const stem2 = blocks[0].trim();
      const optBlocks = blocks.slice(1);
      for (let i=0;i<4;i++) texts.push((optBlocks[i]||'').replace(/^(ア|イ|ウ|エ)\s*/, '').trim());
      return makeQ(number, stem2, texts.map(t=>({text:t})), meta);
    }
  }
  // Fallback: cannot parse well, return null
  return null;
}

function makeQ(number, stem, choices, meta) {
  const subject = meta.subject || '';
  const year = meta.year || 0;
  const id = `${year||'0000'}-auto-${String(number).padStart(2,'0')}`;
  const q = {
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
  return q;
}

function toArabic(s) {
  if (!s) return 0;
  const map = { '０':'0','１':'1','２':'2','３':'3','４':'4','５':'5','６':'6','７':'7','８':'8','９':'9' };
  return Number(s.replace(/[０-９]/g, d => map[d]));
}

module.exports = {
  parsePdfText,
  extractQuestionsFromText,
};

