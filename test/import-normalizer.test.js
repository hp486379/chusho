const { test } = require('node:test');
const assert = require('node:assert/strict');

const normalizer = require('../import-normalizer');

function findQuestion(raw) {
  const { valid, invalidReasons } = normalizer.normalizeQuestions(raw);
  assert.equal(invalidReasons.length, 0, `正規化エラー: ${invalidReasons.join(', ')}`);
  assert.equal(valid.length, 1, '1件の問題が正規化されるはずです');
  return valid[0];
}

test('年度や番号が無くても既定値で補完される', () => {
  const question = findQuestion({
    stem: 'テスト問題',
    options: ['A', 'B', 'C'],
    correctAnswers: [1],
  });

  assert.equal(question.subject, '未分類');
  assert.equal(question.year, '不明');
  assert.equal(question.number, '不明');
  assert.equal(question.difficulty, '不明');
  assert.ok(question.choices.some(c => c.correct), '正解フラグが付く');
});

test('correctAnswers の番号指定で正解が設定される', () => {
  const question = findQuestion({
    subject: '経営情報システム',
    year: 2023,
    number: 10,
    answers: ['ア', 'イ', 'ウ', 'エ'],
    correctAnswers: [2],
    stem: '正答位置を判定',
  });

  assert.equal(question.choices.length, 4);
  assert.ok(question.choices[1].correct, '2番目の選択肢が正解になる');
  assert.equal(question.id, '2023-it-10');
});

test('テキスト指定の正解も解釈できる', () => {
  const question = findQuestion({
    subject: '財務・会計',
    year: '2022',
    number: '7',
    choices: [
      { text: 'キャッシュフローを増やす' },
      { text: '負債を増やす' },
    ],
    correctAnswerText: 'キャッシュフローを増やす',
    stem: '正答テキストから判定',
  });

  assert.ok(question.choices[0].correct, '正解テキストが一致した選択肢にフラグが立つ');
});
