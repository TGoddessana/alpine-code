import type { AgentInfo } from '@alpine/protocol';
import { Popover } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { Pencil } from 'lucide-react';
import { useState } from 'react';

import { CHARACTER_COLORS, Character, LOOKS, agentMessages } from '@/shared/components/agent';
import { useMessages } from '@/shared/i18n';

import { agentsMessages } from './messages';

/** Full class names, so the tokens stay visible to the class scanner. */
const SWATCH: Record<number, string> = {
  1: 'bg-avatar-1 border-avatar-1-ink',
  2: 'bg-avatar-2 border-avatar-2-ink',
  3: 'bg-avatar-3 border-avatar-3-ink',
  4: 'bg-avatar-4 border-avatar-4-ink',
  5: 'bg-avatar-5 border-avatar-5-ink',
  6: 'bg-avatar-6 border-avatar-6-ink',
  7: 'bg-avatar-7 border-avatar-7-ink',
  8: 'bg-avatar-8 border-avatar-8-ink',
};

/**
 * Boards 에이전트 화면 and 캐릭터 모음: the agent's character, big, as a button with a small pencil. It opens a sheet
 * with the twelve looks and the eight colours; every pick is saved at once.
 */
export function CharacterPicker({
  agent,
  onChange,
}: {
  agent: AgentInfo;
  onChange: (character: { look: AgentInfo['look']; color: number }) => void;
}) {
  const t = useMessages(agentsMessages);
  const a = useMessages(agentMessages);
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={t.changeCharacter}
        className="relative block cursor-pointer rounded-xl p-1 hover:bg-hover data-popup-open:bg-hover"
      >
        <Character look={agent.look} color={agent.color} size={96} label="" />
        <span
          aria-hidden="true"
          className="absolute right-0.5 bottom-2 flex size-6.5 items-center justify-center rounded-full border border-line bg-canvas-raised text-fg-muted"
        >
          <Pencil size={12} strokeWidth={1.5} />
        </span>
      </Popover.Trigger>
      <Popover.Popup className="w-93">
        <div className="flex items-center justify-between">
          <Popover.Title className="text-body font-medium">{t.characterTitle}</Popover.Title>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="min-h-7 cursor-pointer rounded-md px-2 text-body text-interactive hover:bg-hover"
          >
            {t.characterDone}
          </button>
        </div>
        <div className="grid grid-cols-6 gap-1.5">
          {LOOKS.map((look) => (
            <button
              key={look}
              type="button"
              title={a[`look_${look}`]}
              aria-label={a[`look_${look}`]}
              aria-pressed={agent.look === look}
              onClick={() => onChange({ look, color: agent.color })}
              className={clsx(
                'flex cursor-pointer items-center justify-center rounded-lg border-2 p-1',
                agent.look === look ? 'border-interactive bg-selected' : 'border-transparent hover:bg-hover',
              )}
            >
              <Character look={look} color={agent.color} size={44} label="" />
            </button>
          ))}
        </div>
        <span className="text-meta text-fg-faint">{t.colors}</span>
        <div className="flex flex-wrap gap-2">
          {CHARACTER_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              title={a[`color_${color}`]}
              aria-label={a[`color_${color}`]}
              aria-pressed={agent.color === color}
              onClick={() => onChange({ look: agent.look, color })}
              className={clsx(
                'size-7 cursor-pointer rounded-full border',
                SWATCH[color],
                agent.color === color && 'ring-2 ring-interactive ring-offset-2 ring-offset-canvas-raised',
              )}
            />
          ))}
        </div>
      </Popover.Popup>
    </Popover.Root>
  );
}
