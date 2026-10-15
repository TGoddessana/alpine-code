import { useNavigate } from '@tanstack/react-router';
import clsx from 'clsx';
import { Plus } from 'lucide-react';
import { useMemo } from 'react';

import { skillDoes, skillTitle } from '@/shared/components/skills';
import { useLocale, useMessages } from '@/shared/i18n';
import { useSkills } from '@/shared/server';

import { messages } from './messages';

/** A skill as the `/` menu shows it. */
export interface SlashSkill {
  name: string;
  title: string;
  does: string;
}

/** What the composer's `/` menu offers in a project: its skills and the user's, and a way to find more. */
export function useSlashSkills(cwd?: string | null): { skills: SlashSkill[]; onFind: () => void } {
  const { locale } = useLocale();
  const navigate = useNavigate();
  const data = useSkills(cwd).data?.skills;
  const skills = useMemo(
    () => (data ?? []).map((s) => ({ name: s.name, title: skillTitle(s.name, locale), does: skillDoes(s, locale) })),
    [data, locale],
  );
  return { skills, onFind: () => void navigate({ to: '/agents', search: { library: 'skill' } }) };
}

/** The word after `/` while it is the whole message so far (`/pd`), else `null`. */
export function slashQuery(text: string): string | null {
  const match = text.match(/^\/([\w.:-]*)$/);
  return match ? match[1]!.toLowerCase() : null;
}

/** The skills that match what is typed after `/`: names that start with it first, then any that contain it. */
export function matchSkills(skills: SlashSkill[], query: string): SlashSkill[] {
  const has = (s: SlashSkill) => [s.name, s.title.toLowerCase()].some((x) => x.includes(query));
  const starts = skills.filter((s) => s.name.startsWith(query));
  return [...starts, ...skills.filter((s) => !s.name.startsWith(query) && has(s))];
}

/**
 * The list over the composer while the message is `/` and a word: pick a skill to start the message with it, so the
 * agent reads it at once. The last row goes to the library to find more. Keys are handled by the composer.
 */
export function SlashMenu({
  skills,
  active,
  onPick,
  onFind,
}: {
  skills: SlashSkill[];
  active: number;
  onPick: (skill: SlashSkill) => void;
  onFind: () => void;
}) {
  const t = useMessages(messages);
  return (
    <div className="absolute inset-x-0 bottom-full z-10 mb-2 overflow-hidden rounded-xl border border-line bg-canvas-raised shadow-overlay">
      <div className="px-3 pt-2 pb-1 text-meta text-fg-faint">{t.slashTitle}</div>
      <ul role="listbox" aria-label={t.slashTitle} className="max-h-64 overflow-y-auto pb-1">
        {skills.length === 0 && <li className="px-3 py-2 text-meta text-fg-muted">{t.slashEmpty}</li>}
        {skills.map((skill, i) => (
          <li
            key={skill.name}
            role="option"
            aria-selected={i === active}
            onMouseDown={(event) => {
              event.preventDefault(); // keep the focus in the box
              onPick(skill);
            }}
            className={clsx('flex cursor-pointer items-baseline gap-2 px-3 py-1.5', i === active && 'bg-selected')}
          >
            <span className="shrink-0 font-mono text-meta text-fg-muted">/{skill.name}</span>
            <span className="shrink-0 text-body">{skill.title !== skill.name ? skill.title : ''}</span>
            <span className="min-w-0 truncate text-meta text-fg-faint">{skill.does}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onFind}
        className="flex w-full cursor-pointer items-center gap-1.5 border-t border-line-subtle px-3 py-2 text-meta text-interactive hover:bg-hover"
      >
        <Plus size={13} strokeWidth={1.5} aria-hidden="true" />
        {t.slashFind}
      </button>
    </div>
  );
}
