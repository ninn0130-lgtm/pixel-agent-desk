/**
 * Process Watcher
 * - Claude 프로세스 실행 여부 감지 (PowerShell / WMI)
 * - 에이전트 클릭 시 해당 터미널 창 포커스
 */

const { exec, spawn } = require('child_process');
const { normalizePath } = require('./utils');

class ProcessWatcher {
    /**
     * claude.exe 프로세스 목록을 비동기로 가져옴
     * @returns {Promise<Array>} [{ ProcessId, ParentProcessId, WorkingDirectory }]
     */
    getClaudeProcesses() {
        return new Promise((resolve) => {
            const cmd = `Get-CimInstance Win32_Process -Filter "name='claude.exe'" | Select-Object ProcessId,ParentProcessId,WorkingDirectory | ConvertTo-Json -Compress`;
            exec(`powershell -NoProfile -NonInteractive -Command "${cmd}"`,
                { timeout: 5000, windowsHide: true },
                (err, stdout) => {
                    if (err || !stdout.trim()) return resolve([]);
                    try {
                        const parsed = JSON.parse(stdout.trim());
                        const arr = Array.isArray(parsed) ? parsed : [parsed];
                        resolve(arr.filter(p => p && p.WorkingDirectory));
                    } catch { resolve([]); }
                }
            );
        });
    }

    /**
     * 특정 cwd의 Claude 프로세스가 실행 중인지 확인
     * @param {string} cwd - 에이전트의 projectPath
     * @param {Array} processes - getClaudeProcesses() 결과 (미리 가져온 경우)
     */
    isRunningForCwd(cwd, processes = []) {
        if (!cwd || !processes.length) return false;
        const target = normalizePath(cwd);
        return processes.some(p => normalizePath(p.WorkingDirectory) === target);
    }

    /**
     * cwd에 해당하는 터미널 창을 최상위로 포커스
     * claude.exe 프로세스 트리를 올라가며 창 핸들을 찾고 SetForegroundWindow 호출
     * @param {string} cwd
     */
    focusTerminal(cwd) {
        if (!cwd) return;

        // PowerShell 경로 패스용 이스케이프
        const safeCwd = cwd.replace(/\\/g, '\\\\').replace(/'/g, "''");

        const script = `
$targetCwd = '${safeCwd}'.ToLower().TrimEnd('\\\\')

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinHelper {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

function Focus-Window([IntPtr]$hwnd) {
    [WinHelper]::ShowWindow($hwnd, 9) | Out-Null   # SW_RESTORE
    [WinHelper]::SetForegroundWindow($hwnd) | Out-Null
}

# claude.exe 프로세스 탐색 (cwd 일치 우선)
$claudeProcs = Get-CimInstance Win32_Process -Filter "name='claude.exe'" |
    Where-Object { $_.WorkingDirectory.ToLower().TrimEnd('\\\\') -eq $targetCwd }

$focused = $false
foreach ($proc in $claudeProcs) {
    $pid = [int]$proc.ParentProcessId
    for ($i = 0; $i -lt 5; $i++) {
        $p = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) {
            Focus-Window $p.MainWindowHandle
            $focused = $true
            break
        }
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$pid" -ErrorAction SilentlyContinue
        if (-not $parent) { break }
        $pid = [int]$parent.ParentProcessId
    }
    if ($focused) { break }
}

# 폴백: 가장 최근 터미널 창
if (-not $focused) {
    $term = @('WindowsTerminal','wt','powershell','pwsh','cmd') | ForEach-Object {
        Get-Process -Name $_ -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero }
    } | Where-Object { $_ } | Sort-Object StartTime -Descending | Select-Object -First 1
    if ($term) { Focus-Window $term.MainWindowHandle }
}`;

        spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
        }).unref();
    }
}

module.exports = ProcessWatcher;
