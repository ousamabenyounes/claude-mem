/**
 * SearchManager.findByConcept - parameter normalization
 *
 * Regression tests for issue #1916: GET /api/search/by-concept?concept=X
 * returned `near "ORDER": syntax error` because the singular `concept`
 * URL param was never mapped onto the internal plural `concepts` field,
 * leaving the SQL WHERE clause empty.
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Silence ModeManager during construction
mock.module('../../src/services/domain/ModeManager.js', () => ({
  ModeManager: {
    getInstance: () => ({
      getActiveMode: () => ({ name: 'code', prompts: {}, observation_types: [], observation_concepts: [] }),
      getObservationTypes: () => [],
      getTypeIcon: () => '?',
      getWorkEmoji: () => 'W',
    }),
  },
}));

import { SearchManager } from '../../src/services/worker/SearchManager.js';

type FindByConceptCall = { concept: any; options: any };

function buildManager(): { manager: SearchManager; calls: FindByConceptCall[] } {
  const calls: FindByConceptCall[] = [];

  const sessionSearch = {
    findByConcept: mock((concept: any, options: any) => {
      calls.push({ concept, options });
      return [];
    }),
  } as any;

  const sessionStore = {
    getObservationsByIds: mock(() => []),
  } as any;

  const formatter = {
    formatTableHeader: () => 'HEAD',
    formatObservationIndex: () => 'ROW',
  } as any;

  const timelineService = {} as any;

  // Pass null for chromaSync so findByConcept routes through the SQLite-only branch.
  const manager = new SearchManager(sessionSearch, sessionStore, null, formatter, timelineService);
  return { manager, calls };
}

describe('SearchManager.findByConcept — issue #1916', () => {
  let manager: SearchManager;
  let calls: FindByConceptCall[];

  beforeEach(() => {
    ({ manager, calls } = buildManager());
  });

  it('accepts the singular ?concept=X URL param (was producing malformed SQL)', async () => {
    const result = await manager.findByConcept({ concept: 'discovery' });

    expect(calls.length).toBeGreaterThan(0);
    // The bug: sessionSearch.findByConcept(undefined, ...) produced the SQL crash.
    // Fixed behaviour: the singular param is forwarded as the concept string.
    expect(calls[0].concept).toBe('discovery');
    expect(result.content[0].text).toContain('No observations found');
  });

  it('accepts the plural ?concepts=X URL param as a single string', async () => {
    await manager.findByConcept({ concepts: 'discovery' });

    expect(calls[0].concept).toBe('discovery');
  });

  it('coerces comma-separated ?concepts=X,Y to the first concept (string, not array)', async () => {
    await manager.findByConcept({ concepts: 'discovery,change' });

    expect(calls[0].concept).toBe('discovery');
    // Before the fix, an array here would have reached queryChroma (expects string)
    // and SessionSearch.findByConcept (expects string).
    expect(Array.isArray(calls[0].concept)).toBe(false);
  });

  it('returns a friendly message — not a SQL error — when no concept is provided', async () => {
    const result = await manager.findByConcept({});

    // SessionSearch must not be invoked with undefined, which would build
    // "WHERE \nORDER BY ..." and throw `near "ORDER": syntax error`.
    expect(calls.length).toBe(0);
    expect(result.content[0].text).toMatch(/No concept provided/i);
  });

  it('preserves other filters (project, limit) alongside concept remapping', async () => {
    await manager.findByConcept({ concept: 'discovery', project: 'foo', limit: 5 });

    expect(calls[0].concept).toBe('discovery');
    expect(calls[0].options.project).toBe('foo');
    expect(calls[0].options.limit).toBe(5);
    // The singular key must not leak into the internal filters.
    expect('concept' in calls[0].options).toBe(false);
  });
});
