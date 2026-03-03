/**
 * Universal hook script for all Claude CLI events.
 * Receives JSON from stdin and forwards to the local HTTP hook server.
 * Usage: node hook.js (event type is included in stdin payload)
 */
const http = require('http');

const PORT = 47821;

const chunks = [];
process.stdin.on('data', d => chunks.push(d));
process.stdin.on('end', () => {
    const raw = Buffer.concat(chunks).toString();
    try {
        const data = JSON.parse(raw);
        const body = Buffer.from(raw, 'utf-8');

        const req = http.request({
            hostname: '127.0.0.1',
            port: PORT,
            path: '/hook',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': body.length
            }
        }, (res) => {
            // 서버가 응답하면 성공
            process.exit(0);
        });

        req.on('error', () => {
            // 서버가 없거나 응답 없어도 훅 실행은 막지 않음
            process.exit(0);
        });

        req.setTimeout(3000, () => {
            req.destroy();
            process.exit(0);
        });

        req.write(body);
        req.end();
    } catch (e) {
        process.exit(0);
    }
});
