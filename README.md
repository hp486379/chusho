# 中小企業診断士 学習アプリ (MVP)

ローカルで動く最小構成のWebアプリです。中小企業診断士の一次試験の問題を体系的に学ぶための、学習モード・復習（間隔反復）モード・進捗保存（localStorage）を備えています。

## 使い方

- `index.html` をブラウザで開きます（ダブルクリックでOK）。
- 画面上部で科目・年度・難易度・モードを選び「学習開始」。
- 回答結果は自動で保存され、復習モードでは「期限が来た問題」から優先的に出題されます。
- 「データ管理」から問題データのインポート（JSON）/エクスポートができます。

### 実試験データの投入（複数ファイルOK）

- 公式問題は著作権の都合で同梱していません。手元のデータをJSON配列で用意し、画面の「問題をインポート（複数可）」から一括投入できます。
- 複数ファイルを同時選択すれば、`id`キーで既存データと統合（重複は上書き）されます。

#### CSVからの一括変換（ローカル）

- `tools/csv-to-json.js`（依存なし）でCSV→JSON配列に変換できます。
- サンプルCSV: `tools/sample-questions.csv`
- 使い方:
  - CSVをUTF-8で保存
  - `node tools/csv-to-json.js input.csv > questions.json`
- 期待カラム名（ヘッダ、大小文字や空白は無視）
  - `subject, year, number, difficulty, stem, choice1..choice4, correct, explanation`
  - `correct`は 1..N または A/B/C/D
  - `id`は自動生成（例: `2021-eco-01`）

## データスキーマ（問題）

```json
{
  "id": "2021-eco-01",
  "subject": "経済学・経済政策",
  "year": 2021,
  "number": 1,
  "difficulty": 2,
  "tags": ["ミクロ", "需要供給"],
  "stem": "需要曲線が右にシフトするとき…",
  "choices": [
    { "text": "価格↑ 取引量↑", "correct": true },
    { "text": "価格↑ 取引量↓", "correct": false },
    { "text": "価格↓ 取引量↑", "correct": false },
    { "text": "価格↓ 取引量↓", "correct": false }
  ],
  "explanation": "需要増加は均衡価格と取引量をともに押し上げる。"
}
```

- 単一正解の択一式を想定（`choices`に1つだけ`correct: true`）。
- 自由に拡張可能（例: 画像、複数正解、設問形式など）。

## 復習ロジック（Leitner法の簡易版）

- 学習履歴は `localStorage` に保存。
- 箱（Box）に応じた間隔: [0, 1, 3, 7, 14, 30, 60] （日）
- 正解: 箱+1、誤答: 箱=0、次回出題をスケジューリング。

## 次の拡張候補

- 模試モード（制限時間・一括採点）。
- ユーザー/問題のサーバ同期（SQLite/Cloud）。
- 分析ダッシュボード（科目別・論点別の弱点可視化）。
- CSV/Excelインポート、画像/表の埋め込み。

## ライセンス等

- このMVPは依存ライブラリなし（純粋なHTML/CSS/JS）。
- ブラウザの`localStorage`を使用（ブラウザや端末変更でデータは引き継がれません）。

## 軽量バックエンドによる端末間同期（任意）

- 依存なしのNode.jsサーバが同梱されています。
- 起動方法:
  1. Node.js をインストール
  2. ターミナルでこのフォルダを開き、以下を実行
     - `node server/mini-backend.js`
  3. 既定ポート: `http://localhost:8787`
- フロント側の「同期」欄でURLを指定し「サーバから取得 / サーバへ送信」を利用。チェックで自動同期（回答後に進捗を送信）も可。
- 保存先: `server/data/questions.json` と `server/data/progress.json`
- 競合解決: 進捗は `updatedAt` の新しい方を採用してサーバ側でマージ、統計は再計算します。

### Webからの取り込み（JSON配列）

- 画面の「URLからインポート」でJSON配列のURLを指定し、[URLを読み込み]をクリック。
- CORSで取得できない場合は、同期欄の「サーバURL」に `http://localhost:8787` を設定すると、サーバの `/api/proxy` 経由で取得できます。
- 注意: 著作権に注意し、利用が許可されたデータのみ取り込んでください。

### WebページからPDFリンクの一括ダウンロード（LEC等）

- サーバ起動後、リンク抽出のプレビュー:
  - 例（LECの過去問DLページ）
  - `http://localhost:8787/api/extract-links?url=https%3A%2F%2Fwww.lec-jp.com%2Fshindanshi%2Finfo%2Fdownload%2Fkakomon.html&pattern=\.pdf$`
- ダウンロード実行（POST）: 取得したページ内のパターンに一致するリンクを `server/data/downloads/` に保存します。
  - PowerShell例:
    - `Invoke-WebRequest -Method Post "http://localhost:8787/api/download?url=https%3A%2F%2Fwww.lec-jp.com%2Fshindanshi%2Finfo%2Fdownload%2Fkakomon.html&pattern=\.pdf$"`
  - 結果JSONに保存パスが含まれます。
- その後、必要に応じてPDF→問題データ(JSON)への変換を行います（要実装）。抽出ロジックはサイトの構成に依存するため、対象PDFのサンプルを共有ください。

