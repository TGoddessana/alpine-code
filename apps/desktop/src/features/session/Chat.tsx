import { LinkButton } from '@alpine/ui/primitives';
import { Link } from '@tanstack/react-router';
import { memo, useMemo } from 'react';

import { agentMessages, agentName, Character, toolLabel } from '@/shared/components/agent';
import { Markdown } from '@/shared/components/markdown';
import { skillTitle } from '@/shared/components/skills';
import { TaskForceCard } from '@/shared/components/taskforce';
import { useLocale, useMessages } from '@/shared/i18n';
import { productMapMessage } from '@/shared/productMapMessage';
import { openInBrowser } from '@/shared/platform';
import { CHATGPT_USAGE_URL, useAgents, useSkills, type Item } from '@/shared/server';

import { ApprovalCard } from './ApprovalCard';
import { CompactionLine } from './CompactionLine';
import { answers, type Answer } from './answers';
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
  onShowTaskForce,
}: {
  sessionId: string;
  /** The project the session works in, whose memory the suggestions go to. */
  cwd: string;
  items: Item[];
  activeIds: readonly string[];
  /** Opens the dock on the TF's agents (its 에이전트 보기). */
  onShowTaskForce?: () => void;
}) {
  const answered = useMemo(() => answers(items), [items]);
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
        ) : block.item.kind === 'taskforce' ? (
          <TaskForceCard key={block.item.id} sessionId={sessionId} item={block.item} onShowAgents={onShowTaskForce} />
        ) : (
          <ItemView
            key={block.item.id}
            item={block.item}
            cwd={cwd}
            active={activeIds.includes(block.item.id)}
            header={answered.get(block.item.id)?.header ?? true}
            remembered={answered.get(block.item.id)?.remembered ?? null}
          />
        ),
      )}
    </div>
  );
}

/**
 * A reply as it streams in: let out at an even pace, drawn as markdown, under the face and name of its agent (once
 * per answer, see `header`). An agent that was deleted is still shown as the conversation remembers it.
 */
function AgentMessage({
  text,
  agent,
  streaming,
  header,
  remembered,
}: { text: string; agent: string | null; streaming: boolean } & Answer) {
  const a = useMessages(agentMessages);
  const found = useAgents().data?.agents.find((candidate) => candidate.id === agent);
  const writer =
    found ??
    (remembered && agent ? { id: agent, name: remembered.name, look: remembered.look, color: remembered.color } : null);
  const shown = useRevealed(text, streaming);
  if (!shown) return null;
  return (
    <div className="flex flex-col gap-2">
      {header && writer && (
        <div className="flex items-center gap-2 text-meta text-fg-muted">
          <Character look={writer.look} color={writer.color} size={22} />
          {agentName(writer, a)}
        </div>
      )}
      <Markdown text={shown} streaming={streaming} />
    </div>
  );
}

/** My message; one that starts with `/<skill>` shows the skill as a chip, since the agent got it along. */
function UserText({ text, cwd }: { text: string; cwd: string }) {
  const { locale } = useLocale();
  const t = useMessages(messages);
  const skills = useSkills(cwd).data?.skills;
  const match = text.match(/^\/([\w.:-]+)(\s+|$)/);
  if (!match || !skills?.some((s) => s.name === match[1])) return text;
  return (
    <>
      <span
        title={t.skillSent}
        className="mr-1.5 inline-flex rounded-md bg-selected px-1.5 align-baseline text-body text-interactive"
      >
        {skillTitle(match[1]!, locale)}
      </span>
      {text.slice(match[0].length)}
    </>
  );
}

/** Drawn again only when its item changed (items keep their identity until an event changes them). */
const ItemView = memo(function ItemView({
  item,
  cwd,
  active,
  header,
  remembered,
}: {
  item: Extract<Block, { type: 'item' }>['item'];
  cwd: string;
  active: boolean;
} & Answer) {
  const t = useMessages(messages);
  const a = useMessages(agentMessages);
  switch (item.kind) {
    case 'user_message': {
      const map = productMapMessage(item.text);
      return (
        <div className="flex flex-col items-end gap-2">
          <p className="max-w-140 rounded-2xl bg-hover px-4 py-2 text-reading whitespace-pre-wrap">
            {map ? map.request : <UserText text={item.text} cwd={cwd} />}
          </p>
          {map && (
            <details className="max-w-full text-meta text-fg-muted">
              <summary className="cursor-pointer">{t.productMapContext}</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words">{map.context}</pre>
            </details>
          )}
        </div>
      );
    }
    case 'agent_message':
      return (
        <AgentMessage text={item.text} agent={item.agent} streaming={active} header={header} remembered={remembered} />
      );
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
      return <CompactionLine item={item} />;
    case 'imported':
      return (
        <div role="note" className="flex items-center gap-3 text-meta text-fg-muted">
          <span className="h-px grow bg-line-subtle" />
          {t.imported(item.source === 'codex' ? 'Codex' : 'Claude Code')}
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
