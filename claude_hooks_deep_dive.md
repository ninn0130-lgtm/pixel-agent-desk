# Claude Hooks Deep Dive Analysis

## Executive Summary

This document provides a comprehensive analysis of Claude Code Hooks based on real-world usage data from `hooks.jsonl`, the official reference documentation (`claude-code-hooks-reference.md`), and current implementation in `main.js`.

**Analysis Date:** 2026-03-05
**Project:** pixel-agent-desk-master
**Total Hooks Analyzed:** 491 real hook events from `hooks.jsonl`

---

## 1. Hook Event Inventory

### 1.1 Hooks Currently Observed in Production

| Hook Event | Occurrences | Status | JSON Structure Quality |
|------------|-------------|--------|----------------------|
| `PreToolUse` | 225 | ✅ Active | Complete |
| `PostToolUse` | 204 | ✅ Active | Complete |
| `PostToolUseFailure` | 12 | ✅ Active | Complete |
| `SubagentStop` | 14 | ✅ Active | Partial |
| `SubagentStart` | 11 | ✅ Active | Partial |
| `UserPromptSubmit` | 11 | ✅ Active | Complete |
| `Stop` | 10 | ✅ Active | Complete |
| `TaskCompleted` | 1 | ⚠️ Rare | Complete |
| `SessionStart` | 1 | ⚠️ Rare | Complete |
| `Notification` | 1 | ⚠️ Rare | Complete |
| `SessionEnd` | 0 | ❌ Missing | Not observed |
| `PermissionRequest` | 0 | ❌ Missing | Not observed |
| `TeammateIdle` | 0 | ❌ Missing | Not observed |
| `ConfigChange` | 0 | ❌ Missing | Not observed |
| `WorktreeCreate` | 0 | ❌ Missing | Not observed |
| `WorktreeRemove` | 0 | ❌ Missing | Not observed |
| `PreCompact` | 0 | ❌ Missing | Not observed |
| `InstructionsLoaded` | 0 | ❌ Missing | Not observed |

### 1.2 Hooks Registered but Underutilized

The following hooks are registered in `main.js` but rarely or never appear in production:

- **`SessionEnd`**: Critical for cleanup logic - registered but never observed in JSONL
  - Impact: Session cleanup relies on PID detection instead
  - Recommendation: Investigate why SessionEnd hooks are not firing

- **`PermissionRequest`**: Important for Help state detection
  - Impact: Currently using Notification as fallback
  - Recommendation: Test with permission-sensitive operations

---

## 2. Real JSON Structure Analysis

### 2.1 Core Fields (Present in ALL Hooks)

```json
{
  "session_id": "uuid-v4",           // ✅ Always present
  "transcript_path": "absolute/path", // ✅ Always present
  "cwd": "working/directory",        // ✅ Always present
  "_pid": 12345,                      // ✅ Added by hook.js
  "_timestamp": 1772707479180         // ✅ Added by hook.js
}
```

**Key Finding:** `transcript_path` is consistently available in ALL hooks - this is currently being ignored by `main.js`.

### 2.2 Conditional Fields

#### 2.2.1 `permission_mode`
Present in: PreToolUse, PostToolUse, PostToolUseFailure
```json
"permission_mode": "acceptEdits" | "bypassPermissions"
```

#### 2.2.2 `source` (SessionStart only)
```json
"source": "startup" | "resume"
```

#### 2.2.3 `model` (SessionStart only)
```json
"model": "claude-sonnet-4-6"
```

### 2.3 Tool-Related Fields

#### PreToolUse / PostToolUse / PostToolUseFailure
```json
{
  "hook_event_name": "PreToolUse",
  "tool_name": "Edit" | "Read" | "Bash" | "Grep" | "Glob" | ...,
  "tool_input": {
    // Tool-specific input parameters
    "file_path": "...",
    "old_string": "...",
    "new_string": "...",
    "replace_all": false
  },
  "tool_use_id": "call_<uuid>",     // ✅ Present in PreToolUse, PostToolUse
  "tool_response": {...}             // ✅ Present in PostToolUse only
}
```

#### PostToolUseFailure Additional Fields
```json
{
  "error": "Error message",
  "is_interrupt": false
}
```

### 2.4 Subagent Fields

