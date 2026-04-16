import { describe, it, expect, mock } from 'bun:test';

// Mock the ModeManager before importing the formatter
mock.module('../../../src/services/domain/ModeManager.js', () => ({
  ModeManager: {
    getInstance: () => ({
      getActiveMode: () => ({
        name: 'code',
        prompts: {},
        observation_types: [
          { id: 'decision', emoji: 'D' },
          { id: 'bugfix', emoji: 'B' },
          { id: 'discovery', emoji: 'I' },
        ],
        observation_concepts: [],
      }),
      getTypeIcon: (type: string) => {
        const icons: Record<string, string> = {
          decision: 'D',
          bugfix: 'B',
          discovery: 'I',
        };
        return icons[type] || '?';
      },
      getWorkEmoji: () => 'W',
    }),
  },
}));

import {
  renderHumanFooter,
  renderHumanContextIndex,
} from '../../../src/services/context/formatters/HumanFormatter.js';

describe('HumanFormatter ID disambiguation (#1920)', () => {
  describe('renderHumanFooter', () => {
    it('should reference "observation ID" not bare "ID"', () => {
      const result = renderHumanFooter(5000, 100);
      const joined = result.join('\n');

      expect(joined).toContain('observation ID');
      expect(joined).not.toMatch(/by ID\b/);
    });
  });

  describe('renderHumanContextIndex', () => {
    it('should use "observation ID" and "OBS_IDs" not bare "ID"/"IDs"', () => {
      const result = renderHumanContextIndex();
      const joined = result.join('\n');

      expect(joined).toContain('observation ID');
      expect(joined).toContain('get_observations([OBS_IDs])');
      expect(joined).not.toMatch(/Fetch by ID:/);
      expect(joined).not.toMatch(/get_observations\(\[IDs\]\)/);
    });
  });
});
