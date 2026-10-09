import { LinkButton } from '@alpine/ui/primitives';
import { Link } from '@tanstack/react-router';
import { memo } from 'react';

import { agentMessages, agentName, Character, toolLabel } from '@/shared/components/agent';
import { Markdown } from '@/shared/components/markdown';
import { useFormat, useMessages } from '@/shared/i18n';
import { openInBrowser } from '@/shared/platform';
import { CHATGPT_USAGE_URL, useAgents, type Item } from '@/shared/server';

import { ApprovalCard } from './ApprovalCard';
import { toBlocks, type Block } from './blocks';
import { MemoryCard, MemoryReviewLine } from './MemoryCard';
import { messages } from './messages';
import { useRevealed } from './reveal';
import { BlockedLine, ToolCalls } from './ToolCalls';

const quiet = 'text-meta text-fg-muted whitespace-pre-wrap';

/**
 * The centre column as plain chat: my messages as bubbles, the agent's as prose, tool calls as one counted line
 * (with what I answered when they asked), a call that waits for my answer as a card, a memory the agent suggested as
 * a card under its call, and the rest (notices, why a run stopped) as quiet lines. Each answer of a known agent has
 * its face and name above it; dividers (like the compaction one) mark the agent being switched or changed.
 */
export function Chat({
  sessionId,
  cwd,
  items,
  activeIds,
}: {
  sessionId: string;
  /** The project the session works in, whose memory the suggestions go to. */
  cwd: string;
  items: Item[];
  activeIds: readonly string[];
}) {
  return (
    <div className="flex flex-col gap-4">
      {toBlocks(items, activeIds).map((block) =>
        block.type === 'tools' ? (
          <ToolCalls key={block.id} rows={block.rows} />
        ) : block.type === 'blocked' ? (
          <BlockedLine key={block.item.id} item={block.item} />
        ) : block.type === 'approval' ? (
          <ApprovalCard key={block.item.id} sessionId={sessionId} approval={block.item} />
        ) : block.type === 'memory' ? (
          <MemoryCard key={`memory-${block.call.id}`} sessionId={sessionId} cwd={cwd} call={block.call} />
        ) : block.item.kind === 'memory_review' ? (
          <MemoryReviewLine key={block.item.id} cwd={cwd} item={block.item} />
        ) : (
          <ItemView key={block.item.id} item={block.item} active={activeIds.includes(block.item.id)} />
        ),
      )}
    </div>
  );
}

/** A reply as it streams in: let out at an even pace, drawn as markdown, under the face and name of its agent. */
function AgentMessage({ text, agent, streaming }: { text: string; agent: string | null; streaming: boolean }) {
  const a = useMessages(agentMessages);
  const writer = useAgents().data?.agents.find((candidate) => candidate.id === agent);
  const shown = useRevealed(text, streaming);
  if (!shown) return null;
  return (
    <div className="flex flex-col gap-2">
      {writer && (
        <div className="flex items-center gap-2 text-meta text-fg-muted">
          <Character look={writer.look} color={writer.color} size={22} />
          {agentName(writer, a)}
        </div>
      )}
      <Markdown text={shown} streaming={streaming} />
    </div>
  );
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
  const a = useMessages(agentMessages);
  switch (item.kind) {
    case 'user_message':
      return (
        <div className="flex justify-end">
          <p className="max-w-140 rounded-2xl bg-hover px-4 py-2 text-reading whitespace-pre-wrap">{item.text}</p>
        </div>
      );
    case 'agent_message':
      return <AgentMessage text={item.text} agent={item.agent} streaming={active} />;
    case 'notice':
      // The model reads the core's words; memory notices are worded here, in the app's language.
      if (item.source === 'memory_added' || item.source === 'memory_removed')
        return <p className={quiet}>{t[`notice_${item.source}`]}</p>;
      if (item.source === 'memory_check')
        return <p className={quiet}>{t.notice_memory_check(item.text.slice(item.text.indexOf(': ') + 2))}</p>;
      return <p className={quiet}>{item.text}</p>;
    case 'status_line':
      return <p className={quiet}>{item.text}</p>;
    case 'memory_review': // drawn by the chat with the project it links to
      return null;
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
    case 'agent_switched':
      return (
        <div role="note" className="flex items-center gap-3 text-meta text-fg-muted">
          <span className="h-px grow bg-line-subtle" />
          <Character look={item.look} color={item.color} size={22} />
          {t.agentSwitched(agentName({ id: item.agent, name: item.name }, a))}
          <span className="h-px grow bg-line-subtle" />
        </div>
      );
    case 'agent_changed': {
      const list = (names: string[]) => names.map((name) => toolLabel(name, a)).join(', ');
      const changes = [
        item.added.length > 0 && t.changeAdded(list(item.added)),
        item.removed.length > 0 && t.changeRemoved(list(item.removed)),
        item.instructions && t.changeInstructions,
        item.model && t.changeModel,
      ].filter((part): part is string => !!part);
      return (
        <div role="note" className="flex items-center gap-3 text-meta text-fg-muted">
          <span className="h-px grow bg-line-subtle" />
          <Character look={item.look} color={item.color} size={22} />
          <span>
            {t.agentChanged(agentName({ id: item.agent, name: item.name }, a), changes.join(' · '))} ·{' '}
            <Link to="/agents" search={{ agent: item.agent }} className="text-interactive hover:underline">
              {t.seeAgent}
            </Link>
          </span>
          <span className="h-px grow bg-line-subtle" />
        </div>
      );
    }
  }
});
