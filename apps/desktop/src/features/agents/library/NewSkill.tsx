import { Button, Input } from '@alpine/ui/primitives';
import { useState } from 'react';

import { skillError, skillMessages } from '@/shared/components/skills';
import { useMessages } from '@/shared/i18n';
import { useSaveSkill } from '@/shared/server';

import { librarySkillMessages } from './skillMessages';
import type { LibraryView, SkillActions } from './types';

/** What a name becomes as it is typed: lowercase letters, digits and single hyphens. */
export function skillName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-/, '')
    .slice(0, 64);
}

/** A SKILL.md from the three fields, with the front matter quoted so any wording reads back the same. */
export function skillFile(name: string, when: string, body: string): string {
  const description = JSON.stringify(when.trim().replace(/\s+/g, ' '));
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body.trim()}\n`;
}

/**
 * 새 스킬: a name, when it is used (what the agent sees every time) and how it is done (what it reads when the job
 * fits). Saving makes the skill, which every agent has from the next message.
 */
export function NewSkill({
  onViewChange,
  actions,
}: {
  onViewChange: (view: LibraryView) => void;
  actions: SkillActions;
}) {
  const t = useMessages(librarySkillMessages);
  const s = useMessages(skillMessages);
  const save = useSaveSkill();
  const [name, setName] = useState('');
  const [when, setWhen] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const back = () => onViewChange({ kind: 'list', tab: 'skill' });
  const finalName = name.replace(/-$/, '');
  const ready = finalName.length > 0 && when.trim().length > 0 && body.trim().length > 0;

  const create = async () => {
    setError(null);
    try {
      await save.mutateAsync({ name: finalName, text: skillFile(finalName, when, body), new: true });
      actions.onInstalled([finalName], [finalName], finalName);
      onViewChange({ kind: 'skill', name: finalName });
    } catch (reason) {
      setError(skillError(reason, s));
    }
  };

  return (
    <div className="flex flex-col gap-4 px-5 pt-4 pb-6">
      <button
        type="button"
        onClick={back}
        className="-ml-2 cursor-pointer self-start rounded-md px-2 py-1 text-body text-fg-muted hover:bg-canvas-sunken"
      >
        {t.back}
      </button>
      <div className="flex flex-col gap-1">
        <h2 className="text-display">{t.newTitle}</h2>
        <p className="text-body text-fg-muted">{t.newLead}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="skill-name" className="text-body font-medium">
          {t.name}
        </label>
        <Input
          id="skill-name"
          mono
          value={name}
          placeholder="weekly-report"
          onChange={(event) => setName(skillName(event.target.value))}
        />
        <span className="text-meta text-fg-faint">{t.nameHint}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="skill-when" className="text-body font-medium">
          {t.when}
        </label>
        <textarea
          id="skill-when"
          rows={2}
          value={when}
          placeholder={t.whenPlaceholder}
          onChange={(event) => setWhen(event.target.value)}
          className="rounded-md border border-line bg-canvas-raised px-2 py-1.5 text-body outline-none placeholder:text-fg-faint focus:border-interactive focus:ring-1 focus:ring-interactive"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="skill-body" className="text-body font-medium">
          {t.body}
        </label>
        <textarea
          id="skill-body"
          rows={9}
          value={body}
          placeholder={t.bodyPlaceholder}
          onChange={(event) => setBody(event.target.value)}
          className="rounded-md border border-line bg-canvas-raised px-2 py-1.5 text-body outline-none placeholder:text-fg-faint focus:border-interactive focus:ring-1 focus:ring-interactive"
        />
      </div>
      {error && (
        <p role="alert" className="text-meta text-danger">
          {error}
        </p>
      )}
      <Button
        variant="primary"
        className="self-start"
        disabled={!ready || save.isPending}
        onClick={() => void create()}
      >
        {save.isPending ? t.creating : t.create}
      </Button>
    </div>
  );
}
