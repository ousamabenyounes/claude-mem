import { describe, expect, it } from 'bun:test';
import { vscodeCopilotAdapter } from '../../../src/cli/adapters/vscode-copilot.js';
import { AdapterRejectedInput } from '../../../src/cli/adapters/errors.js';

// Ground-truth shape: VS Code Copilot delivers camelCase fields on stdin
// (sessionId, toolName, toolInput, toolResponse) with PascalCase event names,
// and reads model context back from a hookSpecificOutput wrapper. Mirrors
// context-mode's shipped vscode-copilot fixtures.
describe('vscodeCopilotAdapter.normalizeInput', () => {
  it('maps camelCase PostToolUse fields to the normalized shape', () => {
    const input = vscodeCopilotAdapter.normalizeInput({
      sessionId: 'vscode-123',
      cwd: '/tmp/project',
      toolName: 'editFile',
      toolInput: { filePath: 'src/app.ts' },
      toolResponse: { ok: true },
    });

    expect(input.sessionId).toBe('vscode-123');
    expect(input.cwd).toBe('/tmp/project');
    expect(input.toolName).toBe('editFile');
    expect(input.toolInput).toEqual({ filePath: 'src/app.ts' });
    expect(input.toolResponse).toEqual({ ok: true });
  });

  it('accepts toolResult as an alias for toolResponse', () => {
    const input = vscodeCopilotAdapter.normalizeInput({
      sessionId: 'vscode-1',
      cwd: '/tmp/project',
      toolName: 'runInTerminal',
      toolResult: { output: 'done' },
    });
    expect(input.toolResponse).toEqual({ output: 'done' });
  });

  it('falls back to snake_case when Copilot drifts toward the Claude Code shape', () => {
    const input = vscodeCopilotAdapter.normalizeInput({
      session_id: 'snake-1',
      cwd: '/tmp/project',
      tool_name: 'readFile',
      tool_input: { path: 'a.ts' },
      tool_response: { ok: 1 },
    });
    expect(input.sessionId).toBe('snake-1');
    expect(input.toolName).toBe('readFile');
    expect(input.toolInput).toEqual({ path: 'a.ts' });
    expect(input.toolResponse).toEqual({ ok: 1 });
  });

  it('rejects input with an invalid cwd', () => {
    expect(() => vscodeCopilotAdapter.normalizeInput({ sessionId: 'x', cwd: '' }))
      .toThrow(AdapterRejectedInput);
  });
});

describe('vscodeCopilotAdapter.formatOutput', () => {
  it('emits the hookSpecificOutput wrapper verbatim', () => {
    const out = vscodeCopilotAdapter.formatOutput({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'past memory' },
    }) as any;

    expect(out.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(out.hookSpecificOutput.additionalContext).toBe('past memory');
  });

  it('returns an empty object when there is nothing to surface', () => {
    expect(vscodeCopilotAdapter.formatOutput({})).toEqual({});
  });
});
