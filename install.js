/**
 * Pixel Agent Desk - Auto Installation Script
 *
 * Claude CLI 설정에 HTTP 훅을 자동 등록합니다.
 * npm install 시 자동으로 실행됩니다.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Claude CLI 전역 설정 파일 경로 확인
 */
function getClaudeConfigPath() {
  const platform = os.platform();
  let configDir;

  if (platform === 'win32') {
    configDir = path.join(os.homedir(), '.claude');
  } else {
    configDir = path.join(os.homedir(), '.claude');
  }

  return path.join(configDir, 'settings.json');
}

/**
 * Claude CLI 설정 파일 읽기
 */
function readClaudeConfig(configPath) {
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('[Install] Claude 설정 파일 읽기 실패:', error.message);
  }
  return {};
}

/**
 * Claude CLI 설정 파일 쓰기
 */
function writeClaudeConfig(configPath, config) {
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    console.log('[Install] Claude 설정 파일 업데이트 완료');
    return true;
  } catch (error) {
    console.error('[Install] Claude 설정 파일 쓰기 실패:', error.message);
    return false;
  }
}

/**
 * HTTP 훅 등록
 */
function registerHookScript() {
  const configPath = getClaudeConfigPath();

  console.log('[Install] Claude CLI HTTP 훅 등록 시작...');
  console.log('[Install] 설정 파일 경로:', configPath);

  // 현재 설정 읽기
  const config = readClaudeConfig(configPath);

  // 훅 설정 추가 또는 업데이트
  config.hooks = config.hooks || {};

  // HTTP 훅: Node 프로세스 스폰 없이 Claude가 직접 HTTP POST
  const HTTP_HOOK_URL = 'http://localhost:47821/hook';

  // 모든 훅 이벤트에 HTTP 훅 등록
  const hookEvents = [
    'SessionStart',
    'SessionEnd',
    'UserPromptSubmit',
    'PreToolUse',
    'PostToolUse',
    'PostToolUseFailure',
    'Stop',
    'TaskCompleted',
    'PermissionRequest',
    'Notification',
    'SubagentStart',
    'SubagentStop',
    'TeammateIdle',
    'ConfigChange',
    'WorktreeCreate',
    'WorktreeRemove',
    'PreCompact'
  ];

  let updated = false;
  for (const event of hookEvents) {
    const expected = [{ matcher: '*', hooks: [{ type: 'http', url: HTTP_HOOK_URL }] }];
    const current = config.hooks[event];
    // 이미 HTTP 훅으로 등록된 경우 스킵
    if (current && JSON.stringify(current) === JSON.stringify(expected)) continue;
    config.hooks[event] = expected;
    updated = true;
    console.log(`[Install] ✓ ${event} HTTP 훅 등록`);
  }

  // 이전 버전에서 등록되었을 수 있는 유효하지 않은 훅 제거
  if (config.hooks['InstructionsLoaded']) {
    delete config.hooks['InstructionsLoaded'];
    updated = true;
  }

  if (updated) {
    if (writeClaudeConfig(configPath, config)) {
      console.log('[Install] ✅ Claude CLI 훅 등록 완료!');
      console.log('[Install] 이제 Claude CLI를 사용하면 자동으로 연결됩니다.');
      return true;
    }
  } else {
    console.log('[Install] ✓ 훅이 이미 등록되어 있습니다.');
    return true;
  }

  return false;
}

/**
 * 메인 실행
 */
function main() {
  console.log('=================================');
  console.log('Pixel Agent Desk - 설치 스크립트');
  console.log('=================================\n');

  const success = registerHookScript();

  if (success) {
    console.log('\n=================================');
    console.log('설치 완료!');
    console.log('=================================\n');
    console.log('다음 명령어로 앱을 실행하세요:');
    console.log('  npm start\n');
  } else {
    console.log('\n⚠️  훅 등록에 실패했습니다.');
    console.log('수동으로 ~/.claude/settings.json을 수정하세요.');
    process.exit(1);
  }
}

// 실행
main();
