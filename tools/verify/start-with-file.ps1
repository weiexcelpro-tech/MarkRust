$exe = 'C:\Work\202607\MarkText优化\marktext-tauri\src-tauri\target\release\markrust-1.0.3.exe'
$file = 'C:\Work\202607\MarkText优化\marktext-develop\README.md'
Stop-Process -Name markrust -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$psi = [System.Diagnostics.ProcessStartInfo]::new($exe, "`"$file`"")
$psi.UseShellExecute = $false
$psi.EnvironmentVariables['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = '--remote-debugging-port=9222 --remote-allow-origins=*'
$p = [System.Diagnostics.Process]::Start($psi)
Write-Host "Started PID: $($p.Id)"

Start-Sleep -Seconds 6
$proc = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
if ($proc) { Write-Host "Process alive" } else { Write-Host "Process EXITED" }

try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:9222/json/version' -UseBasicParsing -TimeoutSec 5
    Write-Host 'CDP READY'
} catch {
    Write-Host 'CDP NOT READY'
    netstat -ano | Select-String '9222'
}
