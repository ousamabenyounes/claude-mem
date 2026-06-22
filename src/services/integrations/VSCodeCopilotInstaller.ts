/**
 * VSCodeCopilotInstaller — wires claude-mem into GitHub Copilot for VS Code.
 *
 * Unlike "Copilot CLI" (MCP-only, see McpIntegrations.ts), VS Code Copilot
 * exposes a JSON stdin/stdout hook system in `.github/hooks/*.json` with
 * PascalCase event names, so claude-mem gets full transcript/observation
 * capture here — not just manual MCP search.
 *
 * Two workspace-scoped files are written into the current project:
 *   - `.github/hooks/claude-mem.json` — hook event → `claude-mem hook
 *     vscode-copilot <event>` (runtime half lives in cli/adapters/vscode-copilot).
 *   - `.vscode/mcp.json` — the claude-mem MCP server (VS Code uses the
 *     `servers` key, not `mcpServers`) so the search tools are available.
 *
 * Absolute bun + worker paths are baked into the hook command, matching the
 * Cursor and Gemini installers in this repo: VS Code performs no
 * `${CLAUDE_PLUGIN_ROOT}` substitution on the `command` it execs.
 */

import path from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { logger } from '../../utils/logger.js';
import { readJsonSafe } from '../../utils/json-utils.js';
import {
  getWorkerServiceAbsolutePath as findWorkerServicePath,
  getBunAbsolutePath as findBunPath,
  getMcpServerAbsolutePath,
  getNodeAbsolutePath,
} from './install-paths.js';

const HOOK_PLATFORM = 'vscode-copilot';
const MCP_SERVER_NAME = 'claude-mem';
const HOOKS_CONFIG_RELATIVE = path.join('.github', 'hooks', 'claude-mem.json');
const MCP_CONFIG_RELATIVE = path.join('.vscode', 'mcp.json');
/** VS Code's native MCP config keys servers under `servers` (not `mcpServers`). */
const MCP_SERVERS_KEY = 'servers';

/**
 * VS Code Copilot hook event (PascalCase) → claude-mem internal event.
 * SessionStart injects past-session context; PostToolUse captures each tool
 * call as an observation; Stop and PreCompact each checkpoint a summary
 * (session end and pre-compaction), mirroring the Claude Code mapping.
 */
const VSCODE_EVENT_TO_INTERNAL_EVENT: Record<string, string> = {
  SessionStart: 'context',
  PostToolUse: 'observation',
  Stop: 'summarize',
  PreCompact: 'summarize',
};

interface VSCodeHookEntry {
  type: 'command';
  command: string;
}

interface VSCodeHooksConfig {
  hooks: Record<string, VSCodeHookEntry[]>;
}

interface VSCodeMcpServerEntry {
  command: string;
  args: string[];
}

interface VSCodeMcpConfig {
  [key: string]: { [serverName: string]: VSCodeMcpServerEntry } | unknown;
}

export function buildHookCommand(bunPath: string, workerServicePath: string, internalEvent: string): string {
  const escapedBunPath = bunPath.replace(/\\/g, '\\\\');
  const escapedWorkerPath = workerServicePath.replace(/\\/g, '\\\\');
  return `"${escapedBunPath}" "${escapedWorkerPath}" hook ${HOOK_PLATFORM} ${internalEvent}`;
}

export function buildVSCodeHooksConfig(bunPath: string, workerServicePath: string): VSCodeHooksConfig {
  const hooks: Record<string, VSCodeHookEntry[]> = {};
  for (const [vscodeEvent, internalEvent] of Object.entries(VSCODE_EVENT_TO_INTERNAL_EVENT)) {
    hooks[vscodeEvent] = [{ type: 'command', command: buildHookCommand(bunPath, workerServicePath, internalEvent) }];
  }
  return { hooks };
}

/**
 * Merge the claude-mem MCP server into an existing `.vscode/mcp.json` object,
 * preserving any other servers the user configured. Pure for testability.
 */
export function mergeVSCodeMcpConfig(existing: VSCodeMcpConfig, nodePath: string, mcpServerPath: string): VSCodeMcpConfig {
  const merged: VSCodeMcpConfig = { ...existing };
  const servers = (merged[MCP_SERVERS_KEY] && typeof merged[MCP_SERVERS_KEY] === 'object'
    ? { ...(merged[MCP_SERVERS_KEY] as Record<string, VSCodeMcpServerEntry>) }
    : {}) as Record<string, VSCodeMcpServerEntry>;
  servers[MCP_SERVER_NAME] = { command: nodePath, args: [mcpServerPath] };
  merged[MCP_SERVERS_KEY] = servers;
  return merged;
}