#### SubagentStart
```json
{
  "agent_id": "a998259372916877a",    // ⚠️ Different from session_id
  "agent_type": "general-purpose"
  // Note: No subagent_session_id field observed
}
```

#### SubagentStop
```json
{
  "agent_id": "a998259372916877a"
  // Note: Similar structure to SubagentStart
}
```

### 2.5 User Prompt Fields

#### UserPromptSubmit
```json
{
  "prompt": "User's message text"
}
```

#### TaskCompleted
```json
{
  "task_id": "1",
  "task_subject": "Task title",
  "task_description": "Detailed description"
}
```

### 2.6 Notification Fields

#### Notification
```json
{
  "message": "Claude is waiting for your input",
  "notification_type": "idle_prompt"
}
```

### 2.7 Stop Event Fields

#### Stop
```json
{
  "stop_hook_active": false,
  "last_assistant_message": "Full response text..."
}
```

---

## 3. Field Usage Analysis

### 3.1 Fields Currently Used in main.js

| Field | Usage | Location |
|-------|-------|----------|
| `session_id` | Agent identification | `processHookEvent()` |
| `cwd` | Project path extraction | `handleSessionStart()` |
| `_pid` | Process lifecycle management | `sessionPids` Map |
| `agent_id` | Subagent tracking | `SubagentStart/Stop` |
| `hook_event_name` | Event routing | Switch statement |

### 3.2 Fields NOT Currently Used (Opportunities)

| Field | Potential Use | Priority |
|-------|---------------|----------|
| `transcript_path` | Direct session log access | 🔥 High |
| `permission_mode` | Permission state tracking | 🟡 Medium |
| `tool_response` | Tool execution monitoring | 🟡 Medium |
| `tool_use_id` | Tool call correlation | 🟢 Low |
| `model` | Model-specific behavior | 🟢 Low |
| `source` | Session type differentiation | 🟢 Low |
| `stop_hook_active` | Stop event validation | 🟢 Low |
| `last_assistant_message` | Response preview | 🟢 Low |

---

## 4. Complete JSON Schemas

