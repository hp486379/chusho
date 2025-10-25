// 中小企業診断士 学習アプリ (MVP) - 依存なしバニラJS

(function () {
  'use strict';

  // ---------- 設定 / ストレージ ----------
  const STORAGE = {
    questions: 'smeid_questions_v1',
    progress: 'smeid_progress_v1',
    settings: 'smeid_settings_v1',
  };

  const LEITNER_DAYS = [0, 1, 3, 7, 14, 30, 60]; // 箱ごとの日間隔
  // 科目の優先順（存在する科目のみ使う）。括弧書きは無視して正規化して比較
  // 表示用の正規科目名（ユーザー提示の正式名称）
  const SUBJECT_CANONICAL = [
    '経済学・経済政策',
    '財務・会計',
    '企業経営理論（経営戦略論・組織論・マーケティング）',
    '運営管理（オペレーション・マネジメント）',
    '経営法務',
    '経営情報システム',
    '中小企業経営・中小企業政策',
  ];
  // 並び順の基準（括弧内を除いた基幹名）
  const SUBJECT_PRIORITY = [
    '経済学・経済政策',
    '財務・会計',
    '企業経営理論',
    '運営管理',
    '経営法務',
    '経営情報システム',
    '中小企業経営・中小企業政策',
  ];

  function nowMs() { return Date.now(); }
  function daysToMs(d) { return d * 24 * 60 * 60 * 1000; }

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('Failed to load key', key, e);
      return fallback;
    }
  }

  function saveJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  // ---------- サンプル問題（最初の起動用） ----------
  const DEFAULT_QUESTIONS = [
    {
      id: '2021-eco-01',
      subject: '経済学・経済政策',
      year: 2021,
      number: 1,
      difficulty: 2,
      tags: ['ミクロ', '需要供給'],
      stem: '需要曲線が右にシフトするとき、他の条件が一定であれば、均衡価格と均衡取引量はどうなるか。',
      choices: [
        { text: '価格↑・取引量↑', correct: true },
        { text: '価格↑・取引量↓', correct: false },
        { text: '価格↓・取引量↑', correct: false },
        { text: '価格↓・取引量↓', correct: false },
      ],
      explanation: '需要の増加は、均衡価格と取引量を共に押し上げる。',
    },
    {
      id: '2020-opm-12',
      subject: '運営管理',
      year: 2020,
      number: 12,
      difficulty: 2,
      tags: ['IE', 'ラインバランシング'],
      stem: '生産ラインのタクトタイムを短縮すると、必要となる作業ステーション数は一般にどうなるか。',
      choices: [
        { text: '増加する', correct: true },
        { text: '減少する', correct: false },
        { text: '不変である', correct: false },
        { text: '影響しない', correct: false },
      ],
      explanation: 'タクトタイム短縮は各ステーションの負荷上昇を招き、分割数が増える傾向。',
    },
    {
      id: '2019-acc-05',
      subject: '財務・会計',
      year: 2019,
      number: 5,
      difficulty: 3,
      tags: ['CVP分析'],
      stem: '損益分岐点売上高を低下させる施策として最も適切なものはどれか。',
      choices: [
        { text: '固定費の削減', correct: true },
        { text: '変動費率の上昇', correct: false },
        { text: '販売価格の引下げ', correct: false },
        { text: '営業外費用の増加', correct: false },
      ],
      explanation: 'CVPの式より、固定費の削減は損益分岐点を引き下げる。',
    },
    {
      id: '2018-mgt-02',
      subject: '企業経営理論（経営戦略論・組織論・マーケティング）',
      year: 2018,
      number: 2,
      difficulty: 2,
      tags: ['ポーター', '競争戦略'],
      stem: '差別化戦略の特徴として最も適切なものはどれか。',
      choices: [
        { text: '独自性を高め価格プレミアムを狙う', correct: true },
        { text: 'コスト低減で低価格を実現する', correct: false },
        { text: '市場全体を無視して特定地域に集中', correct: false },
        { text: '生産量を絞り固定費を増加させる', correct: false },
      ],
      explanation: '差別化戦略は独自価値の提供により高価格を可能にする。',
    },
    {
      id: '2018-law-03',
      subject: '経営法務',
      year: 2018,
      number: 3,
      difficulty: 2,
      tags: ['知的財産'],
      stem: '商標権に関する記述として最も適切なものはどれか。',
      choices: [
        { text: '更新により存続期間を延長できる', correct: true },
        { text: '出願から20年で自動的に消滅する', correct: false },
        { text: '譲渡はできない', correct: false },
        { text: '専用使用権は設定できない', correct: false },
      ],
      explanation: '商標権は更新可能で、出所表示機能を保護する。',
    },
    {
      id: '2019-it-04',
      subject: '経営情報システム',
      year: 2019,
      number: 4,
      difficulty: 2,
      tags: ['DBMS'],
      stem: '正規化の目的として最も適切なものはどれか。',
      choices: [
        { text: '冗長性の排除とデータ整合性の向上', correct: true },
        { text: '暗号化強度の向上', correct: false },
        { text: 'ネットワーク遅延の低減', correct: false },
        { text: 'UIの使いやすさ向上', correct: false },
      ],
      explanation: '正規化は重複排除と更新時の不整合回避が主目的。',
    },
    {
      id: '2020-sme-06',
      subject: '中小企業経営・中小企業政策',
      year: 2020,
      number: 6,
      difficulty: 2,
      tags: ['中小企業施策'],
      stem: '小規模事業者持続化補助金の目的に最も近いものはどれか。',
      choices: [
        { text: '販路開拓などの取組を支援する', correct: true },
        { text: '失業給付の支給', correct: false },
        { text: '賃金引上げの義務化', correct: false },
        { text: '赤字企業への自動給付', correct: false },
      ],
      explanation: '小規模事業者の販路開拓等に要する経費を支援する制度。',
    },
  ];

  // 初回のみデフォルト問題を投入
  const bootQuestions = loadJSON(STORAGE.questions, null);
  if (!bootQuestions) saveJSON(STORAGE.questions, DEFAULT_QUESTIONS);

  // ---------- 進捗モデル ----------
  // progress.byQuestionId[qid] = { box, lastResult: 'correct'|'incorrect', lastReviewedAt, nextDueAt, timesCorrect, timesIncorrect }
  const progress = loadJSON(STORAGE.progress, { byQuestionId: {}, stat: { total: 0, correct: 0 } });

  function updateAfterAnswer(qid, wasCorrect) {
    const p = progress.byQuestionId[qid] || { box: 0, lastResult: null, lastReviewedAt: 0, nextDueAt: 0, timesCorrect: 0, timesIncorrect: 0 };
    if (wasCorrect) {
      p.box = Math.min(p.box + 1, LEITNER_DAYS.length - 1);
      p.timesCorrect += 1;
      p.lastResult = 'correct';
    } else {
      p.box = 0;
      p.timesIncorrect += 1;
      p.lastResult = 'incorrect';
    }
    p.lastReviewedAt = nowMs();
    p.nextDueAt = p.lastReviewedAt + daysToMs(LEITNER_DAYS[p.box]);
    p.updatedAt = p.lastReviewedAt;
    progress.byQuestionId[qid] = p;

    // 集計（簡易）
    progress.stat.total += 1;
    if (wasCorrect) progress.stat.correct += 1;
    saveJSON(STORAGE.progress, progress);
    if (settings().syncEnabled) scheduleProgressPush();
  }

  function getAccuracy() {
    const { total, correct } = progress.stat;
    if (!total) return '-';
    return Math.round((correct / total) * 100) + '%';
  }

  // ---------- 問題フィルタ/選択 ----------
  function loadQuestions() {
    return loadJSON(STORAGE.questions, []);
  }

  function uniqueSorted(arr) {
    return Array.from(new Set(arr)).sort((a, b) => (a > b ? 1 : -1));
  }

  function isDue(q) {
    const p = progress.byQuestionId[q.id];
    if (!p) return true; // 未学習は提示
    return (p.nextDueAt || 0) <= nowMs();
  }

  function filterQuestions(all, { subject, year, difficulty }) {
    const subjNorm = normalizeSubjectName(subject);
    return all.filter(q => {
      const okSubject = !subject || normalizeSubjectName(q.subject) === subjNorm;
      const okYear = !year || String(q.year) === String(year);
      const okDiff = !difficulty || Number(q.difficulty) === Number(difficulty);
      return okSubject && okYear && okDiff;
    });
  }

  function normalizeSubjectName(name) {
    if (!name) return '';
    let s = String(name);
    // 不可視文字除去（BOM/ゼロ幅）
    s = s.replace(/\uFEFF/g, ''); // BOM / ZWNBSP
    s = s.replace(/[\u200B\u200C\u200D]/g, ''); // ZERO WIDTH
    // 括弧内容を除去（全角/半角）
    s = s.replace(/（.*?）/g, '');
    s = s.replace(/\(.*?\)/g, '');
    // 全角空白→半角、スペース除去
    s = s.replace(/　/g, ' ');
    s = s.replace(/\s+/g, '');
    // 記号のゆれ吸収
    s = s.replace(/･/g, '・');
    return s.trim();
  }

  // 科目ごとに均等に並べ替える（ラウンドロビン）。各科目内はシャッフル
  function balanceBySubject(questions) {
    const group = new Map(); // key: subject(string), val: array
    for (const q of questions) {
      const key = q.subject || '';
      if (!group.has(key)) group.set(key, []);
      group.get(key).push(q);
    }
    // 各科目をシャッフル
    const entries = Array.from(group.entries()).map(([subj, arr]) => [subj, shuffle(arr.slice())]);
    // 並び順: SUBJECT_PRIORITY に従い、未知は末尾
    const ordered = entries.sort((a, b) => {
      const ai = SUBJECT_PRIORITY.indexOf(normalizeSubjectName(a[0]));
      const bi = SUBJECT_PRIORITY.indexOf(normalizeSubjectName(b[0]));
      const aii = ai === -1 ? 999 : ai;
      const bii = bi === -1 ? 999 : bi;
      if (aii !== bii) return aii - bii;
      // 同順位は科目名で安定ソート
      return a[0] > b[0] ? 1 : -1;
    });
    // ラウンドロビンで配列を構築
    const queues = ordered.map(([, arr]) => arr);
    const out = [];
    let remaining = queues.reduce((s, q) => s + q.length, 0);
    while (remaining > 0) {
      for (const qarr of queues) {
        if (qarr.length) {
          out.push(qarr.shift());
          remaining--;
        }
      }
    }
    return out;
  }

  // ---------- UI要素 ----------
  const els = {
    subjectSelect: document.getElementById('subjectSelect'),
    yearSelect: document.getElementById('yearSelect'),
    difficultySelect: document.getElementById('difficultySelect'),
    startBtn: document.getElementById('startBtn'),
    statCount: document.getElementById('statCount'),
    statAccuracy: document.getElementById('statAccuracy'),
    statDue: document.getElementById('statDue'),
    quiz: document.getElementById('quiz'),
    quizMeta: document.getElementById('quizMeta'),
    stem: document.getElementById('stem'),
    choices: document.getElementById('choices'),
    explanation: document.getElementById('explanation'),
    nextBtn: document.getElementById('nextBtn'),
    endBtn: document.getElementById('endBtn'),
    importFile: document.getElementById('importFile'),
    importBtn: document.getElementById('importBtn'),
    exportBtn: document.getElementById('exportBtn'),
    resetProgressBtn: document.getElementById('resetProgressBtn'),
    serverUrl: document.getElementById('serverUrl'),
    syncEnabled: document.getElementById('syncEnabled'),
    pullBtn: document.getElementById('pullBtn'),
    pushBtn: document.getElementById('pushBtn'),
    themeToggle: document.getElementById('themeToggle'),
  };

  // ---------- 初期化（プルダウン/統計） ----------
  function refreshFiltersAndStats() {
    const all = loadQuestions();

    // 年度（全体から抽出）
    const years = uniqueSorted(all.map(q => q.year));
    renderSelectOptions(els.yearSelect, years, 'すべて');

    // 科目（現在の年度/難易度/モードを考慮した件数表示・0件は選択不可）
    const mode = getSelectedMode();
    renderSubjectOptions(els.subjectSelect, all, currentFilter(), mode);

    // 統計
    els.statCount.textContent = String(all.length);
    els.statAccuracy.textContent = getAccuracy();
    const dueCount = filterQuestions(all, currentFilter()).filter(isDue).length;
    els.statDue.textContent = String(dueCount);
    // 設定UIの復元
    const s = settings();
    if (els.serverUrl && !els.serverUrl.value) els.serverUrl.value = s.serverUrl || '';
    if (els.syncEnabled) els.syncEnabled.checked = !!s.syncEnabled;
    updateThemeToggleLabel(s.theme || 'dark');
  }

  function renderSelectOptions(selectEl, values, allLabel) {
    const current = selectEl.value;
    selectEl.innerHTML = '';
    const optAll = document.createElement('option');
    optAll.value = '';
    optAll.textContent = allLabel;
    selectEl.appendChild(optAll);
    values.forEach(v => {
      const opt = document.createElement('option');
      opt.value = String(v);
      opt.textContent = String(v);
      selectEl.appendChild(opt);
    });
    // 可能なら選択状態維持
    const exists = Array.from(selectEl.options).some(o => o.value === current);
    if (exists) selectEl.value = current; else selectEl.value = '';
  }

  function renderSubjectOptions(selectEl, allQuestions, filters, mode) {
    const current = selectEl.value;
    const normCanonical = new Set(SUBJECT_PRIORITY.map(normalizeSubjectName));
    const extraSubjects = uniqueSorted(
      allQuestions
        .map(q => q.subject)
        .filter(Boolean)
        .filter(s => !normCanonical.has(normalizeSubjectName(s)))
    );
    selectEl.innerHTML = '';
    // 件数の算出（フィルタ条件のうち年度・難易度・モードを考慮）
    const countFor = (label) => {
      const subj = label ? normalizeSubjectName(label) : '';
      return allQuestions.filter(q => {
        const okSubject = !label || normalizeSubjectName(q.subject) === subj;
        const okYear = !filters.year || String(q.year) === String(filters.year);
        const okDiff = !filters.difficulty || Number(q.difficulty) === Number(filters.difficulty);
        const okDue = mode === 'review' ? isDue(q) : true;
        return okSubject && okYear && okDiff && okDue;
      }).length;
    };
    const totalCount = countFor('');
    const optAll = document.createElement('option');
    optAll.value = '';
    optAll.textContent = `すべて（${totalCount}）`;
    selectEl.appendChild(optAll);
    // 正規科目（表示は正式名称、値は同じ文字列）
    SUBJECT_CANONICAL.forEach(label => {
      const c = countFor(label);
      const opt = document.createElement('option');
      opt.value = label;
      opt.textContent = `${label}（${c}）`;
      opt.disabled = c === 0;
      selectEl.appendChild(opt);
    });
    // データ側の未知科目（存在する場合のみ）
    extraSubjects.forEach(label => {
      const c = countFor(label);
      const opt = document.createElement('option');
      opt.value = label;
      opt.textContent = `${label}（${c}）`;
      opt.disabled = c === 0;
      selectEl.appendChild(opt);
    });
    // 選択状態維持
    const exists = Array.from(selectEl.options).some(o => o.value === current);
    if (exists) selectEl.value = current; else selectEl.value = '';
  }

  function getSelectedMode() {
    return document.querySelector('input[name="mode"]:checked')?.value || 'study';
  }

  function currentFilter() {
    return {
      subject: els.subjectSelect.value || '',
      year: els.yearSelect.value || '',
      difficulty: els.difficultySelect.value || '',
    };
  }

  // ---------- クイズセッション ----------
  let session = null;

  function startSession(mode) {
    const all = loadQuestions();
    const filtered = filterQuestions(all, currentFilter());
    let pool = filtered;

    if (mode === 'review') {
      pool = filtered.filter(isDue);
    }

    if (!pool.length) {
      alert('条件に合致する問題がありません。フィルタやモードを見直してください。');
      return;
    }

    // 科目未指定（=すべて）の場合は、科目間で均等になるよう並べ替え
    if (!currentFilter().subject) {
      pool = balanceBySubject(pool);
    } else {
      // 指定がある場合は単純にシャッフル
      pool = shuffle([...pool]);
    }

    session = {
      mode,
      index: 0,
      order: pool,
      answered: false,
    };
    els.quiz.classList.remove('hidden');
    els.nextBtn.classList.add('hidden');
    els.endBtn.classList.add('hidden');
    renderCurrentQuestion();
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function renderCurrentQuestion() {
    if (!session) return;
    const q = session.order[session.index];
    if (!q) return;

    els.quizMeta.textContent = `${q.subject} / ${q.year} / No.${q.number} / 難易度${q.difficulty}`;
    els.stem.textContent = q.stem;
    els.choices.innerHTML = '';
    els.explanation.textContent = q.explanation || '';
    els.explanation.classList.add('hidden');

    q.choices.forEach((c, i) => {
      const id = `c_${i}`;
      const row = document.createElement('label');
      row.className = 'choice';
      row.innerHTML = `<input type="radio" name="choice" value="${i}" /> <span>${c.text}</span>`;
      row.addEventListener('click', () => onSelectChoice(q, i, row));
      els.choices.appendChild(row);
    });

    session.answered = false;
    els.nextBtn.classList.add('hidden');
    els.endBtn.classList.toggle('hidden', session.index + 1 !== session.order.length);
  }

  function onSelectChoice(q, idx, row) {
    if (session?.answered) return; // 重複回答防止
    session.answered = true;

    // 採点
    const isCorrect = !!q.choices[idx]?.correct;
    // 表示
    Array.from(els.choices.children).forEach((el, i) => {
      const ok = !!q.choices[i]?.correct;
      el.classList.toggle('correct', ok);
      if (!ok && i === idx) el.classList.add('incorrect');
    });
    els.explanation.classList.remove('hidden');

    // 進捗更新
    updateAfterAnswer(q.id, isCorrect);
    refreshFiltersAndStats();

    // 次へ
    const last = session.index + 1 >= session.order.length;
    els.nextBtn.classList.toggle('hidden', last);
    els.endBtn.classList.toggle('hidden', !last);
  }

  function nextQuestion() {
    if (!session) return;
    session.index += 1;
    if (session.index >= session.order.length) {
      endSession();
      return;
    }
    renderCurrentQuestion();
  }

  function endSession() {
    session = null;
    els.quiz.classList.add('hidden');
    alert('セッションを終了しました。おつかれさまです！');
  }

  // ---------- インポート/エクスポート/リセット ----------
  async function importQuestionsFromFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return alert('ファイルを選択してください');
    const all = [];
    for (const f of files) {
      try {
        const json = JSON.parse(await f.text());
        if (Array.isArray(json)) all.push(...json);
      } catch (_) {}
    }
    // 既存データとマージ（id重複は今回インポート分で上書き）
    const existing = loadQuestions();
    const byId = new Map(existing.map(q => [q.id, q]));
    for (const q of all) if (validQuestion(q)) byId.set(q.id, q);
    const merged = Array.from(byId.values());
    if (!merged.length) return alert('有効な問題が見つかりません');
    saveJSON(STORAGE.questions, merged);
    alert(`現在の問題数: ${merged.length}件（既存と統合・重複は上書き）`);
    refreshFiltersAndStats();
  }

  function validQuestion(q) {
    if (!q || typeof q !== 'object') return false;
    if (!q.id || !q.subject || !q.year || !q.number || !q.stem || !Array.isArray(q.choices)) return false;
    const hasCorrect = q.choices.some(c => c && typeof c.text === 'string' && !!c.correct);
    return hasCorrect;
  }

  function exportQuestions() {
    const data = loadQuestions();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'questions.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function resetProgress() {
    if (!confirm('進捗をリセットしますか？（元に戻せません）')) return;
    saveJSON(STORAGE.progress, { byQuestionId: {}, stat: { total: 0, correct: 0 } });
    alert('進捗をリセットしました');
    refreshFiltersAndStats();
  }

  // ---------- 同期（任意） ----------
  function settings() {
    const s = loadJSON(STORAGE.settings, {});
    return {
      serverUrl: s.serverUrl || '',
      syncEnabled: !!s.syncEnabled,
      theme: s.theme || 'dark',
    };
  }

  function saveSettings(partial) {
    const s = settings();
    const n = { ...s, ...partial };
    saveJSON(STORAGE.settings, n);
  }

  function applyTheme(theme) {
    const t = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    updateThemeToggleLabel(t);
  }

  function updateThemeToggleLabel(theme) {
    if (!els.themeToggle) return;
    if (theme === 'light') {
      els.themeToggle.textContent = '☀️ ライト';
    } else {
      els.themeToggle.textContent = '🌙 ダーク';
    }
  }

  async function pullFromServer() {
    const { serverUrl } = settings();
    if (!serverUrl) return alert('サーバURLを入力してください');
    try {
      const [qRes, pRes] = await Promise.all([
        fetch(serverUrl + '/api/questions', { credentials: 'omit' }),
        fetch(serverUrl + '/api/progress', { credentials: 'omit' })
      ]);
      if (!qRes.ok || !pRes.ok) throw new Error('HTTP ' + qRes.status + '/' + pRes.status);
      const qs = await qRes.json();
      const pr = await pRes.json();
      if (Array.isArray(qs)) saveJSON(STORAGE.questions, qs);
      if (pr && pr.byQuestionId) saveJSON(STORAGE.progress, pr);
      alert('サーバから取得しました');
      // ローカルのキャッシュ変数progressは参照のままなので再読込が必要
      location.reload();
    } catch (e) {
      console.error(e);
      alert('サーバからの取得に失敗しました');
    }
  }

  async function pushToServer() {
    const { serverUrl } = settings();
    if (!serverUrl) return alert('サーバURLを入力してください');
    try {
      const qs = loadQuestions();
      const pr = loadJSON(STORAGE.progress, progress);
      const headers = { 'Content-Type': 'application/json' };
      const r1 = await fetch(serverUrl + '/api/questions', { method: 'POST', headers, body: JSON.stringify(qs) });
      const r2 = await fetch(serverUrl + '/api/progress', { method: 'POST', headers, body: JSON.stringify(pr) });
      if (!r1.ok || !r2.ok) throw new Error('HTTP ' + r1.status + '/' + r2.status);
      alert('サーバへ送信しました');
    } catch (e) {
      console.error(e);
      alert('サーバへの送信に失敗しました');
    }
  }

  // ---------- URLからのインポート ----------
  async function importQuestionsFromUrl(urlStr) {
    if (!urlStr) { alert('URLを入力してください'); return; }
    let text;
    try {
      const res = await fetch(urlStr, { credentials: 'omit' });
      if (!res.ok) throw new Error('direct fetch failed');
      text = await res.text();
    } catch (e) {
      const s = settings();
      if (!s.serverUrl) { alert('CORSで取得できません。サーバURLを設定して再試行してください。'); return; }
      const proxy = s.serverUrl.replace(/\/$/, '') + '/api/proxy?url=' + encodeURIComponent(urlStr);
      const res = await fetch(proxy, { credentials: 'omit' });
      if (!res.ok) { alert('サーバプロキシ経由の取得に失敗しました'); return; }
      text = await res.text();
    }
    try {
      const json = JSON.parse(text);
      if (!Array.isArray(json)) { alert('JSON配列が必要です'); return; }
      const existing = loadQuestions();
      const byId = new Map(existing.map(q => [q.id, q]));
      for (const q of json) if (validQuestion(q)) byId.set(q.id, q);
      const merged = Array.from(byId.values());
      saveJSON(STORAGE.questions, merged);
      alert(`URLから取り込み完了。現在の問題数: ${merged.length}件`);
      refreshFiltersAndStats();
    } catch (e) {
      console.error(e);
      alert('取得データの解析に失敗しました');
    }
  }

  // ---------- HTMLページ（PDFリンク一覧）から取得 → ダウンロード → 抽出 → 取り込み ----------
  async function importFromHtmlPage() {
    try {
      const pageUrlEl = document.getElementById('htmlSourceUrl');
      const patternEl = document.getElementById('htmlPattern');
      const subjectEl = document.getElementById('htmlSubject');
      const yearEl = document.getElementById('htmlYear');
      const pageUrl = (pageUrlEl?.value || '').trim();
      const patternRaw = (patternEl?.value || '\\.[pP][dD][fF](\\\\?|#|$)').trim();
      const pattern = patternRaw.replace(/\\\\/g, '\\'); // ユーザーが \\ を入力した場合に \\ -> \ に正規化
      const subject = (subjectEl?.value || '').trim();
      const year = Number((yearEl?.value || '').trim()) || 0;

      const { serverUrl } = settings();
      if (!serverUrl) { alert('サーバURLを設定してください（例: http://localhost:8787）'); return; }
      if (!/^https?:\/\//i.test(pageUrl)) { alert('ページURLを正しく入力してください'); return; }
      const base = serverUrl.replace(/\/$/, '');

      // 1) ダウンロード（URLがPDFなら単体、HTMLなら抽出して一括）
      let files = [];
      if (/\.pdf(\?|#|$)/i.test(pageUrl)) {
        const r = await fetch(base + '/api/download-file?url=' + encodeURIComponent(pageUrl), { method: 'POST', credentials: 'omit' });
        if (!r.ok) throw new Error('download_failed');
        const json = await r.json();
        if (json?.ok && json.file) files.push(json.file);
      } else {
        const patternParam = pattern ? '&pattern=' + encodeURIComponent(pattern) : '';
        const dlRes = await fetch(base + '/api/download?url=' + encodeURIComponent(pageUrl) + patternParam, { method: 'POST', credentials: 'omit' });
        if (!dlRes.ok) throw new Error('download_failed');
        const dl = await dlRes.json();
        const items = dl?.items || dl?.results || [];
        files = items.filter(r => r && r.ok && r.file).map(r => r.file);
      }
      if (!files.length) { alert('ダウンロード対象が見つかりませんでした'); return; }

      // 2) 各PDFから問題を抽出（サーバ側がJSONを返すよう対応済み）
      const headers = { 'Content-Type': 'application/json' };
      let collected = [];
      for (const rel of files) {
        const body = { file: rel, meta: { subject, year } };
        const exRes = await fetch(base + '/api/extract-questions', { method: 'POST', headers, body: JSON.stringify(body) });
        if (!exRes.ok) continue;
        const ex = await exRes.json();
        if (Array.isArray(ex?.questions)) collected = collected.concat(ex.questions);
      }
      // テキスト抽出で0件ならOCRにフォールバック（Poppler + ネット接続が必要）
      if (!collected.length) {
        try {
          await fetch(base + '/api/ocr-setup', { method: 'POST', headers, body: JSON.stringify({ langs: 'jpn' }) });
        } catch (_) { /* ignore setup errors; ocr-pdf will report */ }
        for (const rel of files) {
          const body = { file: rel, lang: 'jpn', meta: { subject, year } };
          const r = await fetch(base + '/api/ocr-pdf', { method: 'POST', headers, body: JSON.stringify(body) });
          if (!r.ok) continue;
          const j = await r.json();
          if (Array.isArray(j?.questions)) collected = collected.concat(j.questions);
        }
      }
      if (!collected.length) { alert('抽出に失敗しました（問題が見つかりませんでした）'); return; }

      // 3) ローカルへ統合
      const existing = loadQuestions();
      const byId = new Map(existing.map(q => [q.id, q]));
      for (const q of collected) if (validQuestion(q)) byId.set(q.id, q);
      const merged = Array.from(byId.values());
      saveJSON(STORAGE.questions, merged);
      alert(`HTMLから取り込み完了: ${collected.length}件（現在: ${merged.length}件）`);
      refreshFiltersAndStats();
    } catch (e) {
      console.error(e);
      alert('HTMLページからの取得に失敗しました');
    }
  }

  let pushTimer = null;
  function scheduleProgressPush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { pushToServer().catch(() => {}); }, 500);
  }

  // ---------- イベント登録 ----------
  els.startBtn.addEventListener('click', () => {
    const mode = document.querySelector('input[name="mode"]:checked')?.value || 'study';
    startSession(mode);
  });
  els.nextBtn.addEventListener('click', nextQuestion);
  els.endBtn.addEventListener('click', endSession);
  els.importBtn.addEventListener('click', () => importQuestionsFromFiles(els.importFile.files));
  els.exportBtn.addEventListener('click', exportQuestions);
  els.resetProgressBtn.addEventListener('click', resetProgress);
  if (els.serverUrl) els.serverUrl.addEventListener('change', (e) => saveSettings({ serverUrl: e.target.value }));
  if (els.syncEnabled) els.syncEnabled.addEventListener('change', (e) => saveSettings({ syncEnabled: e.target.checked }));
  if (els.pullBtn) els.pullBtn.addEventListener('click', pullFromServer);
  if (els.pushBtn) els.pushBtn.addEventListener('click', pushToServer);
  if (els.themeToggle) els.themeToggle.addEventListener('click', () => {
    const s = settings();
    const next = s.theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
    saveSettings({ theme: next });
  });
  // URLインポート（elsに未登録でも直接取得）
  const importUrlBtn = document.getElementById('importUrlBtn');
  if (importUrlBtn) importUrlBtn.addEventListener('click', () => {
    const urlInput = document.getElementById('importUrl');
    importQuestionsFromUrl(urlInput ? urlInput.value : '');
  });

  const fetchHtmlBtn = document.getElementById('fetchHtmlBtn');
  if (fetchHtmlBtn) fetchHtmlBtn.addEventListener('click', importFromHtmlPage);

  // 初期表示
  applyTheme(settings().theme || 'dark');
  refreshFiltersAndStats();
})();
