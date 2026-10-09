import { describe, expect, it } from 'vitest';

import { agentsMessages } from './messages';
import { STARTS, startText } from './starts';

const start = (id: (typeof STARTS)[number]['id']) => STARTS.find((s) => s.id === id)!;
const text = (id: (typeof STARTS)[number]['id']) => startText(id, agentsMessages.ko);

describe('starts (docs/agents.md decision 15)', () => {
  it('has the four starting points', () => {
    expect(STARTS.map((s) => s.id)).toEqual(['blank', 'maker', 'review', 'writer']);
  });

  it('gives the blank agent all six tools and no instructions', () => {
    expect(start('blank').tools).toEqual(['read', 'glob', 'grep', 'write', 'edit', 'bash']);
    expect(text('blank')).toMatchObject({ name: '새 에이전트', description: '', instructions: '' });
  });

  it('gives the maker all six tools and its instructions', () => {
    expect(start('maker').tools).toHaveLength(6);
    expect(text('maker').instructions).toBe(
      '바꾸기 전에 무엇을 바꿀지 먼저 말해 줘.\n끝나면 화면에서 어떻게 보이는지 알려 줘.',
    );
    expect(text('maker').description).toBe('웹사이트나 앱을 만들고 고쳐요');
  });

  it('lets the reviewer read but not change', () => {
    expect(start('review').tools).toEqual(['read', 'glob', 'grep']);
    expect(text('review').instructions).toBe('파일은 고치지 말고 의견만 적어 줘.\n꼭 고칠 것과 취향인 것을 나눠 줘.');
  });

  it('gives the writer everything but the command line', () => {
    expect(start('writer').tools).toEqual(['read', 'glob', 'grep', 'write', 'edit']);
    expect(text('writer').instructions).toBe('쉬운 말로, 짧은 문장으로 써 줘.');
  });

  it('gives each start a character no other start has', () => {
    const faces = STARTS.map((s) => `${s.look}/${s.color}`);
    expect(new Set(faces).size).toBe(4);
    expect(faces).toEqual(['antenna/7', 'hardhat/1', 'glasses/3', 'beret/4']);
  });
});