### 4.1 Base Schema (All Hooks)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Claude Hook Base Schema",
  "type": "object",
  "required": ["hook_event_name", "session_id", "transcript_path", "cwd"],
  "properties": {
    "hook_event_name": {
      "type": "string",
      "enum": [
        "SessionStart", "SessionEnd", "UserPromptSubmit",
        "PreToolUse", "PostToolUse", "PostToolUseFailure",
        "Stop", "TaskCompleted", "PermissionRequest", "Notification",
        "SubagentStart", "SubagentStop", "TeammateIdle",
        "ConfigChange", "WorktreeCreate", "WorktreeRemove", "PreCompact",
        "InstructionsLoaded"
      ]
    },
    "session_id": {
      "type": "string",
      "format": "uuid"
    },
    "transcript_path": {
      "type": "string",
      "format": "absolute-path"
    },
    "cwd": {
      "type": "string",
      "format": "absolute-path"
    },
    "_pid": {
      "type": "number",
      "description": "Added by hook.js - Claude process PID"
    },
    "_timestamp": {
      "type": "number",
      "description": "Added by hook.js - Unix timestamp in ms"
    }
  }
}
```

### 4.2 SessionStart Schema

```json
{
  "allOf": [
    { "$ref": "#/definitions/base" },
    {
      "properties": {
        "hook_event_name": { "const": "SessionStart" },
        "source": {
          "type": "string",
          "enum": ["startup", "resume"]
        },
        "model": {
          "type": "string",
          "pattern": "^claude-"
        }
      }
    }
  ]
}
```

### 4.3 SessionEnd Schema

```json
{
  "allOf": [
    { "$ref": "#/definitions/base" },
    {
      "properties": {
        "hook_event_name": { "const": "SessionEnd" }
      }
    }
  ]
}
```

### 4.4 UserPromptSubmit Schema

```json
{
  "allOf": [
    { "$ref": "#/definitions/base" },
    {
      "properties": {
        "hook_event_name": { "const": "UserPromptSubmit" },
        "prompt": {
          "type": "string",
          "minLength": 1
        },
        "permission_mode": {
          "type": "string",
          "enum": ["default", "acceptEdits", "bypassPermissions", "autoConfirm"]
        }
      },
      "required": ["prompt"]
    }
  ]
}
```

### 4.5 PreToolUse Schema

```json
{
  "allOf": [
    { "$ref": "#/definitions/base" },
    {
      "properties": {
        "hook_event_name": { "const": "PreToolUse" },
        "permission_mode": {
          "type": "string",
          "enum": ["default", "acceptEdits", "bypassPermissions", "autoConfirm"]
        },
        "tool_name": {
          "type": "string"
        },
        "tool_input": {
          "type": "object"
        },
        "tool_use_id": {
          "type": "string",
          "pattern": "^call_"
        }
      },
      "required": ["tool_name", "tool_input", "tool_use_id"]
    }
  ]
}
```

### 4.6 PostToolUse Schema

```json
{
  "allOf": [
    { "$ref": "#/definitions/base" },
    {
      "properties": {
        "hook_event_name": { "const": "PostToolUse" },
        "permission_mode": {
          "type": "string",
          "enum": ["default", "acceptEdits", "bypassPermissions", "autoConfirm"]
        },
        "tool_name": {
          "type": "string"
        },
        "tool_input": {
          "type": "object"
        },
        "tool_use_id": {
          "type": "string",
          "pattern": "^call_"
        },
        "tool_response": {
          "type": "object",
          "description": "Tool execution result"
        }
      },
      "required": ["tool_name", "tool_input", "tool_use_id", "tool_response"]
    }
  ]
}
```

### 4.7 PostToolUseFailure Schema

```json
{
  "allOf": [
    { "$ref": "#/definitions/base" },
    {
      "properties": {
        "hook_event_name": { "const": "PostToolUseFailure" },
        "permission_mode": {
          "type": "string",
          "enum": ["default", "acceptEdits", "bypassPermissions", "autoConfirm"]
        },
        "tool_name": {
          "type": "string"
        },
        "tool_input": {
          "type": "object"
        },
        "tool_use_id": {
          "type": "string",
          "pattern": "^call_"
        },
        "error": {
          "type": "string",
          "minLength": 1
        },
        "is_interrupt": {
          "type": "boolean"
        }
      },
      "required": ["tool_name", "tool_input", "tool_use_id", "error", "is_interrupt"]
    }
  ]
}
```

### 4.8 SubagentStart Schema

```json
{
  "allOf": [
    { "$ref": "#/definitions/base" },
    {
      "properties": {
        "hook_event_name": { "const": "SubagentStart" },
        "agent_id": {
          "type": "string",
          "pattern": "^[0-9]+$"
        },
        "agent_type": {
          "type": "string",
          "enum": ["general-purpose", "skill", "custom"]
        }
      },
      "required": ["agent_id"]
    }
  ]
}
```

### 4.9 SubagentStop Schema

```json
{
  "allOf": [
    { "$ref": "#/definitions/base" },
    {
      "properties": {
        "hook_event_name": { "const": "SubagentStop" },
        "agent_id": {
          "type": "string",
          "pattern": "^[0-9]+$"
        }
      },
      "required": ["agent_id"]
    }
  ]
}
```

### 4.10 Stop Schema

```json
{
  "allOf": [
    { "$ref": "#/definitions/base" },
    {
      "properties": {
        "hook_event_name": { "const": "Stop" },
        "stop_hook_active": {
          "type": "boolean"
        },
        "last_assistant_message": {
          "type": "string"
        }
      }
    }
  ]
}
```

### 4.11 TaskCompleted Schema

```json
{
  "allOf": [
    { "$ref": "#/definitions/base" },
    {
      "properties": {
        "hook_event_name": { "const": "TaskCompleted" },
        "task_id": {
          "type": "string"
        },
        "task_subject": {
          "type": "string"
        },
        "task_description": {
          "type": "string"
        }
      },
      "required": ["task_id", "task_subject"]
    }
  ]
}
```

### 4.12 Notification Schema

```json
{
  "allOf": [
    { "$ref": "#/definitions/base" },
    {
      "properties": {
        "hook_event_name": { "const": "Notification" },
        "message": {
          "type": "string",
          "minLength": 1
        },
        "notification_type": {
          "type": "string",
          "enum": ["idle_prompt", "error", "warning", "info"]
        }
      },
      "required": ["message", "notification_type"]
    }
  ]
}
```

---

## 5. Missing Hook Analysis

### 5.1 Hooks Never Observed

#### PermissionRequest
**Expected Purpose:** Request for user permission to execute a tool

**Expected Schema:**
```json
{
  "hook_event_name": "PermissionRequest",
  "tool_name": "string",
  "tool_input": "object",
  "permission_mode": "string"
}
```

**Why Missing:** Likely suppressed by `bypassPermissions` mode in production

**Action:** Test with default permission mode to trigger

#### SessionEnd
**Expected Purpose:** Session termination signal

**Expected Schema:**
```json
{
  "hook_event_name": "SessionEnd",
  "end_reason": "user_exit" | "error" | "timeout"
}
```

**Why Missing:** Potential issues:
1. Hook.js may exit before SessionEnd fires
2. SessionEnd might not trigger for all session types
3. Race condition in HTTP server shutdown

**Current Workaround:** PID-based lifecycle detection

**Action:** Add explicit SessionEnd testing

#### TeammateIdle
**Expected Purpose:** Agent team member entering idle state

**Expected Schema:**
```json
{
  "hook_event_name": "TeammateIdle",
  "teammate_name": "string",
  "team_name": "string",
  "idle_reason": "string"
}
```

**Why Missing:** Agent team feature not actively used

**Action:** N/A - low priority

#### ConfigChange
**Expected Purpose:** Configuration file modification detection

**Expected Schema:**
```json
{
  "hook_event_name": "ConfigChange",
  "config_type": "user_settings" | "project_settings" | "local_settings",
  "file_path": "string"
}
```

**Why Missing:** Rare event - requires runtime config changes

**Action:** Test with runtime settings modifications

---

## 6. Implementation Gaps

### 6.1 Current Schema Issues

#### Problem 1: Overly Permissive Schema
```javascript
// Current implementation in main.js (lines 494-532)
const hookSchema = {
  type: 'object',
  required: ['hook_event_name'],
  properties: {
    // Basic fields only
    hook_event_name: { type: 'string', enum: [...] },
    session_id: { type: 'string' },
    sessionId: { type: 'string' },  // ⚠️ Duplicate
    cwd: { type: 'string' },
    state: { type: 'string' },      // ⚠️ Not in actual hooks
    tool: { type: 'string' },       // ⚠️ Should be tool_name
    _pid: { type: 'number' },
    _timestamp: { type: 'number' }
  },
  additionalProperties: true  // ⚠️ Allows invalid data
};
```

**Issues:**
1. `state` field doesn't exist in hook data (should be removed)
2. `tool` should be `tool_name`
3. `sessionId` duplicate (use `session_id` only)
4. Missing tool-specific field validation
5. Missing `transcript_path` (always present!)
6. `additionalProperties: true` bypasses validation

#### Problem 2: Missing Event-Specific Validation

Current implementation validates all hooks with the same schema, missing event-specific required fields:

```javascript
// Example: PreToolUse should require tool_name, tool_input, tool_use_id
// But current schema doesn't enforce this
```

### 6.2 Field Utilization Gaps

#### transcript_path (High Priority)
```javascript
// Current: Ignored
// Opportunity: Direct access to session logs

