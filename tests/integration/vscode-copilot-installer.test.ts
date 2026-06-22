import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildHookCommand,
  buildVSCodeHooksConfig,
  mergeVSCodeMcpConfig,
  installVSCodeCopilotHooks,
  uninstallVSCodeCopilotHooks,
} from '../../src/services/integrations/VSCodeCopilotInstaller.js';

const HOOKS_REL = join('.github', 'hooks', 'claude-mem.json');
const MCP_REL = join('.vscode', 'mcp.json');

describe('VSCodeCopilotInstaller pure builders', () => {
  it('builds a dispatcher hook command targeting the vscode-copilot platform', () => {
    const cmd = buildHookCommand('/home/me/.bun/bin/bun', '/plugin/scripts/worker-service.cjs', 'observation');
    expect(cmd).toBe('"/home/me/.bun/bin/bun" "/plugin/scripts/worker-service.cjs" hook vscode-copilot observation');
  });

  it('escapes Windows backslashes in baked paths', () => {
    const cmd = buildHookCommand('C:\\bun\\bun.exe', 'C:\\plugin\\worker.cjs', 'context');
    expect(cmd).toContain('C:\\\\bun\\\\bun.exe');
    expect(cmd).toContain('C:\\\\plugin\\\\worker.cjs');
  });

  it('maps the four VS Code Copilot events to their internal handlers', () => {
    const config = buildVSCodeHooksConfig('/bun', '/worker.cjs');
    expect(Object.keys(config.hooks).sort()).toEqual(['PostToolUse', 'PreCompact', 'SessionStart', 'Stop']);
    expect(config.hooks.SessionStart[0].command).toContain('hook vscode-copilot context');
    expect(config.hooks.PostToolUse[0].command).toContain('hook vscode-copilot observation');
    expect(config.hooks.Stop[0].command).toContain('hook vscode-copilot summarize');
    expect(config.hooks.PreCompact[0].command).toContain('hook vscode-copilot summarize');
    expect(config.hooks.PostToolUse[0].type).toBe('command');
  });

  it('adds claude-mem under the VS Code `servers` key without clobbering existing servers', () => {
    const existing = { servers: { other: { command: 'x', args: [] } } };
    const merged = mergeVSCodeMcpConfig(existing as any, '/usr/bin/node', '/plugin/mcp-server.cjs') as any;
    expect(merged.servers.other).toEqual({ command: 'x', args: [] });
    expect(merged.servers['claude-mem']).toEqual({ command: '/usr/bin/node', args: ['/plugin/mcp-server.cjs'] });
  });

  it('does not use the Claude/Cursor `mcpServers` key', () => {
    const merged = mergeVSCodeMcpConfig({}, '/usr/bin/node', '/plugin/mcp-server.cjs') as any;
    expect(merged.mcpServers).toBeUndefined();
    expect(merged.servers['claude-mem']).toBeDefined();
  });
});

describe('VSCodeCopilotInstaller round-trip', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'vscode-copilot-install-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('writes both config files and removes only claude-mem on uninstall', () => {
    // Pre-existing unrelated MCP server must survive uninstall.
    mkdirSync(join(workspace, '.vscode'), { recursive: true });
    writeFileSync(join(workspace, MCP_REL), JSON.stringify({ servers: { keepme: { command: 'k', args: [] } } }));

    const code = installVSCodeCopilotHooks(workspace);
    expect(code).toBe(0);
    expect(existsSync(join(workspace, HOOKS_REL))).toBe(true);

    const mcpAfterInstall = JSON.parse(readFileSync(join(workspace, MCP_REL), 'utf-8'));
    expect(mcpAfterInstall.servers['claude-mem']).toBeDefined();
    expect(mcpAfterInstall.servers.keepme).toBeDefined();

    const hooks = JSON.parse(readFileSync(join(workspace, HOOKS_REL), 'utf-8'));
    expect(hooks.hooks.SessionStart[0].command).toContain('hook vscode-copilot context');

    expect(uninstallVSCodeCopilotHooks(workspace)).toBe(0);
    expect(existsSync(join(workspace, HOOKS_REL))).toBe(false);

    const mcpAfterUninstall = JSON.parse(readFileSync(join(workspace, MCP_REL), 'utf-8'));
    expect(mcpAfterUninstall.servers['claude-mem']).toBeUndefined();
    expect(mcpAfterUninstall.servers.keepme).toBeDefined();
  });
});
