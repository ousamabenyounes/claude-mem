import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test';
import { OpenRouterAgent } from '../src/services/worker/OpenRouterAgent';
import { DatabaseManager } from '../src/services/worker/DatabaseManager';
import { SessionManager } from '../src/services/worker/SessionManager';
import { ModeManager } from '../src/services/domain/ModeManager';
import { SettingsDefaultsManager } from '../src/shared/SettingsDefaultsManager';
import { shouldFallbackToClaude } from '../src/services/worker/agents/FallbackErrorHandler';

// Mock mode config
const mockMode = {
  name: 'code',
  prompts: {
    init: 'init prompt',
    observation: 'obs prompt',
    summary: 'summary prompt'
  },
  observation_types: [{ id: 'discovery' }, { id: 'bugfix' }],
  observation_concepts: []
};

// Spies for cleanup
let loadFromFileSpy: ReturnType<typeof spyOn>;
let getSpy: ReturnType<typeof spyOn>;
let modeManagerSpy: ReturnType<typeof spyOn>;

/**
 * Issue #1946: OpenRouter 401 Missing Authentication header
 *
 * Root cause: API key not validated/trimmed before use in Authorization header.
 * A whitespace-only or empty key produces "Bearer " which 401s.
 * Additionally, 401 errors were not in the fallback pattern list.
 */