function handleSessionStart(sessionId, cwd, pid, ...) {
  // Current implementation
  const jsonlPath = null;  // ❌ Hardcoded null

  // Could be:
  const jsonlPath = data.transcript_path;  // ✅ From hook data
}
```

**Benefits:**
1. Direct session log file access
2. Eliminates need for path construction
3. Enables session replay features
4. Accurate session history

#### permission_mode (Medium Priority)
```javascript
// Current: Not tracked
// Opportunity: Permission state visualization

// Could add to agent state:
{
  ...agent,
  permissionMode: data.permission_mode  // "acceptEdits" | "bypassPermissions"
}
```

**Benefits:**
1. Show permission mode in UI
2. Track permission changes over time
3. Audit permission-sensitive operations

#### tool_response (Medium Priority)
```javascript
// Current: Not captured
// Opportunity: Tool execution monitoring

// Could add:
case 'PostToolUse': {
  const toolResponse = data.tool_response;
  // Log tool results for debugging
  // Track tool success rates
  // Provide tool execution history
}
```

**Benefits:**
1. Tool execution analytics
2. Error rate monitoring
3. Performance profiling

---

## 7. Recommendations

### 7.1 Immediate Actions (Priority P0)

1. **Add `transcript_path` to agent creation**
   ```javascript
   function handleSessionStart(sessionId, cwd, pid, ..., transcriptPath) {
     agentManager.updateAgent({
       sessionId,
       projectPath: cwd,
       jsonlPath: transcriptPath,  // ✅ Use actual path
       ...
     }, 'http');
   }
   ```

2. **Fix schema validation**
   ```javascript
   const hookSchema = {
     required: ['hook_event_name', 'session_id', 'transcript_path', 'cwd'],
     // ...
   };
   ```

3. **Remove invalid fields from schema**
   ```javascript
   // Remove: state, tool (use tool_name)
   // Fix: sessionId → session_id
   ```

### 7.2 Short-term Improvements (Priority P1)

1. **Implement event-specific schemas**
   ```javascript
   const schemas = {
     PreToolUse: preToolUseSchema,
     PostToolUse: postToolUseSchema,
     // ...
   };

   function validateHook(data) {
     const eventSchema = schemas[data.hook_event_name] || baseSchema;
     return ajv.validate(eventSchema, data);
   }
   ```

2. **Add `permission_mode` tracking**
   ```javascript
   // Store in agent state
   agent.permissionMode = data.permission_mode;
   ```

3. **Investigate missing SessionEnd**
   ```javascript
   // Add logging to detect if SessionEnd fires
   case 'SessionEnd':
     debugLog(`[Hook] SessionEnd received for ${sessionId}`);
     handleSessionEnd(sessionId);
     break;
   ```

### 7.3 Long-term Enhancements (Priority P2)

1. **Tool execution analytics**
   - Capture tool_response for performance tracking
   - Track success/failure rates per tool
   - Monitor tool execution patterns

2. **Permission audit log**
   - Track permission_mode changes
   - Log permission-sensitive operations
   - Alert on unexpected permission usage

3. **Enhanced error tracking**
   - Parse PostToolUseFailure.error messages
   - Categorize error types
   - Provide error recovery suggestions

### 7.4 Testing Strategy

1. **Unit Tests for Schema Validation**
   ```javascript
   describe('Hook Schema Validation', () => {
     test('SessionStart validates with all fields', () => {
       const hook = {
         hook_event_name: 'SessionStart',
         session_id: 'uuid',
         transcript_path: '/path/to/session.jsonl',
         cwd: '/project',
         source: 'startup',
         model: 'claude-sonnet-4-6',
         _pid: 12345,
         _timestamp: Date.now()
       };
       expect(validateHook(hook)).toBe(true);
     });
   });
   ```

2. **Integration Tests for Missing Hooks**
   ```javascript
   test('SessionEnd hook fires on normal exit', async () => {
     // Start session
     // Send exit command
     // Verify SessionEnd hook received
   });
   ```

3. **Edge Case Testing**
   - Test with bypassPermissions mode (should suppress PermissionRequest)
   - Test with autoConfirm mode
   - Test subagent creation/termination
   - Test concurrent sessions

---

## 8. Hook Event Flow Diagram

```
Claude CLI Process
    │
    ├─→ User Prompt
    │   └─→ UserPromptSubmit Hook ──────────┐
    │                                         │
    ├─→ Tool Execution                        │
    │   ├─→ PreToolUse Hook ─────────────────┤
    │   │   ├─→ Permission Decision          │
    │   │   └─→ Tool Input Validation        │
    │   │                                    │
    │   ├─→ [Execute Tool]                   │
    │   │   ├─→ Success → PostToolUse ───────┤
    │   │   └─→ Failure → PostToolUseFailure │
    │   │                                    │
    │   └─→ Tool Response                    │
    │                                         │
    ├─→ Response Generation                   │
    │   └─→ Stop Hook ────────────────────────┤
    │                                         │
    ├─→ Task Management                       │
    │   └─→ TaskCompleted Hook ───────────────┤
    │                                         │
    ├─→ Subagent Management                   │
    │   ├─→ SubagentStart Hook ───────────────┤
    │   └─→ SubagentStop Hook ────────────────┤
    │                                         │
    └─→ Session Lifecycle                     │
        ├─→ SessionStart Hook ────────────────┤
        └─→ SessionEnd Hook ──────────────────┤
                                                 │
                                                 ▼
                                    ┌─────────────────────┐
                                    │   hook.js           │
                                    │   - Adds _pid       │
                                    │   - Adds _timestamp │
                                    │   - Writes JSONL    │
                                    │   - Sends HTTP      │
                                    └─────────────────────┘
                                                 │
                                                 ▼
                                    ┌─────────────────────┐
                                    │   main.js           │
                                    │   HTTP Server       │
                                    │   (Port 47821)      │
                                    └─────────────────────┘
                                                 │
                                                 ▼
                                    ┌─────────────────────┐
                                    │  processHookEvent() │
                                    │  - Validates schema │
                                    │  - Routes to handler│
                                    │  - Updates state    │
                                    └─────────────────────┘
