import { describe, expect, it } from 'vitest';

import { modelGroups, RECENT_GROUP } from './modelGroups';

const router = {
  name: 'local',
  label: '호환 서버',
  models: Array.from({ length: 300 }, (_, i) => `vendor/model-${i}`),
};
const chatgpt = { name: 'chatgpt', label: 'ChatGPT', models: ['gpt-6-astra', 'gpt-5.5'] };
const base = { sources: [router, chatgpt], recent: [], query: '', expanded: new Set<string>(), recentLabel: '최근' };

describe('modelGroups', () => {
  it('folds a big connection to its current model, and lists small ones whole', () => {
    const groups = modelGroups({ ...base, current: 'local/vendor/model-7' });
    expect(groups).toEqual([
      { id: 'local', label: '호환 서버', items: ['local/vendor/model-7'], folded: 300 },
      { id: 'chatgpt', label: 'ChatGPT', items: ['chatgpt/gpt-6-astra', 'chatgpt/gpt-5.5'], folded: null },
    ]);
  });

  it('opens a folded connection, puts recent models first and skips ones that are gone', () => {
    const groups = modelGroups({
      ...base,
      current: null,
      recent: ['chatgpt/gpt-5.5', 'removed/model'],
      expanded: new Set(['local']),
    });
    expect(groups[0]).toEqual({ id: RECENT_GROUP, label: '최근', items: ['chatgpt/gpt-5.5'], folded: null });
    expect(groups[1]!.items).toHaveLength(300);
  });

  it('searches every connection, folded or not', () => {
    const groups = modelGroups({ ...base, current: null, query: 'MODEL-29' });
    expect(groups.map((g) => g.id)).toEqual(['local']);
    expect(groups[0]!.items).toContain('local/vendor/model-29');
    expect(groups[0]!.folded).toBeNull();
    expect(modelGroups({ ...base, current: null, query: 'nothing' })).toEqual([]);
  });
});
