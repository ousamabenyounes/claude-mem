import type { PlatformAdapter } from '../types.js';
import { AdapterRejectedInput, isValidCwd } from './errors.js';

/**
 * VS Code Copilot hook adapter.
 *
 * VS Code Copilot uses the same JSON-on-stdin / JSON-on-stdout paradigm as
 * Claude Code with PascalCase hook event names (PreToolUse, PostToolUse,
 * PreCompact, SessionStart, Stop). The wire differences vs Claude Code:
 *
 *   - Field names are camelCase (`sessionId`, `toolName`, `toolInput`,
 *     `filePath`) rather than snake_case (`session_id`, `tool_name`, ...).
 *   - Tool result is delivered as `toolResponse`/`toolResult` (camelCase).
 *   - Responses must be wrapped in a `hookSpecificOutput` object carrying a
 *     `hookEventName` — which the event handlers already produce, so the
 *     formatter is a passthrough identical to the Claude Code adapter.
 *
 * Status: preview — Copilot's hook API may change. We read snake_case as a
 * fallback for every field so a format drift toward Claude Code's shape (or a
 * captured-via-Claude-Code fixture) still normalizes correctly instead of
 * silently dropping data.
 *
 * Reference: VS Code Copilot hooks live in `.github/hooks/*.json`; see
 * VSCodeCopilotInstaller for the config this adapter is the runtime half of.
 */

const MAX_AGENT_FIELD_LEN = 128;
const pickAgentField = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 && v.length <= MAX_AGENT_FIELD_LEN ? v : undefined;

export const vscodeCopilotAdapter: PlatformAdapter = {
  normalizeInput(raw) {
    const r = (raw ?? {}) as any;
    const cwd = r.cwd ?? r.workspaceRoot ?? r.workspace_root ?? process.cwd();
    if (!isValidCwd(cwd)) {
      throw new AdapterRejectedInput('invalid_cwd');
    }
    return {
      sessionId: r.sessionId ?? r.session_id ?? r.id,
      cwd,
      prompt: r.prompt,
      toolName: r.toolName ?? r.tool_name,
      toolInput: r.toolInput ?? r.tool_input,
      toolResponse: r.toolResponse ?? r.toolResult ?? r.tool_response ?? r.tool_result,
      transcriptPath: r.transcriptPath ?? r.transcript_path,
      agentId: pickAgentField(r.agentId ?? r.agent_id),
      agentType: pickAgentField(r.agentType ?? r.agent_type),
    };
  },
  formatOutput(result) {
    const r = result ?? {};
    const output: Record<string, unknown> = {};
    // VS Code Copilot reads model-facing context from `hookSpecificOutput`
    // (already carrying `hookEventName` from the handler) — emit it verbatim.
    if (r.hookSpecificOutput) {
      output.hookSpecificOutput = r.hookSpecificOutput;
    }
    if (r.systemMessage) {
      output.systemMessage = r.systemMessage;
    }
    return output;
  }
};
