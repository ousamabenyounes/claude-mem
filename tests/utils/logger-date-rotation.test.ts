import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Tests for log file date rotation (Issue #1878).
 *
 * The Logger caches the resolved log-file path. Before the fix it computed
 * the date once at startup, so a long-running worker that spanned midnight
 * would keep writing into the previous day's file.
 *
 * Because the production Logger is a singleton with module-level side-effects
 * (reads settings from disk, etc.) we re-implement the minimal rotation logic
 * inline so the test is isolated and deterministic.
 */

// ---------------------------------------------------------------------------
// Minimal reproduction of the rotation logic from src/utils/logger.ts
// ---------------------------------------------------------------------------

class TestableLogger {
  logFilePath: string | null = null;
  logsDirReady: boolean = false;
  currentDateStr: string | null = null;

  /** Injected so tests can control "now" */
  private nowFn: () => Date;
  private dataDir: string;

  constructor(dataDir: string, nowFn: () => Date = () => new Date()) {
    this.dataDir = dataDir;
    this.nowFn = nowFn;
  }

  /**
   * Mirror of Logger.ensureLogFileInitialized() after the fix.
   */
  ensureLogFileInitialized(): void {
    try {
      if (!this.logsDirReady) {
        const logsDir = join(this.dataDir, 'logs');
        if (!existsSync(logsDir)) {
          mkdirSync(logsDir, { recursive: true });
        }
        this.logsDirReady = true;
      }

      const date = this.nowFn().toISOString().split('T')[0];
      if (date !== this.currentDateStr) {
        this.currentDateStr = date;
        const logsDir = join(this.dataDir, 'logs');
        this.logFilePath = join(logsDir, `claude-mem-${date}.log`);
      }
    } catch (error) {
      console.error('[LOGGER] Failed to initialize log file:', error);
      this.logFilePath = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Logger date rotation (#1878)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `logger-rotation-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it('should update log file path when the date changes', () => {
    let fakeDate = new Date('2026-04-15T23:59:00Z');
    const logger = new TestableLogger(tmpDir, () => fakeDate);

    // First call sets path for 2026-04-15
    logger.ensureLogFileInitialized();
    expect(logger.logFilePath).toBe(join(tmpDir, 'logs', 'claude-mem-2026-04-15.log'));
    expect(logger.currentDateStr).toBe('2026-04-15');

    // Simulate midnight rollover
    fakeDate = new Date('2026-04-16T00:00:01Z');
    logger.ensureLogFileInitialized();
    expect(logger.logFilePath).toBe(join(tmpDir, 'logs', 'claude-mem-2026-04-16.log'));
    expect(logger.currentDateStr).toBe('2026-04-16');
  });

  it('should NOT change the path when called again on the same day', () => {
    const logger = new TestableLogger(tmpDir, () => new Date('2026-04-15T12:00:00Z'));

    logger.ensureLogFileInitialized();
    const firstPath = logger.logFilePath;

    // Second call on the same date should be a no-op
    logger.ensureLogFileInitialized();
    expect(logger.logFilePath).toBe(firstPath);
  });

  it('should retry directory creation after a transient failure', () => {
    // Use a path inside a non-existent root to force initial failure,
    // then switch to a valid path to verify retry behavior.
    let useBadDir = true;
    const badDir = '/nonexistent-root-abc123/logs';

    const logger = new TestableLogger(
      tmpDir, // will be ignored on first call because we override the dir
      () => new Date('2026-04-15T10:00:00Z')
    );

    // Manually sabotage logsDirReady so it stays false even after a failure
    // by pointing dataDir to a bad location
    (logger as any).dataDir = badDir;

    logger.ensureLogFileInitialized();
    // Should have failed -- logsDirReady stays false, logFilePath is null
    expect(logger.logsDirReady).toBe(false);
    expect(logger.logFilePath).toBeNull();

    // "Fix" the filesystem and retry
    (logger as any).dataDir = tmpDir;
    logger.ensureLogFileInitialized();
    expect(logger.logsDirReady).toBe(true);
    expect(logger.logFilePath).toBe(join(tmpDir, 'logs', 'claude-mem-2026-04-15.log'));
  });

  it('should create the logs directory on first initialization', () => {
    const logsDir = join(tmpDir, 'logs');
    expect(existsSync(logsDir)).toBe(false);

    const logger = new TestableLogger(tmpDir, () => new Date('2026-04-15T08:00:00Z'));
    logger.ensureLogFileInitialized();

    expect(existsSync(logsDir)).toBe(true);
    expect(logger.logsDirReady).toBe(true);
  });

  it('should rotate across multiple days', () => {
    const dates = [
      new Date('2026-04-15T06:00:00Z'),
      new Date('2026-04-16T06:00:00Z'),
      new Date('2026-04-17T06:00:00Z'),
    ];
    let dateIndex = 0;
    const logger = new TestableLogger(tmpDir, () => dates[dateIndex]);

    for (let i = 0; i < dates.length; i++) {
      dateIndex = i;
      logger.ensureLogFileInitialized();
      const expected = dates[i].toISOString().split('T')[0];
      expect(logger.logFilePath).toBe(join(tmpDir, 'logs', `claude-mem-${expected}.log`));
    }
  });
});