### PDFからの抽出（テキスト→問題JSON：簡易）

依存: `pdf-parse`

1) 単一PDFのテキスト取得
- `http://localhost:8787/api/parse-pdf?file=downloads/<保存されたPDF名>`

2) 単一PDFから問題抽出（簡易ヒューリスティック）
- POST `http://localhost:8787/api/extract-questions`
- Body(JSON): `{ "file": "downloads/<PDF名>", "meta": { "subject": "経営情報システム", "year": 2022 } }`
- 出力: `server/data/extracted/<PDF名>.json` に保存され、件数がJSONで返ります

3) downloads 配下の全PDFを一括抽出
- POST `http://localhost:8787/api/extract-all`
- 抽出結果は `server/data/extracted/` に `.json` で保存されます

注意
- この抽出は汎用のヒューリスティック（「第◯問」「問◯」分割、(1)〜(4)／ア〜エ／A〜D など）です。PDFレイアウトにより精度が変わります。
- 正解はPDFの別紙等に依存するため、初期版では付与されないことがあります。必要に応じてパターンを追加入力します。

### OCRパイプライン（スキャンPDF用）

1) 言語データの取得（初回のみ）
- POST `http://localhost:8787/api/ocr-setup`
- Body(JSON): `{ "langs": "jpn,eng" }`
- 保存先: `server/data/tessdata/` に `jpn.traineddata` などをダウンロード

2) PDFの画像化（pdftoppm が必要）→ OCR → 抽出
- Poppler（pdftoppm）がPATHにある場合:
  - POST `http://localhost:8787/api/ocr-pdf`
  - Body(JSON): `{ "file": "downloads/<PDF名>", "lang": "jpn", "meta": { "subject": "...", "year": 2025 } }`
- 画像は `server/data/tmp/<PDF名基準>/` に生成、抽出結果は `server/data/extracted/*.ocr.json`
- pdftoppm が無い場合:
  - PDFを手元でPNGへ変換（300dpi推奨）し、`server/data/downloads/` に配置
  - 画像毎に POST `/api/ocr-image` → 返却テキストをまとめて `/api/extract-questions` へ渡す（手動）

注: OCRは処理時間がかかります。最初に1〜2ページで確認し、ルール調整後に全ページへ拡張すると効率的です。

## GitHub へのプッシュ手順

演習用コンテナにはリモートリポジトリが設定されていません。ご自身の GitHub リポジトリへ反映する場合は、以下の手順でリモートを登録し、push を実行してください。

1. GitHub で空のリポジトリ（例: `HP486379/chusho`）を作成します。
2. このディレクトリで既存のリモート設定を確認します。

   ```bash
   git remote -v
   ```

   - `origin` が未設定なら、以下で新しく追加します。

     ```bash
     git remote add origin https://github.com/HP486379/chusho.git
     ```

   - 既に `origin` が存在し、別のURLを指している場合は、`set-url` で上書きできます。

     ```bash
     git remote set-url origin https://github.com/HP486379/chusho.git
     ```

   - 不要なリモートを削除して付け直したい場合は、`git remote remove origin` を実行してから `git remote add ...` を再度行ってください。

3. ブランチを push します（認証が必要です）。

   ```bash
   git push -u origin work
   ```

   - `error: src refspec work does not match any` が表示された場合は、コミットが 1 つもない状態で push しようとしています。`git status` や
     `git log --oneline` でコミットが存在するかを確認し、必要なら `git add` → `git commit` を行ってください。

4. 以後の更新は `git push` で反映できます。

### 認証エラーへの対処

- `remote: Support for password authentication was removed` などと表示され push が拒否された場合は、GitHub で [Personal Access Token](https://github.com/settings/tokens)
  を発行し、パスワードの代わりにトークンを使用してください。
- `fatal: Authentication failed` が出る場合は、以下のいずれかで認証情報を設定します。
  1. HTTPS を使用: `git remote set-url origin https://<TOKEN>@github.com/HP486379/chusho.git`
     - `<TOKEN>` には発行した PAT を入れます（URL に埋め込む方法が不安な場合は後述の credential helper を推奨）。
  2. Git Credential Manager などを利用して、`git push` 時にトークンを入力・保存します。
  3. SSH を利用する場合は、公開鍵を GitHub に登録し、リモートを `git@github.com:HP486379/chusho.git` に変更します。
- 実行環境に認証情報を保存できない場合は、`GITHUB_TOKEN=<PAT>` として一時的に環境変数を設定し、`git -c credential.helper="!f() { echo username=oauth2; echo password=$GITHUB_TOKEN; }; f" push` のように
  1 コマンドだけトークンを渡す方法もあります。

### 参考: push 時に確認したい項目

1. `git status` でコミット漏れがないか。
2. `git remote -v` で push 先 URL が目的のリポジトリか。
3. `git config user.name` / `git config user.email` が適切か。
4. 2 要素認証を有効化している場合は、PAT のスコープに `repo` を含める。

これらを整えた上で再度 `git push -u origin work` を実行すると、GitHub 上のリポジトリにブランチが作成されます。