```

---

## 9. Field Cross-Reference Matrix

| Field | SessionStart | SessionEnd | PreToolUse | PostToolUse | PostToolUseFailure | UserPromptSubmit | Stop | TaskCompleted | SubagentStart | SubagentStop | Notification |
|-------|--------------|------------|------------|-------------|--------------------|------------------|------|---------------|---------------|--------------|--------------|
| `session_id` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `transcript_path` | ✅ | ❓ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `cwd` | ✅ | ❓ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `_pid` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `_timestamp` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `source` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `model` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `permission_mode` | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `tool_name` | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `tool_input` | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `tool_use_id` | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `tool_response` | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `error` | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `is_interrupt` | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `prompt` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `stop_hook_active` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `last_assistant_message` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `task_id` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| `task_subject` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| `task_description` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| `agent_id` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| `agent_type` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| `message` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| `notification_type` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## 10. Conclusion

### 10.1 Key Findings

1. **High-Quality Hook Data**: Actual hook JSON structures are well-formed and comprehensive
2. **Unused Valuable Fields**: `transcript_path` is consistently available but ignored
3. **Schema Validation Weakness**: Current schema is too permissive and lacks event-specific validation
4. **Missing Critical Hooks**: SessionEnd never fires in production, requiring PID-based workaround
5. **Subagent Field Discrepancy**: Documentation mentions `subagent_session_id` but actual field is `agent_id`

### 10.2 Implementation Quality Score

| Aspect | Score | Notes |
|--------|-------|-------|
| Hook Registration | 9/10 | All events registered correctly |
| Event Routing | 8/10 | Good coverage, minor improvements possible |
| Schema Validation | 5/10 | Too permissive, needs event-specific schemas |
| Field Utilization | 4/10 | Missing transcript_path, tool_response |
| Error Handling | 7/10 | Good error capture, validation warnings |
| Documentation | 6/10 | Reference docs exist, implementation docs lacking |

**Overall: 6.5/10** - Solid foundation with room for improvement

### 10.3 Priority Action Items

1. **P0-Critical**: Integrate `transcript_path` into agent creation
2. **P0-Critical**: Fix schema validation to include required fields
3. **P1-High**: Implement event-specific schemas
4. **P1-High**: Investigate SessionEnd hook issues
5. **P2-Medium**: Add permission_mode tracking
6. **P2-Medium**: Implement tool_response logging
7. **P3-Low**: Add comprehensive unit tests for schema validation

---

## Appendix A: Sample Hook Events

### A.1 SessionStart (Real Example)
```json
{
  "session_id": "d695078f-c743-40ef-b230-bedecbd69fd4",
  "transcript_path": "C:\\Users\\maeum\\.claude\\projects\\E--projects-pixel-agent-desk-master\\d695078f-c743-40ef-b230-bedecbd69fd4.jsonl",
  "cwd": "E:\\projects\\pixel-agent-desk-master",
  "hook_event_name": "SessionStart",
  "source": "startup",
  "model": "claude-sonnet-4-6",
  "_pid": 38016,
  "_timestamp": 1772707479180
}
```

### A.2 PreToolUse (Real Example)
```json
{
  "session_id": "fda24994-d255-43a4-99bb-a8aa5c8fba6d",
  "transcript_path": "C:\\Users\\maeum\\.claude\\projects\\E--projects-pixel-agent-desk-master\\fda24994-d255-43a4-99bb-a8aa5c8fba6d.jsonl",
  "cwd": "E:\\projects\\pixel-agent-desk-master",
  "permission_mode": "acceptEdits",
  "hook_event_name": "PreToolUse",
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "E:\\projects\\pixel-agent-desk-master\\README.md",
    "old_string": "old text...",
    "new_string": "new text...",
    "replace_all": false
  },
  "tool_use_id": "call_f157666dc7e94d6388411dbf",
  "_pid": 35716,
  "_timestamp": 1772707403464
}
```

### A.3 PostToolUse (Real Example)
```json
{
  "session_id": "fda24994-d255-43a4-99bb-a8aa5c8fba6d",
  "transcript_path": "C:\\Users\\maeum\\.claude\\projects\\E--projects-pixel-agent-desk-master\\fda24994-d255-43a4-99bb-a8aa5c8fba6d.jsonl",
  "cwd": "E:\\projects\\pixel-agent-desk-master",
  "permission_mode": "acceptEdits",
  "hook_event_name": "PostToolUse",
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "E:\\projects\\pixel-agent-desk-master\\README.md",
    "old_string": "old text...",
    "new_string": "new text...",
    "replace_all": false
  },
  "tool_response": {
    "filePath": "E:\\projects\\pixel-agent-desk-master\\README.md",
    "oldString": "old text...",
    "newString": "new text...",
    "originalFile": "# Pixel Agent Desk v2.0...",
    "structuredPatch": [...],
    "userModified": false,
    "replaceAll": false
  },
  "tool_use_id": "call_f157666dc7e94d6388411dbf",
  "_pid": 21172,
  "_timestamp": 1772707403621
}
```

### A.4 SubagentStart (Real Example)
```json
{
  "session_id": "d695078f-c743-40ef-b230-bedecbd69fd4",
  "transcript_path": "C:\\Users\\maeum\\.claude\\projects\\E--projects-pixel-agent-desk-master\\d695078f-c743-40ef-b230-bedecbd69fd4.jsonl",
  "cwd": "E:\\projects\\pixel-agent-desk-master",
  "hook_event_name": "SubagentStart",
  "agent_id": "a998259372916877a",
  "agent_type": "general-purpose",
  "_pid": 31820,
  "_timestamp": 1772707956196
}
```

---

## Appendix B: Schema Validation Code Template

```javascript
/**
 * Enhanced hook schema validation with event-specific schemas
 */
