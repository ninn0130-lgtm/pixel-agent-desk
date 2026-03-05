/**
 * Dashboard Web Server
 * Enhanced with REST API and WebSocket for real-time updates
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { adaptAgentToDashboard } = require('./dashboardAdapter');

const PORT = 3000;
const HTML_FILE = path.join(__dirname, 'dashboard.html');

// MIME 타입 매핑
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

// Global references
let agentManager = null;
let sessionScanner = null;  // Task 3B-2
let missionControlWindow = null;
const wsClients = new Set();
const sseClients = new Set();  // Task 3B-1: SSE 클라이언트

/**
 * Set the agent manager reference
 */
function setAgentManager(manager) {
  agentManager = manager;

  // Task 3B-1: AgentManager 이벤트 → SSE 브로드캐스트
  if (agentManager) {
    agentManager.on('agent-added', (agent) => {
      const adapted = adaptAgentToDashboard(agent);
      broadcastSSE('agent.created', adapted);
      broadcastUpdate('agent-added', adapted);
    });
    agentManager.on('agent-updated', (agent) => {
      const adapted = adaptAgentToDashboard(agent);
      broadcastSSE('agent.updated', adapted);
      broadcastUpdate('agent-updated', adapted);
    });
    agentManager.on('agent-removed', (data) => {
      broadcastSSE('agent.removed', data);
      broadcastUpdate('agent-removed', data);
    });
  }
}

/**
 * Set the session scanner reference (Task 3B-2)
 */
function setSessionScanner(scanner) {
  sessionScanner = scanner;
}

/**
 * Set the Dashboard window reference
 */
function setDashboardWindow(window) {
  missionControlWindow = window;
}

/**
 * Calculate statistics from agents
 */
function calculateStats() {
  if (!agentManager) {
    return { total: 0, active: 0, completed: 0, byState: {} };
  }

  const agents = agentManager.getAllAgents();
  const stats = {
    total: agents.length,
    active: 0,
    completed: 0,
    working: 0,
    thinking: 0,
    waiting: 0,
    help: 0,
    error: 0,
    done: 0,
    offline: 0,
    byProject: {},
    byType: {
      main: 0,
      subagent: 0,
      teammate: 0
    }
  };

  for (const agent of agents) {
    // State counts
    const state = agent.state.toLowerCase();
    if (stats[state] !== undefined) {
      stats[state]++;
    }

    // Active/Completed counts
    if (agent.state === 'Working' || agent.state === 'Thinking') {
      stats.active++;
    } else if (agent.state === 'Done') {
      stats.completed++;
      stats.done++;
    } else if (agent.state === 'Waiting') {
      stats.waiting++;
    } else if (agent.state === 'Help') {
      stats.help++;
      stats.active++;
    } else if (agent.state === 'Error') {
      stats.error++;
    } else if (agent.state === 'Offline') {
      stats.offline++;
    }

    // Project grouping
    const project = agent.projectPath ? path.basename(agent.projectPath) : 'Default';
    if (!stats.byProject[project]) {
      stats.byProject[project] = { total: 0, active: 0, completed: 0 };
    }
    stats.byProject[project].total++;
    if (agent.state === 'Working' || agent.state === 'Thinking' || agent.state === 'Help') {
      stats.byProject[project].active++;
    }
    if (agent.state === 'Done') {
      stats.byProject[project].completed++;
    }

    // Type counts
    if (agent.isSubagent) {
      stats.byType.subagent++;
    } else if (agent.isTeammate) {
      stats.byType.teammate++;
    } else {
      stats.byType.main++;
    }
  }

  // Task 3B-2: 토큰/비용 합산
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalEstimatedCost = 0;
  for (const agent of agents) {
    const usage = agent.tokenUsage;
    if (usage) {
      totalInputTokens += usage.inputTokens || 0;
      totalOutputTokens += usage.outputTokens || 0;
      totalEstimatedCost += usage.estimatedCost || 0;
    }
  }
  stats.tokens = {
    input: totalInputTokens,
    output: totalOutputTokens,
    total: totalInputTokens + totalOutputTokens,
    estimatedCost: Math.round(totalEstimatedCost * 10000) / 10000
  };

  return stats;
}

/**
 * Task 3B-1: SSE 브로드캐스트
 */
function broadcastSSE(type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify({ type, data, timestamp: Date.now() })}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch { sseClients.delete(res); }
  }
}

/**
 * Broadcast update to all WebSocket clients
 */
function broadcastUpdate(type, data) {
  const message = JSON.stringify({ type, data, timestamp: Date.now() });

  wsClients.forEach(client => {
    if (client.readyState === 1) { // WebSocket.OPEN
      try {
        client.send(message);
      } catch (error) {
        console.error('[Dashboard] Error sending to client:', error.message);
      }
    }
  });
}

/**
 * Handle HTTP request
 */
