$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222 --remote-allow-origins=*'
Start-Process 'C:\Work\202607\MarkText优化\marktext-tauri\src-tauri\target\release\markrust.exe'
Start-Sleep -Seconds 4
try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:9222/json/version' -UseBasicParsing
    Write-Host 'CDP READY'
    Write-Host $r.Content
} catch {
    Write-Host 'CDP NOT READY'
}
