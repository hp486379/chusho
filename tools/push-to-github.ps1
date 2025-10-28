[CmdletBinding()]
param(
    [string]$RepositoryUrl = "https://github.com/HP486379/chusho.git",
    [string]$Branch,
    [switch]$ForceRemote,
    [switch]$SkipStatus
)

$ErrorActionPreference = 'Stop'

function Ensure-Git() {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw 'git コマンドが見つかりません。Git for Windows などをインストールしてください。'
    }
}

function Invoke-GitCommand {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [switch]$AllowFailure
    )

    & git @Arguments
    $exitCode = $LASTEXITCODE
    if (-not $AllowFailure -and $exitCode -ne 0) {
        throw "git $($Arguments -join ' ') がエラーコード $exitCode で終了しました。"
    }
    return $exitCode
}

try {
    Ensure-Git

    # Git リポジトリかどうかを確認
    Invoke-GitCommand -Arguments @('rev-parse', '--show-toplevel') | Out-Null
} catch {
    throw "このディレクトリは Git リポジトリではありません。プロジェクトのルートで実行してください。`n詳細: $_"
}

# 現在のブランチ名を取得（なければエラー）
$currentBranch = (& git branch --show-current 2>$null)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($currentBranch)) {
    throw '現在のブランチを取得できません。detached HEAD 状態になっていないか確認してください。'
}
$currentBranch = $currentBranch.Trim()

if (-not $Branch) {
    $Branch = $currentBranch
} else {
    $Branch = $Branch.Trim()
    if (-not $Branch) {
        throw 'ブランチ名が空です。-Branch で値を指定するか、引数を省略して現在のブランチを使ってください。'
    }
}

# origin の確認と設定
$originUrl = (& git remote get-url origin 2>$null)
if ($LASTEXITCODE -eq 0) {
    $originUrl = $originUrl.Trim()
    if ($originUrl -ne $RepositoryUrl) {
        if ($ForceRemote) {
            Write-Host "origin を $originUrl から $RepositoryUrl に更新します。"
            Invoke-GitCommand -Arguments @('remote', 'set-url', 'origin', $RepositoryUrl) | Out-Null
        } else {
            throw "既存の origin が $originUrl を指しています。-ForceRemote を付けるか、RepositoryUrl を変更してください。"
        }
    }
} else {
    Write-Host "origin が設定されていません。$RepositoryUrl を追加します。"
    Invoke-GitCommand -Arguments @('remote', 'add', 'origin', $RepositoryUrl) | Out-Null
}

# コミットが存在するか確認
Invoke-GitCommand -Arguments @('rev-parse', '--verify', 'HEAD') -AllowFailure | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "コミットが存在しません。git add と git commit で少なくとも1件コミットを作成してから再実行してください。"
}

if (-not $SkipStatus) {
    Write-Host "現在の状態 (git status --short):"
    & git status --short
    if ($LASTEXITCODE -ne 0) {
        throw 'git status が失敗しました。'
    }
    Write-Host "\n未コミットの変更がある場合は push 前にコミットしてください。"
}

if ($Branch -ne $currentBranch) {
    Write-Host "ローカルブランチ $currentBranch をリモートブランチ $Branch として push します。"
} else {
    Write-Host "ブランチ $currentBranch を origin/$Branch に push します。"
}

Write-Host "git push -u origin HEAD:$Branch を実行します。GitHub の認証情報が必要な場合はプロンプトに従って入力してください。"

& git push -u origin "HEAD:$Branch"
$pushExit = $LASTEXITCODE
if ($pushExit -ne 0) {
    throw "git push がエラーコード $pushExit で終了しました。上記メッセージを確認してください。"
}

Write-Host "\nPush が完了しました。GitHub 上の https://github.com/HP486379/chusho/tree/$Branch を確認してください。"

if ($Branch -ne $currentBranch) {
    Write-Host "今後このブランチ名で作業する場合は git push origin HEAD:$Branch を再利用できます。"
} else {
    Write-Host "次回からは git push だけで更新できます。"
}