function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  console.log(`[Dashboard Server] ${req.method} ${pathname}`);

  // API routes
  if (pathname.startsWith('/api/')) {
    handleAPIRequest(req, res, url);
    return;
  }

  // WebSocket upgrade
  if (pathname === '/ws') {
    // This will be handled by the WebSocket server
    res.writeHead(426); // Upgrade Required
    res.end('WebSocket connection required');
    return;
  }

  // Static files
  if (pathname === '/' || pathname === '/index.html') {
    fs.readFile(HTML_FILE, (err, data) => {
      if (err) {
        console.error('[Dashboard Server] Error reading HTML:', err);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
}

/**
 * Handle API requests
 */
function handleAPIRequest(req, res, url) {
  const pathname = url.pathname;

  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // ─── Task 3B-1: SSE 이벤트 스트림 ───
  if (pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(`event: connected\ndata: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);
    sseClients.add(res);

    // Keep-alive (15초)
    const keepAlive = setInterval(() => res.write(': keepalive\n\n'), 15000);
    req.on('close', () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
    });
    return;
  }

  // ─── GET /api/agents ───
  if (pathname === '/api/agents' && req.method === 'GET') {
    if (!agentManager) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Agent manager not available' }));
      return;
    }
    const agents = agentManager.getAllAgents().map(adaptAgentToDashboard);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(agents));
    return;
  }

  // ─── POST /api/agents/:id/dismiss — 에이전트 수동 제거 (Task 3B-2) ───
  if (pathname.match(/^\/api\/agents\/[^/]+\/dismiss$/) && req.method === 'POST') {
    if (!agentManager) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Agent manager not available' }));
      return;
    }
    const parts = pathname.split('/');
    const agentId = parts[3];
    const removed = agentManager.dismissAgent(agentId);
    res.writeHead(removed ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: removed, agentId }));
    return;
  }

  // ─── GET /api/agents/:id ───
  if (pathname.startsWith('/api/agents/') && req.method === 'GET') {
    if (!agentManager) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Agent manager not available' }));
      return;
    }
    const agentId = pathname.split('/').pop();
    const agent = agentManager.getAgent(agentId);
    if (!agent) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Agent not found' }));
      return;
    }
    // 세션 스캔 결과 병합
    const sessionStats = sessionScanner ? sessionScanner.getSessionStats(agentId) : null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...agent, sessionStats }));
    return;
  }

  // ─── GET /api/stats ───
  if (pathname === '/api/stats' && req.method === 'GET') {
    const stats = calculateStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
    return;
  }

  // ─── GET /api/sessions — JSONL 스캔 결과 (Task 3B-2) ───
  if (pathname === '/api/sessions' && req.method === 'GET') {
    const allStats = sessionScanner ? sessionScanner.getAllStats() : {};
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(allStats));
    return;
  }

  // ─── GET /api/health ───
  if (pathname === '/api/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      timestamp: Date.now(),
      agents: agentManager ? agentManager.getAgentCount() : 0,
      sseClients: sseClients.size,
      wsClients: wsClients.size
    }));
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'API endpoint not found' }));
}

// Create HTTP server
const server = http.createServer(handleRequest);

// WebSocket server implementation (simple)
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/ws') {
    // Simple WebSocket handshake
    const key = req.headers['sec-websocket-key'];
    const acceptKey = require('crypto')
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
      '\r\n'
    );

    // Create simple WebSocket client wrapper
    const client = {
      socket,
      readyState: 1, // OPEN
      send: (data) => {
        // Simple WebSocket frame encoding
        const frame = [];
        frame.push(0x81); // FIN + Text frame

        const dataBytes = Buffer.from(data);
        const len = dataBytes.length;

        if (len < 126) {
          frame.push(len);
        } else if (len < 65536) {
          frame.push(126, (len >> 8) & 0xff, len & 0xff);
        } else {
          frame.push(127,
            0, 0, 0, 0,  // high 32 bits (JS safe integer range)
            (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff);
        }

        // Server-to-client frames MUST NOT be masked (RFC 6455 Section 5.1)
        socket.write(Buffer.concat([Buffer.from(frame), dataBytes]));
      },
      close: () => {
        socket.end();
      }
    };

    wsClients.add(client);

    // Send initial data
    if (agentManager) {
      const agents = agentManager.getAllAgents();
      client.send(JSON.stringify({
        type: 'initial',
        data: agents,
        timestamp: Date.now()
      }));
    }

    socket.on('close', () => {
      wsClients.delete(client);
      console.log('[Dashboard] WebSocket client disconnected');
    });

    socket.on('error', (err) => {
      console.error('[Dashboard] WebSocket error:', err.message);
      wsClients.delete(client);
    });

    console.log('[Dashboard] WebSocket client connected');
  } else {
    socket.destroy();
  }
});

/**
 * Start the server
 */
function startServer() {
  server.listen(PORT, () => {
    console.log(`[Dashboard Server] 🚀 Server running at http://localhost:${PORT}`);
    console.log(`[Dashboard Server] 📊 Serving dashboard.html`);
    console.log(`[Dashboard Server] 🔌 WebSocket endpoint: ws://localhost:${PORT}/ws`);
  });

  // 에러 처리
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[Dashboard Server] ❌ Port ${PORT} already in use!`);
      console.error('[Dashboard Server] 💡 Another server is already running on this port.');
    } else {
      console.error('[Dashboard Server] ❌ Server error:', err);
    }
  });

  return server;
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Dashboard Server] 🛑 Server shutting down...');

  // Close all WebSocket connections
  wsClients.forEach(client => {
    try {
      client.close();
    } catch (e) {
      // Ignore errors during shutdown
    }
  });
  wsClients.clear();

  server.close(() => {
    console.log('[Dashboard Server] ✅ Server closed');
    process.exit(0);
  });
});

// Export functions for use in main.js
module.exports = {
  setAgentManager,
  setSessionScanner,
  setDashboardWindow,
  broadcastUpdate,
  broadcastSSE,
  calculateStats,
  startServer,
  PORT
};

// If this file is run directly (not required), start the server
if (require.main === module) {
  startServer();
  console.log('[Dashboard Server] Press Ctrl+C to stop');
}
