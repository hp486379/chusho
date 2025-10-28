(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.QuestionImportNormalizer = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function normalizeSubjectName(name) {
    if (!name) return '';
    let s = String(name);
    s = s.replace(/\uFEFF/g, '');
    s = s.replace(/[\u200B\u200C\u200D]/g, '');
    s = s.replace(/（.*?）/g, '');
    s = s.replace(/\(.*?\)/g, '');
    s = s.replace(/　/g, ' ');
    s = s.replace(/\s+/g, '');
    s = s.replace(/･/g, '・');
    return s.trim();
  }

  function extractQuestionArray(raw) {
    return flattenQuestionCandidates(raw);
  }

  function flattenQuestionCandidates(input) {
    const acc = [];
    collectQuestionNodes(input, acc);
    return acc;
  }

  function collectQuestionNodes(node, acc) {
    if (node == null) return;
    if (Array.isArray(node)) {
      for (const item of node) collectQuestionNodes(item, acc);
      return;
    }
    if (typeof node !== 'object') return;

    const looksLikeQuestion = looksLikeQuestionNode(node);
    if (looksLikeQuestion) acc.push(node);

    const skipKeys = looksLikeQuestion ? new Set(['choices', 'options', 'answers']) : null;
    for (const key of Object.keys(node)) {
      if (skipKeys && skipKeys.has(key)) continue;
      collectQuestionNodes(node[key], acc);
    }
  }

  function looksLikeQuestionNode(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (Array.isArray(obj.choices) && obj.choices.length) return true;
    if (Array.isArray(obj.options) && obj.options.length) return true;
    if (Array.isArray(obj.alternatives) && obj.alternatives.length) return true;
    if (Array.isArray(obj.optionList) && obj.optionList.length) return true;
    if (Array.isArray(obj.answers) && obj.answers.length) return true;
    const choiceKeyExists = Object.keys(obj).some(k => /^choice\d+$/i.test(k));
    if (choiceKeyExists) return true;
    const textKeys = ['stem', 'question', 'text', 'prompt'];
    if (textKeys.some(k => typeof obj[k] === 'string' && obj[k].trim())) return true;
    if (typeof obj.id === 'string' && obj.id.trim() && (obj.subject || obj.year || obj.number)) return true;
    return false;
  }

  function prepareQuestionList(list) {
    const candidates = flattenQuestionCandidates(list);
    const valid = [];
    const invalidReasons = [];
    for (const raw of candidates) {
      const { value, error } = coerceQuestion(raw);
      if (value) valid.push(value);
      else if (error) invalidReasons.push(error);
    }
    return { valid, invalidReasons };
  }

  function coerceQuestion(raw) {
    if (!raw || typeof raw !== 'object') return { error: '問題データがオブジェクトではありません' };
    const q = { ...raw };

    q.subject = coalesceString([q.subject, q.category, q.course]);
    q.stem = coalesceString([q.stem, q.question, q.text, q.prompt]);
    q.explanation = coalesceString([q.explanation, q.commentary, q.detail, q.description]);

    const yearVal = coalesceString([q.year, q.examYear, q.fiscalYear]);
    const numberVal = coalesceString([q.number, q.no, q.index, q.problemNumber]);
    const diffVal = coalesceString([q.difficulty, q.level]);

    const yearNum = parseNumeric(q.year ?? yearVal) ?? parseNumeric(yearVal);
    const numberNum = parseNumeric(q.number ?? numberVal) ?? parseNumeric(numberVal);
    const diffNum = parseNumeric(q.difficulty ?? diffVal) ?? parseNumeric(diffVal);

    q.year = yearNum ?? (yearVal || q.year || null);
    q.number = numberNum ?? (numberVal || q.number || null);
    q.difficulty = diffNum ?? q.difficulty ?? null;

    const subjectForId = q.subject;
    const yearForId = q.year;
    const numberForId = q.number;

    if (!hasValue(q.subject)) q.subject = '未分類';
    if (!hasValue(q.year)) q.year = '不明';
    if (!hasValue(q.number)) q.number = '不明';
    if (!hasValue(q.difficulty)) q.difficulty = '不明';

    q.tags = Array.isArray(q.tags) ? q.tags : [];

    const {
      choices: rawChoices,
      usedAnswersAsChoices,
      originalAnswers,
    } = resolveChoiceArray(q);
    const normalizedChoices = normalizeChoices(rawChoices);
    if (!normalizedChoices.length) return { error: `ID未設定の問題: 選択肢が見つかりません (${q.stem?.slice(0, 16) || 'stemなし'})` };
    q.choices = normalizedChoices;

    ensureCorrectChoice(q, { usedAnswersAsChoices, originalAnswers });

    if (!q.id) {
      if (hasValue(subjectForId) && hasValue(yearForId) && hasValue(numberForId)) {
        q.id = generateQuestionId({ ...q, subject: subjectForId, year: yearForId, number: numberForId });
      } else {
        const idStem = (q.stem && q.stem.trim()) ? q.stem.trim() : JSON.stringify(q).slice(0, 120);
        q.id = `tmp-${hashString(idStem).slice(0, 8)}`;
      }
    }

    const error = validateQuestion(q);
    if (error) return { error };
    return { value: q };
  }

  function normalizeChoices(rawChoices) {
    return (rawChoices || [])
      .map((choice, idx) => normalizeChoice(choice, idx))
      .filter(Boolean);
  }

  function resolveChoiceArray(q) {
    if (Array.isArray(q.choices) && q.choices.length) return { choices: q.choices, usedAnswersAsChoices: false, originalAnswers: q.answers };
    if (Array.isArray(q.options) && q.options.length) return { choices: q.options, usedAnswersAsChoices: false, originalAnswers: q.answers };
    if (Array.isArray(q.alternatives) && q.alternatives.length) return { choices: q.alternatives, usedAnswersAsChoices: false, originalAnswers: q.answers };
    if (Array.isArray(q.optionList) && q.optionList.length) return { choices: q.optionList, usedAnswersAsChoices: false, originalAnswers: q.answers };
    if (Array.isArray(q.answers) && q.answers.length) {
      const treatAsChoices = answersLookLikeChoices(q.answers);
      if (treatAsChoices) {
        return { choices: q.answers, usedAnswersAsChoices: true, originalAnswers: q.answers };
      }
    }
    return { choices: extractChoicesFromKeys(q), usedAnswersAsChoices: false, originalAnswers: q.answers };
  }

  function answersLookLikeChoices(arr) {
    let objectTextCount = 0;
    let stringCount = 0;
    let descriptiveStringCount = 0;

    for (const item of arr) {
      if (item == null) continue;
      if (typeof item === 'object' && !Array.isArray(item)) {
        const text = coalesceString([item.text, item.value, item.label, item.content, item.body, item.choice]);
        if (text) {
          objectTextCount += 1;
          continue;
        }
      }

      if (typeof item === 'string') {
        const trimmed = item.trim();
        if (!trimmed) continue;
        stringCount += 1;
        if (trimmed.length > 1 || /[\s、。・（）()]/.test(trimmed)) {
          descriptiveStringCount += 1;
        }
        continue;
      }

      if (typeof item === 'number') {
        continue;
      }
    }

    if (objectTextCount > 0) return true;
    if (descriptiveStringCount > 0) return true;
    if (stringCount >= 3) return true;
    return false;
  }

  function normalizeChoice(choice) {
    if (!choice && choice !== 0) return null;
    if (typeof choice === 'string') {
      const text = choice.trim();
      if (!text) return null;
      return { text, correct: false };
    }
    if (typeof choice === 'object') {
      const text = coalesceString([choice.text, choice.value, choice.label, choice.content]);
      if (!text) return null;
      const correctFlags = [choice.correct, choice.isCorrect, choice.answer, choice.true, choice.ok];
      const correct = correctFlags.some(flag => isTruthy(flag));
      return { text, correct };
    }
    return null;
  }

  function extractChoicesFromKeys(obj) {
    const keys = Object.keys(obj || {}).filter(k => /^choice\d+$/i.test(k));
    keys.sort((a, b) => parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10));
    return keys.map(k => obj[k]).filter(v => v != null && v !== '');
  }

  function ensureCorrectChoice(q, meta = {}) {
    if (!Array.isArray(q.choices) || !q.choices.length) return;
    if (q.choices.some(c => c.correct)) return;

    const { usedAnswersAsChoices, originalAnswers } = meta;

    const arrayCandidates = [
      q.correctAnswers,
      q.correctAnswer,
      q.correctAnswerList,
      q.correctOptions,
      q.answersCorrect,
      q.correctChoices,
      q.answerChoices,
      q.correctOptionIds,
      q.correctIndices,
      q.correctIndexes,
      q.answerIndexes,
    ].filter(arr => Array.isArray(arr) && arr.length);

    if (!usedAnswersAsChoices && Array.isArray(originalAnswers) && originalAnswers.length) {
      arrayCandidates.push(originalAnswers);
    }

    for (const arr of arrayCandidates) {
      const idx = resolveCorrectByIndex(arr, q.choices);
      if (idx >= 0) {
        q.choices = q.choices.map((c, i) => ({ ...c, correct: i === idx }));
        return;
      }

      const strIdx = resolveCorrectFromStringOrNumber(arr, q.choices);
      if (strIdx >= 0) {
        q.choices = q.choices.map((c, i) => ({ ...c, correct: i === strIdx }));
        return;
      }
    }

    const textCandidates = [
      q.correctText,
      q.correctChoice,
      q.correctOption,
      q.correct,
      q.answer,
      q.correctChoiceText,
      q.correctAnswerText,
      q.correctOptionText,
    ].filter(Boolean);

    for (const text of textCandidates) {
      const idx = resolveCorrectByTextMatch(text, q.choices);
      if (idx >= 0) {
        q.choices = q.choices.map((c, i) => ({ ...c, correct: i === idx }));
        return;
      }
    }

    const keyValueCandidates = [q.answersKeyValue, q.correctMap, q.correctFlags].filter(v => v && typeof v === 'object');
    for (const obj of keyValueCandidates) {
      const matched = resolveCorrectFromKeyValue(obj, q.choices);
      if (matched) {
        q.choices = q.choices.map(c => ({ ...c, correct: matched.has(c.text) }));
        if (!q.choices.some(c => c.correct)) {
          markFirstChoiceAsCorrect(q);
        }
        return;
      }
    }

    const singleCandidate = [
      q.correctIndex,
      q.correctOptionIndex,
      q.correctChoiceIndex,
      q.answerIndex,
      q.correctNumber,
      q.correctOptionNumber,
      q.correctChoiceNumber,
      q.correctAlpha,
      q.correctOptionAlpha,
      q.correctChoiceAlpha,
    ].find(v => v != null);

    const singleIdx = resolveCorrectFromSingleValue(singleCandidate, q.choices);
    if (singleIdx >= 0) {
      q.choices = q.choices.map((c, i) => ({ ...c, correct: i === singleIdx }));
      return;
    }

    markFirstChoiceAsCorrect(q);
  }

  function resolveCorrectByIndex(arr) {
    for (const val of arr) {
      const idx = parseCorrectIndex(val);
      if (idx != null) return idx;
    }
    return -1;
  }

  function resolveCorrectFromStringOrNumber(arr, choices) {
    for (const item of arr) {
      if (item == null) continue;
      if (typeof item === 'number') {
        const idx = parseCorrectIndex(item);
        if (idx != null) return idx;
      }
      if (typeof item === 'string') {
        const idx = parseCorrectIndex(item);
        if (idx != null) return idx;
        const matched = resolveCorrectByTextMatch(item, choices);
        if (matched >= 0) return matched;
      }
    }
    return -1;
  }

  function resolveCorrectByTextMatch(candidate, choices) {
    if (!candidate) return -1;
    const trimmed = String(candidate).trim();
    if (!trimmed) return -1;
    for (let i = 0; i < choices.length; i++) {
      const text = (choices[i].text || '').trim();
      if (!text) continue;
      if (text === trimmed) return i;
      if (text.replace(/[\s、。・（）()]/g, '') === trimmed.replace(/[\s、。・（）()]/g, '')) return i;
    }
    return -1;
  }

  function resolveCorrectFromKeyValue(obj, choices) {
    const set = new Set();
    for (const [key, value] of Object.entries(obj)) {
      const idx = parseCorrectIndex(key);
      if (idx != null && isTruthy(value)) {
        const resolvedIdx = idx;
        if (choices[resolvedIdx]) set.add(choices[resolvedIdx].text);
        continue;
      }
      if (isTruthy(value)) {
        const textIdx = resolveCorrectByTextMatch(key, choices);
        if (textIdx >= 0 && choices[textIdx]) set.add(choices[textIdx].text);
      }
    }
    return set.size ? set : null;
  }

  function resolveCorrectFromSingleValue(value, choices) {
    if (value == null) return -1;
    const idx = parseCorrectIndex(value);
    if (idx != null) return idx;
    if (typeof value === 'string') {
      return resolveCorrectByTextMatch(value, choices);
    }
    return -1;
  }

  function markFirstChoiceAsCorrect(q) {
    q.choices = q.choices.map((c, i) => ({ ...c, correct: i === 0 }));
  }

  function parseCorrectIndex(val) {
    if (val == null || val === '') return null;
    if (typeof val === 'number') return val >= 1 ? val - 1 : val;
    const str = String(val).trim();
    if (!str) return null;
    if (/^\d+$/.test(str)) {
      const n = Number(str);
      return n >= 1 ? n - 1 : n;
    }
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const idx = letters.indexOf(str.toUpperCase());
    return idx >= 0 ? idx : null;
  }

  function coalesceString(values) {
    for (const v of values) {
      if (v == null) continue;
      const str = String(v).trim();
      if (str) return str;
    }
    return '';
  }

  function hasValue(val) {
    return !(val == null || val === '');
  }

  function parseNumeric(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return Number.isNaN(value) ? null : value;
    const str = String(value).trim();
    if (!str) return null;
    const digits = str.match(/\d+/);
    if (!digits) return null;
    const num = Number(digits[0]);
    return Number.isNaN(num) ? null : num;
  }

  function isTruthy(val) {
    if (val === true) return true;
    if (typeof val === 'number') return val !== 0;
    if (typeof val === 'string') return ['true', '1', 'y', 'yes', 'ok', '〇', '○'].includes(val.trim().toLowerCase());
    return false;
  }

  function generateQuestionId(q) {
    const year = q.year || '0000';
    const subjectCode = subjectToCode(q.subject);
    const num = String(q.number || 0).padStart(2, '0');
    return `${year}-${subjectCode}-${num}`;
  }

  function subjectToCode(subject) {
    const base = normalizeSubjectName(subject);
    if (!base) return 'misc';
    if (base.includes('経済学')) return 'eco';
    if (base.includes('財務')) return 'acc';
    if (base.includes('企業経営')) return 'mgt';
    if (base.includes('運営管理')) return 'opm';
    if (base.includes('法務')) return 'law';
    if (base.includes('情報')) return 'it';
    if (base.includes('中小企業')) return 'sme';
    return base.slice(0, 8) || 'misc';
  }

  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  }

  function validateQuestion(q) {
    if (!q || typeof q !== 'object') return '問題データが不正です';
    if (!q.id) return 'IDがありません';
    if (!q.subject) return `ID:${q.id} 科目がありません`;
    if (!q.year) return `ID:${q.id} 年度がありません`;
    if (!q.number && q.number !== 0) return `ID:${q.id} 問題番号がありません`;
    if (!q.stem) return `ID:${q.id} 問題文がありません`;
    if (!Array.isArray(q.choices) || !q.choices.length) return `ID:${q.id} 選択肢が不正です`;
    if (!q.choices.some(c => c && typeof c.text === 'string' && c.text.trim())) return `ID:${q.id} 選択肢の本文が空です`;
    if (!q.choices.some(c => c && c.correct)) return `ID:${q.id} 正解が指定されていません`;
    return null;
  }

  function normalizeQuestions(raw) {
    if (raw == null) return { valid: [], invalidReasons: ['入力が空です'] };
    const list = Array.isArray(raw) ? raw : flattenQuestionCandidates(raw);
    return prepareQuestionList(list);
  }

  return {
    normalizeSubjectName,
    extractQuestionArray,
    flattenQuestionCandidates,
    looksLikeQuestionNode,
    prepareQuestionList,
    coerceQuestion,
    normalizeChoices,
    answersLookLikeChoices,
    normalizeChoice,
    extractChoicesFromKeys,
    ensureCorrectChoice,
    parseCorrectIndex,
    coalesceString,
    hasValue,
    parseNumeric,
    isTruthy,
    generateQuestionId,
    hashString,
    validateQuestion,
    normalizeQuestions,
  };
});