function writeJsonFile(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

export function installVSCodeCopilotHooks(workspaceRoot: string = process.cwd()): number {
  console.log('\nInstalling Claude-Mem GitHub Copilot (VS Code) integration...\n');

  const workerServicePath = findWorkerServicePath();
  if (!workerServicePath) {
    console.error('Could not find worker-service.cjs');
    console.error('   Expected at: ~/.claude/plugins/marketplaces/thedotmack/plugin/scripts/worker-service.cjs');
    return 1;
  }

  const mcpServerPath = getMcpServerAbsolutePath();
  if (!mcpServerPath) {
    console.error('Could not find MCP server script');
    console.error('   Expected at: ~/.claude/plugins/marketplaces/thedotmack/plugin/scripts/mcp-server.cjs');
    return 1;
  }

  const bunPath = findBunPath();
  console.log(`  Using Bun runtime: ${bunPath}`);
  console.log(`  Worker service: ${workerServicePath}`);

  try {
    const hooksPath = path.join(workspaceRoot, HOOKS_CONFIG_RELATIVE);
    writeJsonFile(hooksPath, buildVSCodeHooksConfig(bunPath, workerServicePath));
    console.log(`  Wrote hooks: ${hooksPath}`);

    const mcpPath = path.join(workspaceRoot, MCP_CONFIG_RELATIVE);
    const existingMcp = readJsonSafe<VSCodeMcpConfig>(mcpPath, {});
    writeJsonFile(mcpPath, mergeVSCodeMcpConfig(existingMcp, getNodeAbsolutePath(), mcpServerPath));
    console.log(`  Wrote MCP server: ${mcpPath}`);

    const events = Object.keys(VSCODE_EVENT_TO_INTERNAL_EVENT);
    console.log(`  Registered ${events.length} hook events:`);
    for (const event of events) {
      console.log(`    ${event} → ${VSCODE_EVENT_TO_INTERNAL_EVENT[event]}`);
    }

    console.log(`
Installation complete!

Hooks:  ${hooksPath}
MCP:    ${mcpPath}

Next steps:
  1. Start claude-mem worker: claude-mem start
  2. Reload the VS Code window (Developer: Reload Window) to load the hooks
  3. Copilot hooks are a preview feature — confirm they are enabled in your VS Code build
`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nInstallation failed: ${message}`);
    return 1;
  }
}

export function uninstallVSCodeCopilotHooks(workspaceRoot: string = process.cwd()): number {
  console.log('\nUninstalling Claude-Mem GitHub Copilot (VS Code) integration...\n');

  try {
    const hooksPath = path.join(workspaceRoot, HOOKS_CONFIG_RELATIVE);
    if (existsSync(hooksPath)) {
      unlinkSync(hooksPath);
      console.log(`  Removed hooks: ${hooksPath}`);
    } else {
      console.log('  No hooks config found — nothing to remove.');
    }

    const mcpPath = path.join(workspaceRoot, MCP_CONFIG_RELATIVE);
    if (existsSync(mcpPath)) {
      removeClaudeMemFromMcpConfig(mcpPath);
    }

    console.log('\nUninstallation complete!\n');
    console.log('Reload the VS Code window to apply changes.');
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nUninstallation failed: ${message}`);
    return 1;
  }
}

function removeClaudeMemFromMcpConfig(mcpPath: string): void {
  const config = readJsonSafe<VSCodeMcpConfig>(mcpPath, {});
  const servers = config[MCP_SERVERS_KEY] as Record<string, VSCodeMcpServerEntry> | undefined;
  if (!servers || !servers[MCP_SERVER_NAME]) {
    return;
  }
  delete servers[MCP_SERVER_NAME];
  if (Object.keys(servers).length === 0) {
    // Sole server was ours — drop the whole file rather than leaving an empty husk.
    unlinkSync(mcpPath);
    console.log(`  Removed MCP config: ${mcpPath}`);
    return;
  }
  config[MCP_SERVERS_KEY] = servers;
  writeFileSync(mcpPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`  Removed claude-mem MCP server from: ${mcpPath}`);
}

export function checkVSCodeCopilotStatus(workspaceRoot: string = process.cwd()): number {
  console.log('\nClaude-Mem GitHub Copilot (VS Code) Status\n');

  const hooksPath = path.join(workspaceRoot, HOOKS_CONFIG_RELATIVE);
  const mcpPath = path.join(workspaceRoot, MCP_CONFIG_RELATIVE);

  if (!existsSync(hooksPath)) {
    console.log('Hooks: Not installed');
    console.log(`  Run: claude-mem ${HOOK_PLATFORM} install\n`);
    return 0;
  }

  console.log(`Hooks: Installed (${hooksPath})`);
  try {
    const config = JSON.parse(readFileSync(hooksPath, 'utf-8')) as VSCodeHooksConfig;
    const events = Object.keys(config.hooks ?? {});
    console.log(`  Events: ${events.length} of ${Object.keys(VSCODE_EVENT_TO_INTERNAL_EVENT).length}`);
    for (const event of events) {
      console.log(`    ${event} → ${VSCODE_EVENT_TO_INTERNAL_EVENT[event] ?? 'unknown'}`);
    }
  } catch (error) {
    if (error instanceof Error) {
      logger.error('WORKER', 'Unable to parse Copilot hooks config', { path: hooksPath }, error);
    }
    console.log('  Mode: Unable to parse hooks config');
  }

  const mcp = readJsonSafe<VSCodeMcpConfig>(mcpPath, {});
  const servers = mcp[MCP_SERVERS_KEY] as Record<string, VSCodeMcpServerEntry> | undefined;
  console.log(servers?.[MCP_SERVER_NAME] ? `MCP: Active (${mcpPath})` : 'MCP: Not configured');
  console.log('');
  return 0;
}

export async function handleVSCodeCopilotCommand(subcommand: string, _args: string[]): Promise<number> {
  switch (subcommand) {
    case 'install':
      return installVSCodeCopilotHooks();

    case 'uninstall':
      return uninstallVSCodeCopilotHooks();

    case 'status':
      return checkVSCodeCopilotStatus();

    default:
      console.log(`
Claude-Mem GitHub Copilot (VS Code) Integration

Usage: claude-mem ${HOOK_PLATFORM} <command>

Commands:
  install             Write .github/hooks/claude-mem.json + .vscode/mcp.json
  uninstall           Remove claude-mem hooks + MCP server (preserves others)
  status              Check installation status

Examples:
  claude-mem ${HOOK_PLATFORM} install     # Wire the current workspace
  claude-mem ${HOOK_PLATFORM} status      # Check if installed
  claude-mem ${HOOK_PLATFORM} uninstall   # Remove from current workspace
      `);
      return 0;
  }
}