const Ajv = require('ajv');

// Base schema for all hooks
const baseSchema = {
  type: 'object',
  required: ['hook_event_name', 'session_id', 'transcript_path', 'cwd'],
  properties: {
    hook_event_name: {
      type: 'string',
      enum: [
        'SessionStart', 'SessionEnd', 'UserPromptSubmit',
        'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
        'Stop', 'TaskCompleted', 'PermissionRequest', 'Notification',
        'SubagentStart', 'SubagentStop', 'TeammateIdle',
        'ConfigChange', 'WorktreeCreate', 'WorktreeRemove', 'PreCompact',
        'InstructionsLoaded'
      ]
    },
    session_id: { type: 'string', format: 'uuid' },
    transcript_path: { type: 'string' },
    cwd: { type: 'string' },
    _pid: { type: 'number' },
    _timestamp: { type: 'number' }
  }
};

// Event-specific schemas
const eventSchemas = {
  SessionStart: {
    allOf: [
      baseSchema,
      {
        properties: {
          hook_event_name: { const: 'SessionStart' },
          source: { type: 'string', enum: ['startup', 'resume'] },
          model: { type: 'string' }
        }
      }
    ]
  },

  PreToolUse: {
    allOf: [
      baseSchema,
      {
        required: ['tool_name', 'tool_input', 'tool_use_id'],
        properties: {
          hook_event_name: { const: 'PreToolUse' },
          permission_mode: { type: 'string' },
          tool_name: { type: 'string' },
          tool_input: { type: 'object' },
          tool_use_id: { type: 'string' }
        }
      }
    ]
  },

  // ... other event schemas
};

// Validation function
function validateHook(data) {
  const ajv = new Ajv();
  const eventName = data.hook_event_name;
  const schema = eventSchemas[eventName] || baseSchema;
  const validate = ajv.compile(schema);
  const isValid = validate(data);

  if (!isValid) {
    return {
      valid: false,
      errors: validate.errors
    };
  }

  return { valid: true };
}

module.exports = { validateHook, baseSchema, eventSchemas };
```

---

**Document Version:** 1.0
**Last Updated:** 2026-03-05
**Author:** Claude Code Hooks Analysis
**Project:** pixel-agent-desk-master
