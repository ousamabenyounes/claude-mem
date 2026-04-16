/**
 * Tests for WAL checkpoint behavior (Issue #1956)
 *
 * Verifies that:
 * - journal_size_limit is set to cap WAL growth
 * - checkpoint() method runs without error
 * - close() triggers a checkpoint before closing
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { existsSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ClaudeMemDatabase } from '../../src/services/sqlite/Database.js';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';

function tempDbPath(): string {
  return join(tmpdir(), `claude-mem-wal-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanup(path: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = path + suffix;
    if (existsSync(p)) unlinkSync(p);
  }
}

describe('WAL checkpoint', () => {
  let dbPath: string;

  afterEach(() => {
    if (dbPath) cleanup(dbPath);
  });

  it('ClaudeMemDatabase sets journal_size_limit', () => {
    dbPath = tempDbPath();
    const cmdb = new ClaudeMemDatabase(dbPath);
    const result = cmdb.db.query('PRAGMA journal_size_limit').get() as { journal_size_limit: number };
    expect(result.journal_size_limit).toBe(8 * 1024 * 1024);
    cmdb.close();
  });

  it('ClaudeMemDatabase.checkpoint() runs without error', () => {
    dbPath = tempDbPath();
    const cmdb = new ClaudeMemDatabase(dbPath);
    // Write some data to generate WAL entries
    cmdb.db.run('CREATE TABLE IF NOT EXISTS wal_test (id INTEGER PRIMARY KEY, val TEXT)');
    cmdb.db.run("INSERT INTO wal_test (val) VALUES ('test')");
    expect(() => cmdb.checkpoint()).not.toThrow();
    cmdb.close();
  });

  it('ClaudeMemDatabase.close() checkpoints the WAL', () => {
    dbPath = tempDbPath();
    const cmdb = new ClaudeMemDatabase(dbPath);
    cmdb.db.run('CREATE TABLE IF NOT EXISTS wal_test (id INTEGER PRIMARY KEY, val TEXT)');
    for (let i = 0; i < 100; i++) {
      cmdb.db.run(`INSERT INTO wal_test (val) VALUES ('row-${i}')`);
    }
    const walPath = dbPath + '-wal';
    const walSizeBefore = existsSync(walPath) ? statSync(walPath).size : 0;
    expect(walSizeBefore).toBeGreaterThan(0);
    cmdb.close();
    const walSizeAfter = existsSync(walPath) ? statSync(walPath).size : 0;
    expect(walSizeAfter).toBe(0);
  });

  it('SessionStore sets journal_size_limit', () => {
    dbPath = tempDbPath();
    const store = new SessionStore(dbPath);
    const result = store.db.query('PRAGMA journal_size_limit').get() as { journal_size_limit: number };
    expect(result.journal_size_limit).toBe(8 * 1024 * 1024);
    store.close();
  });

  it('SessionStore.checkpoint() runs without error', () => {
    dbPath = tempDbPath();
    const store = new SessionStore(dbPath);
    expect(() => store.checkpoint()).not.toThrow();
    store.close();
  });

  it('SessionStore.close() checkpoints the WAL', () => {
    dbPath = tempDbPath();
    const store = new SessionStore(dbPath);
    store.db.run('CREATE TABLE IF NOT EXISTS wal_test (id INTEGER PRIMARY KEY, val TEXT)');
    for (let i = 0; i < 100; i++) {
      store.db.run(`INSERT INTO wal_test (val) VALUES ('row-${i}')`);
    }
    const walPath = dbPath + '-wal';
    const walSizeBefore = existsSync(walPath) ? statSync(walPath).size : 0;
    expect(walSizeBefore).toBeGreaterThan(0);
    store.close();
    const walSizeAfter = existsSync(walPath) ? statSync(walPath).size : 0;
    expect(walSizeAfter).toBe(0);
  });
});
