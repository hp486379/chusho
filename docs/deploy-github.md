# GitHub への公開手順（HP486379/chusho 用）

このドキュメントでは、ローカル環境で編集したアプリを GitHub のリポジトリ `HP486379/chusho` に push し、GitHub Pages を使って公開するまでの流れを説明します。

## 前提

- Git と Node.js がインストールされている PC を利用します。
- 既に手元にこのプロジェクトのフォルダがある（または ZIP を展開済み）ものとします。
- GitHub アカウント `HP486379` に [Personal Access Token (PAT)](https://github.com/settings/tokens) など、push に使用できる認証情報を用意します。

## 1. ローカルでリポジトリを初期化

既に Git 管理下にある場合は、この節をスキップして `git remote` の設定を確認してください。

```bash
cd <プロジェクトのパス>
git init
```

初期化後に `.gitignore` や `.gitattributes` などを必要に応じて追加します。

## 2. GitHub リモートの設定

公式リポジトリの URL を `origin` として登録します。

```bash
git remote add origin https://github.com/HP486379/chusho.git
```

すでに `origin` が存在して別の URL を指している場合は、以下で上書きします。

```bash
git remote set-url origin https://github.com/HP486379/chusho.git
```

設定を確認するには、次を実行します。

```bash
git remote -v
```

`origin` に `https://github.com/HP486379/chusho.git (fetch)` と `(push)` の 2 行が表示されれば OK です。

## 3. 変更ファイルのコミット

ワーキングツリーの状態を確認し、必要なファイルをステージングしてコミットします。

```bash
git status
git add <変更したファイル>
git commit -m "作業内容が分かるメッセージ"
```

最初のコミットを行う場合は、`.gitignore` に `node_modules/` を追加してからコミットするのがおすすめです。

## 4. 現在のブランチを確認

`git branch --show-current` で作業中のブランチ名を確認します。ここで表示されたブランチをそのまま GitHub に公開するのがもっとも簡単です。

```bash
git branch --show-current
```

`main` が表示される場合は次の手順で `main` に push します。`work` や `develop` など別名が表示された場合も同様に進められます。

## 5. GitHub へ push

初回は `-u` オプションを付けて、ローカルブランチとリモートブランチの対応付け（追跡設定）を行います。もっとも失敗しにくいのは、現在のブランチをそのまま push する方法です。

```bash
# 現在のブランチ -> 同名のリモートブランチ
git push -u origin HEAD
```

特定のブランチ名（例: GitHub の既定ブランチを `main` にしたい）で公開したい場合は、次のように指定できます。

```bash
# 現在のブランチをリモートの main ブランチとして公開
git push -u origin HEAD:main
```

> 💡 よくあるエラー: `error: src refspec main does not match any` → ローカルに `main` ブランチが存在しないまま `git push -u origin main` を実行すると発生します。上記のように `HEAD` を使うか、`git branch -M main` でブランチ名を変更してから再度 push してください。

### PowerShell スクリプトで一括 push する場合（Windows）

コマンドを毎回入力するのが面倒な場合は、リポジトリに追加した `tools/push-to-github.ps1` を使うと安全です。PowerShell を開き、プロジェクトのルートで以下を実行します。

```powershell
powershell -ExecutionPolicy Bypass -File tools/push-to-github.ps1
```

- 初回は `origin` が未設定なら自動追加します。
- 既に別の URL が設定されている場合は `-ForceRemote` を付けると上書きできます。
- GitHub の既定ブランチを `main` にしたいときは `-Branch main` を指定します。

例:

```powershell
powershell -ExecutionPolicy Bypass -File tools/push-to-github.ps1 -Branch main -ForceRemote
```

> ⚠️ スクリプトはコミット済みの変更のみを push します。`git add` と `git commit` を終えてから実行してください。未コミットのファイルがあるとエラーを表示します。

### 認証に関するヒント

1. 2 要素認証 (2FA) を有効にしている場合は、パスワードの代わりに PAT を利用します。
2. コマンド実行時にユーザー名・トークンの入力を求められたら、ユーザー名は `HP486379`、パスワード欄に PAT を入力します。
3. トークンを入力したくない場合は、SSH キーを作成して `git@github.com:HP486379/chusho.git` 形式のリモートを利用してください。

## 5. GitHub Pages で公開

1. ブラウザで https://github.com/HP486379/chusho を開きます。
2. `Settings` → 左メニュー `Pages` をクリックします。
3. "Build and deployment" の `Source` を `Deploy from a branch` に設定します。
4. Branch に `main`（または push したブランチ）を選択し、フォルダは `/(root)` を選びます。
5. `Save` を押すと、数十秒後に `https://hp486379.github.io/chusho/` でアプリが閲覧できるようになります。

### 独自ドメインを使いたい場合

GitHub Pages の `Custom domain` にドメイン名を入力し、DNS に `CNAME` レコードを追加します。リポジトリのルートに自動で `CNAME` ファイルが作成されるので、次回以降の push に含めてください。

## 6. 変更を更新する場合

1. ローカルで変更。
2. `git add` → `git commit`。
3. `git push`。
4. GitHub Pages は自動で最新のコミットを再デプロイします（1〜2分で反映）。

## 7. GitHub Actions で自動化したい場合（任意）

`.github/workflows/deploy.yml` を作成し、以下の内容を追加します。`main` ブランチへの push をトリガーに GitHub Pages へデプロイします。

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: ["main"]

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: false

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v4
      - uses: actions/upload-pages-artifact@v3
        with:
          path: .
      - id: deployment
        uses: actions/deploy-pages@v4
```

このワークフローをコミットして `main` に push すれば、自動的に GitHub Pages へ公開されます。Actions タブで実行結果を確認してください。

---

何か問題が発生した場合は、`git status` や Actions のログを確認し、エラーの内容に応じて再度 push を実行してください。
