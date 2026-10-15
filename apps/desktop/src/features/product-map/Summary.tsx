import type { ProductMap } from '@alpine/protocol';

import { useMessages } from '@/shared/i18n';

import { messages } from './messages';
import { conditionResults, type States } from './model';

type Segment = 'passed' | 'failed' | 'question' | 'recheck' | 'unconfirmed';
const SEGMENTS: Segment[] = ['passed', 'failed', 'question', 'recheck', 'unconfirmed'];

/** Every promise once, by its own state (a blocked or unchecked promise counts as not yet confirmed). */
export function promiseCounts(document: ProductMap, states: States) {
  const counts: Record<Segment, number> = { passed: 0, failed: 0, question: 0, recheck: 0, unconfirmed: 0 };
  for (const node of document.nodes ?? [])
    for (const { status, promise } of conditionResults(node, states?.[node.id])) {
      const key: Segment = promise?.issue === 'question' ? 'question' : status === 'blocked' ? 'unconfirmed' : status;
      counts[key] += 1;
    }
  return counts;
}

/** One sentence: how many promises hold. What needs a look is marked on the flow list below it. */
export function Summary({ counts, features }: { counts: Record<Segment, number>; features: number }) {
  const t = useMessages(messages);
  const total = SEGMENTS.reduce((sum, key) => sum + counts[key], 0);
  return (
    <p className="text-body text-fg tabular-nums">
      {total ? t.keeping(counts.passed, total) : t.noPromisesYet(features)}
    </p>
  );
}
