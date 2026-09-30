import { LinkButton } from '@alpine/ui/primitives';
import { memo } from 'react';

import { Markdown } from '@/shared/components/markdown';
import { useFormat, useMessages } from '@/shared/i18n';
import { openInBrowser } from '@/shared/platform';
import { CHATGPT_USAGE_URL, type Item } from '@/shared/server';

import { ActivityLine } from './ActivityLine';
import { toBlocks, type Block } from './blocks';
import { messages } from './messages';
import { useRevealed } from './reveal';

const quiet = 'text-meta text-fg-muted whitespace-pre-wrap';

/**
 * The centre column as plain chat: my messages as bubbles, the agent's as prose, tool calls as activity lines and
 * the rest (choices, notices, why a run stopped) as quiet lines.
 */
export function Chat({ items, activeIds }: { items: Item[]; activeIds: readonly string[] }) {
  return (
    <div className="flex flex-col gap-4">
      {toBlocks(items, activeIds).map((block) =>
        block.type === 'tools' ? (
          <Tools key={block.id} calls={block.calls} />
        ) : (
          <ItemView key={block.item.id} item={block.item} active={activeIds.includes(block.item.id)} />
        ),
      )}
    </div>
  );
}

/**
 * Drawn again only when one of its calls changed. The chat is drawn on every frame while a reply streams, and
 * without this every activity line above would be too.
 */
const Tools = memo(
  function Tools({ calls }: { calls: Extract<Block, { type: 'tools' }>['calls'] }) {
    return <ActivityLine calls={calls} />;
  },
  (before, after) =>
    before.calls.length === after.calls.length && before.calls.every((call, i) => call === after.calls[i]),
);

/** A reply as it streams in: let out at an even pace, drawn as markdown. */
function AgentMessage({ text, streaming }: { text: string; streaming: boolean }) {
  const shown = useRevealed(text, streaming);
  return shown ? <Markdown text={shown} streaming={streaming} /> : null;
}

/** Drawn again only when its item changed (items keep their identity until an event changes them). */
const ItemView = memo(function ItemView({
  item,
  active,
}: {
  item: Extract<Block, { type: 'item' }>['item'];
  active: boolean;
}) {
  const t = useMessages(messages);
  const format = useFormat();
  switch (item.kind) {
    case 'user_message':
      return (
        <div className="flex justify-end">
          <p className="max-w-140 rounded-xl bg-hover px-4 py-2 text-body whitespace-pre-wrap">{item.text}</p>
        </div>
      );
    case 'agent_message':
      return <AgentMessage text={item.text} streaming={active} />;
    case 'approval': {
      const word = { allow: t.chosenAllow, allow_always: t.chosenAllowAlways, deny: t.chosenDeny }[
        item.decision ?? 'deny'
      ];
      return (
        <div className="flex justify-end">
          <p className="flex max-w-140 flex-col rounded-xl border border-line-subtle px-3 py-1 text-meta text-fg-muted">
            <span>
              {t.chosen} · {word} · {item.title}
            </span>
            {item.feedback && <span className="whitespace-pre-wrap text-fg">{item.feedback}</span>}
          </p>
        </div>
      );
    }
    case 'notice':
    case 'status_line':
      return <p className={quiet}>{item.text}</p>;
    case 'run_stopped':
      // The plan's own words are the app's: the core's English message would only repeat them.
      if (item.reason === 'plan_limit')
        return (
          <p className={quiet}>
            {t.stopped_plan_limit} ·{' '}
            <LinkButton className="min-h-5 px-0.5" onClick={() => void openInBrowser(CHATGPT_USAGE_URL)}>
              {t.manageUsage}
            </LinkButton>
          </p>
        );
      if (item.reason === 'signed_out') return <p className={quiet}>{t.stopped_signed_out}</p>;
      return (
        <p className={quiet}>
          {t[`stopped_${item.reason}`]}
          {item.message ? ` · ${item.message}` : ''}
        </p>
      );
    case 'compaction':
      return (
        <div className="flex items-center gap-3 text-meta text-fg-muted">
          <span className="h-px grow bg-line-subtle" />
          {t.compaction(format.number(item.beforeTokens), format.number(item.afterTokens))}
          <span className="h-px grow bg-line-subtle" />
        </div>
      );
  }
});
