import { describe, expect, it } from 'vitest';

import type { TreeMap } from './flowTreeModel';
import { layoutTree, linkId, stepId } from './treeLayout';

const card = (id: string) => ({ id, title: id.toUpperCase(), promises: [] });

const MAP: TreeMap = {
  product: 'P',
  people: [
    {
      id: 'p',
      name: { ko: '사람', en: 'Person' },
      role: { ko: '', en: '' },
      start: { ko: '', en: '' },
      tone: 1,
      journeys: [
        {
          id: 'j',
          title: { ko: '여정', en: 'Journey' },
          goal: { ko: '', en: '' },
          steps: ['a', 'b', 'c', 'd', 'flow:other'],
          edges: [
            { from: 'a', to: 'b', label: '' },
            { from: 'a', to: 'c', label: '승인이 필요할 때' },
            { from: 'b', to: 'd', label: '' },
            { from: 'c', to: 'd', label: '승인한 뒤' },
            { from: 'c', to: 'a', label: '취소하면' },
            { from: 'd', to: 'flow:other', label: '' },
          ],
        },
        { id: 'other', title: { ko: '다른 여정', en: 'Other' }, goal: { ko: '', en: '' }, steps: ['a'] },
      ],
    },
  ],
  cards: { a: card('a'), b: card('b'), c: card('c'), d: card('d') },
  recent: [],
};

describe('layoutTree', () => {
  const { nodes, edges } = layoutTree(MAP, new Set());
  const at = (id: string) => nodes.find((node) => node.id === id)!;

  it('keeps the main way on one line and starts a branch on its own line, with its condition', () => {
    expect(at(stepId('j', 'b')).y).toBe(at(stepId('j', 'a')).y);
    expect(at(stepId('j', 'b')).x).toBeGreaterThan(at(stepId('j', 'a')).x);
    const branch = at(stepId('j', 'c'));
    expect(branch.y).toBeGreaterThan(at(stepId('j', 'a')).y);
    expect(branch.x).toBe(at(stepId('j', 'b')).x);
    expect(branch.arrival).toBe('승인이 필요할 때');
    expect(branch.parent).toBe(stepId('j', 'a'));
  });

  it('draws a second way into a step as a merge, and a way back as a loop on the card that goes back', () => {
    expect(edges.find((edge) => edge.from === stepId('j', 'c') && edge.to === stepId('j', 'd'))).toMatchObject({
      merge: true,
      label: '승인한 뒤',
    });
    expect(at(stepId('j', 'c')).loops).toEqual([{ title: 'A', label: '취소하면' }]);
    expect(edges.some((edge) => edge.to === stepId('j', 'a') && edge.from === stepId('j', 'c'))).toBe(false);
  });

  it('a step that goes through another journey is a link to it', () => {
    expect(at(linkId('j', 'other'))).toMatchObject({ kind: 'link', linkTo: 'other' });
  });

  it('without edges, a journey reads as its steps in order', () => {
    const plain = layoutTree(
      { ...MAP, people: [{ ...MAP.people[0]!, journeys: [{ ...MAP.people[0]!.journeys[0]!, edges: undefined }] }] },
      new Set(),
    ).nodes;
    const ys = ['a', 'b', 'c', 'd'].map((id) => plain.find((node) => node.id === stepId('j', id))!.y);
    expect(new Set(ys).size).toBe(1);
  });
});
