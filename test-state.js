const JsonlParser = require('./jsonlParser');
const fs = require('fs');

const parser = new JsonlParser();
const filePath = process.env.HOME + '/.claude/projects/D--projects-pixel-agent-desk-master/d02d13d2-678a-42ee-9509-801ca53f96b8.jsonl';

const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n').filter(l => l.trim());

// Find the last end_turn entry
let lastEndTurnIndex = -1;
for (let i = lines.length - 1; i >= 0; i--) {
  if (lines[i].includes('"stop_reason":"end_turn"')) {
    lastEndTurnIndex = i;
    break;
  }
}

if (lastEndTurnIndex >= 0) {
  console.log('=== Found end_turn entry at line', lastEndTurnIndex, '===\n');
  const entry = parser.parseLine(lines[lastEndTurnIndex]);
  if (entry) {
    const state = parser.determineState(entry);
    console.log('Result: State =', state);
    console.log('Expected: Done');
    console.log('Match:', state === 'Done' ? '✓ YES' : '✗ NO');
  }
} else {
  console.log('No end_turn found in recent logs');
}