describe('OpenRouterAgent auth header (Issue #1946)', () => {
  let agent: OpenRouterAgent;
  let originalFetch: typeof global.fetch;

  // Mocks
  let mockDbManager: DatabaseManager;
  let mockSessionManager: SessionManager;

  function makeSession(overrides: Record<string, any> = {}) {
    return {
      sessionDbId: 1,
      contentSessionId: 'test-session',
      memorySessionId: 'mem-session-123',
      project: 'test-project',
      userPrompt: 'test prompt',
      conversationHistory: [],
      lastPromptNumber: 1,
      cumulativeInputTokens: 0,
      cumulativeOutputTokens: 0,
      pendingMessages: [],
      abortController: new AbortController(),
      generatorPromise: null,
      earliestPendingTimestamp: null,
      currentProvider: null,
      startTime: Date.now(),
      processingMessageIds: [],
      ...overrides,
    } as any;
  }

  beforeEach(() => {
    modeManagerSpy = spyOn(ModeManager, 'getInstance').mockImplementation(() => ({
      getActiveMode: () => mockMode,
      loadMode: () => {},
    } as any));

    loadFromFileSpy = spyOn(SettingsDefaultsManager, 'loadFromFile').mockImplementation(() => ({
      ...SettingsDefaultsManager.getAllDefaults(),
      CLAUDE_MEM_OPENROUTER_API_KEY: 'sk-or-test-key-12345',
      CLAUDE_MEM_OPENROUTER_MODEL: 'xiaomi/mimo-v2-flash:free',
      CLAUDE_MEM_DATA_DIR: '/tmp/claude-mem-test',
    }));

    getSpy = spyOn(SettingsDefaultsManager, 'get').mockImplementation((key: string) => {
      if (key === 'CLAUDE_MEM_OPENROUTER_API_KEY') return 'sk-or-test-key-12345';
      if (key === 'CLAUDE_MEM_OPENROUTER_MODEL') return 'xiaomi/mimo-v2-flash:free';
      if (key === 'CLAUDE_MEM_DATA_DIR') return '/tmp/claude-mem-test';
      return SettingsDefaultsManager.getAllDefaults()[key as keyof ReturnType<typeof SettingsDefaultsManager.getAllDefaults>] ?? '';
    });

    const mockStoreObservations = mock(() => ({
      observationIds: [1],
      summaryId: 1,
      createdAtEpoch: Date.now()
    }));

    const mockSessionStore = {
      storeObservation: mock(() => ({ id: 1, createdAtEpoch: Date.now() })),
      storeObservations: mockStoreObservations,
      storeSummary: mock(() => ({ id: 1, createdAtEpoch: Date.now() })),
      markSessionCompleted: mock(() => {}),
      getSessionById: mock(() => ({ memory_session_id: 'mem-session-123' })),
      ensureMemorySessionIdRegistered: mock(() => {}),
      updateMemorySessionId: mock(() => {}),
    };

    const mockChromaSync = {
      syncObservation: mock(() => Promise.resolve()),
      syncSummary: mock(() => Promise.resolve())
    };

    mockDbManager = {
      getSessionStore: () => mockSessionStore,
      getChromaSync: () => mockChromaSync
    } as unknown as DatabaseManager;

    const mockPendingMessageStore = {
      markProcessed: mock(() => {}),
      confirmProcessed: mock(() => {}),
      cleanupProcessed: mock(() => 0),
      resetStuckMessages: mock(() => 0)
    };

    mockSessionManager = {
      getMessageIterator: async function* () { yield* []; },
      getPendingMessageStore: () => mockPendingMessageStore
    } as unknown as SessionManager;

    agent = new OpenRouterAgent(mockDbManager, mockSessionManager);
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (modeManagerSpy) modeManagerSpy.mockRestore();
    if (loadFromFileSpy) loadFromFileSpy.mockRestore();
    if (getSpy) getSpy.mockRestore();
    mock.restore();
  });

  it('should send Authorization: Bearer <key> header with valid API key', async () => {
    const session = makeSession();

    global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({
      choices: [{
        message: { role: 'assistant', content: '<observation><type>discovery</type><title>Test</title></observation>' },
        finish_reason: 'stop'
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    }))));

    await agent.startSession(session);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(options.headers['Authorization']).toBe('Bearer sk-or-test-key-12345');
  });

  it('should trim whitespace from API key to prevent malformed Bearer header', async () => {
    // Simulate key with leading/trailing whitespace
    loadFromFileSpy.mockImplementation(() => ({
      ...SettingsDefaultsManager.getAllDefaults(),
      CLAUDE_MEM_OPENROUTER_API_KEY: '  sk-or-test-key-12345  ',
      CLAUDE_MEM_OPENROUTER_MODEL: 'xiaomi/mimo-v2-flash:free',
      CLAUDE_MEM_DATA_DIR: '/tmp/claude-mem-test',
    }));

    const session = makeSession();

    global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({
      choices: [{
        message: { role: 'assistant', content: '<observation><type>discovery</type><title>Test</title></observation>' },
        finish_reason: 'stop'
      }],
      usage: { total_tokens: 15 }
    }))));

    await agent.startSession(session);

    const [, options] = (global.fetch as any).mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer sk-or-test-key-12345');
  });

  it('should throw when API key is empty string', async () => {
    loadFromFileSpy.mockImplementation(() => ({
      ...SettingsDefaultsManager.getAllDefaults(),
      CLAUDE_MEM_OPENROUTER_API_KEY: '',
      CLAUDE_MEM_DATA_DIR: '/tmp/claude-mem-test',
    }));

    const session = makeSession();

    await expect(agent.startSession(session)).rejects.toThrow('OpenRouter API key not configured');
  });

  it('should throw when API key is whitespace only', async () => {
    loadFromFileSpy.mockImplementation(() => ({
      ...SettingsDefaultsManager.getAllDefaults(),
      CLAUDE_MEM_OPENROUTER_API_KEY: '   ',
      CLAUDE_MEM_DATA_DIR: '/tmp/claude-mem-test',
    }));

    const session = makeSession();

    await expect(agent.startSession(session)).rejects.toThrow('OpenRouter API key not configured');
  });

  it('should fallback to Claude on 401 authentication error', async () => {
    const session = makeSession();

    global.fetch = mock(() => Promise.resolve(
      new Response('{"error":{"message":"Missing Authentication header","code":"401"}}', { status: 401 })
    ));

    const fallbackAgent = {
      startSession: mock(() => Promise.resolve())
    };
    agent.setFallbackAgent(fallbackAgent);

    await agent.startSession(session);

    expect(fallbackAgent.startSession).toHaveBeenCalledWith(session, undefined);
  });
});

describe('shouldFallbackToClaude includes 401 (Issue #1946)', () => {
  it('should return true for 401 authentication errors', () => {
    const error = new Error('OpenRouter API error: 401 - Missing Authentication header');
    expect(shouldFallbackToClaude(error)).toBe(true);
  });

  it('should still return true for 429 rate limit errors', () => {
    const error = new Error('OpenRouter API error: 429 - Rate limit exceeded');
    expect(shouldFallbackToClaude(error)).toBe(true);
  });

  it('should still return false for 400 bad request errors', () => {
    const error = new Error('OpenRouter API error: 400 - Bad request');
    expect(shouldFallbackToClaude(error)).toBe(false);
  });
});
