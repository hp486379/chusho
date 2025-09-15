Continue = 'Stop'
C:\Users\shimazu\新しいフォルダー\styles.css = [IO.Path]::GetFullPath("C:\Users\shimazu\新しいフォルダー\styles.css")
C:\Users\shimazu\デスクトップ\codex\kids-allowance-main\kids-allowance\styles.css = [IO.Path]::GetFullPath("C:\Users\shimazu\デスクトップ\codex\kids-allowance-main\kids-allowance\styles.css")
Write-Host "Starting watcher: C:\Users\shimazu\新しいフォルダー\styles.css -> C:\Users\shimazu\デスクトップ\codex\kids-allowance-main\kids-allowance\styles.css"
 = Join-Path "C:\Users\shimazu\新しいフォルダー" 'watch-css-copy.ps1'
& powershell -NoProfile -ExecutionPolicy Bypass -File  -Source C:\Users\shimazu\新しいフォルダー\styles.css -Destination C:\Users\shimazu\デスクトップ\codex\kids-allowance-main\kids-allowance\styles.css
