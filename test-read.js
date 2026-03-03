const JsonlParser = require('./jsonlParser');
const fs = require('fs');

const parser = new JsonlParser();
const filePath = process.env.HOME + '/.claude/projects/D--projects-pixel-agent-desk-master/d02d13d2-678a-42ee-9509-801ca53f96b8.jsonl';

console.log('=== Looking for end_turn in last 50 lines ===\n');

const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n').filter(l => l.trim());
const last50 = lines.slice(-50);

let endTurnCount = 0;
last50.forEach((line, i) => {
  if (line.includes('"stop_reason":"end_turn"')) {
    endTurnCount++;
    const entry = parser.parseLine(line);
    if (entry) {
      const state = parser.determineState(entry);
      console.log(`Line ${lines.length - 50 + i + 1}: stop_reason=end_turn => State: ${state}`);
    }
  }
});

console.log(`\nFound ${endTurnCount} end_turn entries in last 50 lines`);
console.log('\n=== Last 5 lines summary ===');
parser.tailFile(filePath, 5).forEach((entry, i) => {
  const state = parser.determineState(entry);
  const stopReason = entry.message?.stop_reason || 'none';
  console.log(`${i+1}. type=${entry.type}, stop_reason=${stopReason} => ${state || 'null'}`);
});
