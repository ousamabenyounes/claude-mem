/**
 * Tests for readPackageVersion() — safe version reading with fallback chain.
 *
 * Verifies that the function handles missing package.json gracefully,
 * falls back to plugin.json, and returns 'unknown' when neither exists.
 * Regression test for issue #1931.
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import * as fs from 'fs';
import { readPackageVersion, getPackageRoot } from '../../src/shared/paths.js';
import { join } from 'path';

describe('readPackageVersion', () => {
  const packageRoot = getPackageRoot();
  const packageJsonPath = join(packageRoot, 'package.json');
  const pluginJsonPath = join(packageRoot, '.claude-plugin', 'plugin.json');

  // Track original implementations to restore
  let existsSyncSpy: ReturnType<typeof spyOn>;
  let readFileSyncSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    existsSyncSpy?.mockRestore();
    readFileSyncSpy?.mockRestore();
  });

  it('should read version from package.json when it exists', () => {
    existsSyncSpy = spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
      if (String(p) === packageJsonPath) return true;
      return false;
    });
    readFileSyncSpy = spyOn(fs, 'readFileSync').mockImplementation((p: any) => {
      if (String(p) === packageJsonPath) return JSON.stringify({ version: '1.2.3' });
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    expect(readPackageVersion()).toBe('1.2.3');
  });

  it('should fall back to plugin.json when package.json is missing', () => {
    existsSyncSpy = spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
      if (String(p) === packageJsonPath) return false;
      if (String(p) === pluginJsonPath) return true;
      return false;
    });
    readFileSyncSpy = spyOn(fs, 'readFileSync').mockImplementation((p: any) => {
      if (String(p) === pluginJsonPath) return JSON.stringify({ version: '4.5.6' });
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    expect(readPackageVersion()).toBe('4.5.6');
  });

  it('should return "unknown" when neither package.json nor plugin.json exists', () => {
    existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(false);

    expect(readPackageVersion()).toBe('unknown');
  });

  it('should handle ENOENT error from readFileSync gracefully', () => {
    existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(true);
    readFileSyncSpy = spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    // Should not throw, returns 'unknown'
    expect(readPackageVersion()).toBe('unknown');
  });

  it('should handle EBUSY error gracefully (shutdown race condition)', () => {
    existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(true);
    readFileSyncSpy = spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
    });

    expect(readPackageVersion()).toBe('unknown');
  });

  it('should skip package.json with missing version field and fall back to plugin.json', () => {
    existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(true);
    readFileSyncSpy = spyOn(fs, 'readFileSync').mockImplementation((p: any) => {
      if (String(p) === packageJsonPath) return JSON.stringify({ name: 'claude-mem' });
      if (String(p) === pluginJsonPath) return JSON.stringify({ version: '7.8.9' });
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    expect(readPackageVersion()).toBe('7.8.9');
  });

  it('should handle malformed JSON in package.json', () => {
    existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(true);
    readFileSyncSpy = spyOn(fs, 'readFileSync').mockImplementation((p: any) => {
      if (String(p) === packageJsonPath) return '{invalid json';
      if (String(p) === pluginJsonPath) return JSON.stringify({ version: '10.0.0' });
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    expect(readPackageVersion()).toBe('10.0.0');
  });
});
