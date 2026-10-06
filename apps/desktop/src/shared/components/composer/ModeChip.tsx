import type { SessionInfo } from '@alpine/protocol';
import { Menu } from '@alpine/ui/primitives';
import { useNavigate } from '@tanstack/react-router';
import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';

import { useMessages } from '@/shared/i18n';

import { modeMessages } from './modeMessages';

export type Mode = SessionInfo['mode'];

/** The modes in the order the menu lists them and Shift+Tab goes through them. */
export const MODES: readonly Mode[] = ['default', 'accept_edits', 'yolo'];

/** The mode after `mode`, as Shift+Tab goes: back to the first after the last. */
export function nextMode(mode: Mode): Mode {
  return MODES[(MODES.indexOf(mode) + 1) % MODES.length]!;
}

const chip =
  'inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-meta whitespace-nowrap text-fg-muted hover:bg-canvas-sunken hover:text-fg data-popup-open:bg-canvas-sunken';

/**
 * When the agent asks before it acts: the mode of a session, or the one a new session starts with. Never asking is
 * written in red, here and in the menu. Shift+Tab in the input goes to the next mode (the composer handles it).
 */
export function ModeChip({
  mode,
  onChange,
  disabled = false,
}: {
  mode: Mode;
  onChange: (mode: Mode) => void;
  disabled?: boolean;
}) {
  const t = useMessages(modeMessages);
  const navigate = useNavigate();
  return (
    <Menu.Root>
      <Menu.Trigger disabled={disabled} className={chip} title={t.chipTitle} aria-label={t.chipLabel(t.name(mode))}>
        <span className={mode === 'yolo' ? 'text-danger' : 'text-fg'}>{t.name(mode)}</span>
        <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Popup side="top" align="start" className="w-80">
        <Menu.RadioGroup value={mode} onValueChange={(value: Mode) => onChange(value)}>
          {MODES.map((value) => (
            <Menu.RadioItem key={value} value={value}>
              <span className="flex min-w-0 grow flex-col">
                <span className={clsx(value === 'yolo' && 'text-danger')}>{t.name(value)}</span>
                <span className="text-meta text-fg-muted">{t.description(value)}</span>
              </span>
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
        <Menu.Separator />
        <Menu.Item onClick={() => void navigate({ to: '/settings', search: { tab: 'general' } })}>
          {t.changeDefault}
        </Menu.Item>
      </Menu.Popup>
    </Menu.Root>
  );
}
