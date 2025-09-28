# Rollback 手順

安定タグ（`stable-YYYYMMDD`）を作成し、そのタグ時点へ `main` を戻すための GitHub Actions ワークフロー一式です。

## 追加ファイル

- `.github/workflows/tag-stable.yml` — 安定タグ `stable-YYYYMMDD` を作成
- `.github/workflows/rollback.yml` — 指定タグへ戻すための PR を自動作成（任意で自動マージ）

## 前提条件

- リポジトリの `GITHUB_TOKEN` に `contents: write`, `pull-requests: write` 権限が必要です（ワークフロー定義で明示済み）。
- `main` が保護ブランチの場合、自動マージがブロックされることがあります。その際は PR を手動で確認・マージしてください。

## 手順

### 1) 安定タグの作成（Tag Stable）

1. GitHub の Actions タブから `Tag Stable` を選択
2. `Run workflow` で以下を指定して実行
   - `ref`: `main`（既定）
   - `date`: 空欄で当日（UTC）の日付が使われます。必要なら `YYYYMMDD` を明示
3. 作成されるタグ名は `stable-YYYYMMDD` です

### 2) ロールバック PR の作成（Rollback via PR）

1. GitHub の Actions タブから `Rollback via PR` を選択
2. `Run workflow` で以下を指定して実行
   - `tag`: 戻したいタグ（例: `stable-20240928`）
   - `target_branch`: 戻す先のブランチ（既定: `main`）
   - `auto_merge`: 可能なら自動マージを試行（既定: `false`）
   - `pr_title`, `pr_body`: 任意。未指定なら既定文言になります
3. 成功すると `rollback/<branch>-to-<tag>-<timestamp>` ブランチが作成され、差分をまとめた PR が自動で作成されます
4. `auto_merge` を `false` にしている場合やブランチ保護でブロックされる場合は、PR を確認して手動マージしてください

## しくみ（概要）

- Tag Stable: `ref`（既定 `main`）のコミットに対して、同日の `stable-YYYYMMDD` タグを新規作成します（既存同名タグが別コミットを指している場合はエラー）
- Rollback via PR: `tag..origin/<target_branch>` の差分を `git revert` でまとめて反転し、ロールバック用のブランチ＋PRを作成します
  - 競合が発生した場合は安全のため中断（PRは作られません）。手動での解消が必要です
  - 指定タグがターゲットブランチの祖先でない場合は中断します

## ワンフレーズ例

- 「kids-allowance: chore/rollback-workflows から PR 作成→main 反映を続けて」
- 「安定タグ stable-YYYYMMDD 作成→Rollback workflow で main をそのタグに戻す手順を実行して」

## 備考

- 初回はこのブランチ（`chore/rollback-workflows`）から本ワークフローの PR を作成・マージしてください
- タグを過去に巻き戻さない運用（同名タグを移動しない）を前提にしています。既存の同名タグがある場合はエラーで停止します

