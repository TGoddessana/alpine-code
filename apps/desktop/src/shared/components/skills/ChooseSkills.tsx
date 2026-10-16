import type { SkillCandidate } from '@alpine/protocol';
import { Button } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { useState } from 'react';

import { useFormat, useLocale, useMessages } from '@/shared/i18n';

import { skillMessages } from './messages';
import { skillDoes, skillTitle } from './recommended';

/**
 * What a link with several skills holds (a repository of them): each with its own add button, and one to add all.
 * `onAdd` adds the names and resolves with whether they are in; a row shows it is being fetched, then added.
 */
export function ChooseSkills({
  source,
  choices,
  onAdd,
}: {
  source: string;
  choices: SkillCandidate[];
  onAdd: (names: string[]) => Promise<boolean>;
}) {
  const t = useMessages(skillMessages);
  const { locale } = useLocale();
  const format = useFormat();
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Set<string>>(new Set());
  const left = choices.filter((c) => !done.has(c.name) && !c.installed).map((c) => c.name);

  const add = async (names: string[]) => {
    setBusy((b) => new Set([...b, ...names]));
    try {
      if (await onAdd(names)) setDone((d) => new Set([...d, ...names]));
    } finally {
      setBusy((b) => new Set([...b].filter((n) => !names.includes(n))));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 grow">
          <p className="font-medium break-words">{t.chooseTitle(source, format.number(choices.length))}</p>
          <p className="text-meta text-fg-muted">{t.chooseNote}</p>
        </div>
        {left.length > 1 && (
          <Button className="shrink-0" disabled={busy.size > 0} onClick={() => void add(left)}>
            {t.addAll(format.number(left.length))}
          </Button>
        )}
      </div>
      <ul className="flex flex-col divide-y divide-line-subtle rounded-xl border border-line">
        {choices.map((c) => {
          const isDone = done.has(c.name);
          const isBusy = busy.has(c.name);
          return (
            <li key={c.name} className="flex items-start gap-3 px-3 py-2.5">
              <div className="min-w-0 grow">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{skillTitle(c.name, locale)}</span>
                  {skillTitle(c.name, locale) !== c.name && <span className="text-meta text-fg-faint">{c.name}</span>}
                  {c.hasScripts && <span className="text-meta text-fg-muted">· {t.hasScripts}</span>}
                </div>
                <p className="text-meta text-fg-muted">{skillDoes(c, locale)}</p>
              </div>
              {isDone ? (
                <span className="shrink-0 py-1 text-meta text-interactive">{t.added}</span>
              ) : (
                <Button
                  aria-label={t.addNamed(c.name)}
                  disabled={isBusy}
                  onClick={() => void add([c.name])}
                  className={clsx('min-h-7 shrink-0', !c.installed && 'border-interactive text-interactive')}
                >
                  {isBusy ? t.adding : c.installed ? t.installedAlready : t.add}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
