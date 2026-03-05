/**
 * Universal hook script for all Claude CLI events.
 * Receives JSON from stdin and forwards to the local HTTP hook server.
 * PID 탐지는 main.js에서 PowerShell로 수행 (process.ppid는 셸 PID라 부정확).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const PORT = 47821;

const chunks = [];
process.stdin.on('data', d => chunks.push(d));
process.stdin.on('end', () => {
    try {
        const data = JSON.parse(Buffer.concat(chunks).toString());
        // process.ppid는 셸(cmd.exe) PID이므로 사용하지 않음
        // 실제 Claude PID는 main.js에서 PowerShell로 탐지
        data._timestamp = Date.now();

        // 1. 오프라인 복구 용도로 로컬 파일에 기록 (pixel-agent-desk가 종료된 상태라도 훅 내역 보존)
        try {
            const dir = path.join(os.homedir(), '.pixel-agent-desk');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.appendFileSync(path.join(dir, 'hooks.jsonl'), JSON.stringify(data) + '\n', 'utf-8');
        } catch (e) { }

        const body = Buffer.from(JSON.stringify(data), 'utf-8');

        // 2. HTTP 전송
        const req = http.request({
            hostname: '127.0.0.1',
            port: PORT,
            path: '/hook',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }
        }, () => process.exit(0));

        req.on('error', () => process.exit(0));
        req.setTimeout(3000, () => { req.destroy(); process.exit(0); });
        req.write(body);
        req.end();
    } catch (e) {
        process.exit(0);
    }
});
