import type { PlatformAdapter } from '../types.js';
import { claudeCodeAdapter } from './claude-code.js';
import { codexAdapter } from './codex.js';
import { cursorAdapter } from './cursor.js';
import { geminiCliAdapter } from './gemini-cli.js';
import { rawAdapter } from './raw.js';
import { vscodeCopilotAdapter } from './vscode-copilot.js';
import { windsurfAdapter } from './windsurf.js';

export function getPlatformAdapter(platform: string): PlatformAdapter {
  switch (platform) {
    case 'claude-code': return claudeCodeAdapter;
    case 'codex': return codexAdapter;
    case 'cursor': return cursorAdapter;
    case 'gemini':
    case 'gemini-cli': return geminiCliAdapter;
    case 'vscode-copilot': return vscodeCopilotAdapter;
    case 'windsurf': return windsurfAdapter;
    case 'raw': return rawAdapter;
    default: return rawAdapter;
  }
}

export { claudeCodeAdapter, codexAdapter, cursorAdapter, geminiCliAdapter, rawAdapter, vscodeCopilotAdapter, windsurfAdapter };
