import { Markdown } from '@/shared/components/markdown';
import type { Item } from '@/shared/server';

import { toBlocks } from './blocks';
import { ToolCalls } from './ToolCalls';

/** Items drawn read-only as the chat draws them: calls as counted lists, answers as prose (a TF agent's record). */
export function RecordItems({ items }: { items: Item[] }) {
  return toBlocks(items, []).map((block) =>
    block.type === 'tools' ? (
      <ToolCalls key={block.id} rows={block.rows} />
    ) : block.type === 'item' && block.item.kind === 'agent_message' ? (
      <Markdown key={block.item.id} text={block.item.text} streaming={false} />
    ) : null,
  );
}
