import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/i18n';

import { TreeCanvas } from './TreeCanvas';
import type { LaidNode } from './treeLayout';

const node = (id: string, x: number): LaidNode => ({
  id,
  kind: 'step',
  parent: null,
  x,
  y: 0,
  w: 100,
  h: 40,
  index: 0,
});

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('redraws cards in place with no motion when the map is read again and nothing moved', () => {
  const canvas = (nodes: LaidNode[]) => (
    <LocaleProvider locale="ko">
      <TreeCanvas nodes={nodes} edges={[]} highlight={new Set()} renderNode={(n) => <span>{n.id}</span>} />
    </LocaleProvider>
  );
  const { rerender } = render(canvas([node('a', 0), node('b', 200)]));
  const frames = vi.spyOn(globalThis, 'requestAnimationFrame');
  // Same cards in the same places, as new objects: what every poll of the map hands the canvas.
  rerender(canvas([node('a', 0), node('b', 200)]));
  expect(frames).not.toHaveBeenCalled();
  // A card that moved still glides.
  rerender(canvas([node('a', 0), node('b', 320)]));
  expect(frames).toHaveBeenCalled();
});
