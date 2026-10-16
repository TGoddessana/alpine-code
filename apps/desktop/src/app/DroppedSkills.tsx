import type { SkillsAddResult } from '@alpine/protocol';
import { Button, Dialog } from '@alpine/ui/primitives';
import { useCallback, useState } from 'react';

import { ChooseSkills, skillError, skillMessages, skillTitle } from '@/shared/components/skills';
import { useLocale, useMessages } from '@/shared/i18n';
import { ServerError, useAddSkill } from '@/shared/server';

/** What dropping a skill on the window came to: added, several to pick from, or why it failed. */
export type DropOutcome =
  | { kind: 'added'; names: string[] }
  | { kind: 'choose'; result: SkillsAddResult }
  | { kind: 'failed'; message: string };

/** A path that can only be a skill: an archive or a SKILL.md. A folder is a skill when a SKILL.md is in it. */
const SKILL_FILE = /\.(zip|skill)$|(^|\/)SKILL\.md$/i;

/**
 * Takes what was dropped on the window: skills (a `.zip`, a `.skill`, a SKILL.md or a folder with one) are added,
 * anything else goes to `onFolder`, which opens it as a project. Resolves with what to tell, or `null` when nothing
 * was a skill.
 */
export function useSkillDrop(onFolder: (path: string) => void) {
  const { mutateAsync } = useAddSkill();
  const s = useMessages(skillMessages);
  return useCallback(
    async (paths: string[]): Promise<DropOutcome | null> => {
      const names: string[] = [];
      for (const path of paths) {
        const asSkill = SKILL_FILE.test(path) ? path : `${path.replace(/\/$/, '')}/SKILL.md`;
        try {
          const result = await mutateAsync({ source: asSkill });
          if (result.choices.length > 0) return { kind: 'choose', result };
          names.push(...result.added.map((x) => x.name));
        } catch (reason) {
          const notThere = reason instanceof ServerError && reason.data?.reason === 'not_found';
          if (notThere && !SKILL_FILE.test(path)) onFolder(path);
          else return { kind: 'failed', message: skillError(reason, s) };
        }
      }
      return names.length > 0 ? { kind: 'added', names } : null;
    },
    [mutateAsync, s, onFolder],
  );
}

/** Tells what a dropped skill came to, over whatever screen is open. */
export function DroppedSkillsDialog({ outcome, onClose }: { outcome: DropOutcome | null; onClose: () => void }) {
  const s = useMessages(skillMessages);
  const { locale } = useLocale();
  const add = useAddSkill();
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog.Root open={outcome !== null} onOpenChange={(open) => !open && (onClose(), setError(null))}>
      <Dialog.Popup size={outcome?.kind === 'choose' ? 'md' : 'sm'}>
        <Dialog.Title>{s.droppedTitle}</Dialog.Title>
        {outcome?.kind === 'added' && (
          <Dialog.Description>
            {s.droppedOne(outcome.names.map((name) => skillTitle(name, locale)).join(', '))}
          </Dialog.Description>
        )}
        {outcome?.kind === 'failed' && (
          <p role="alert" className="text-body text-danger">
            {outcome.message}
          </p>
        )}
        {outcome?.kind === 'choose' && (
          <div className="max-h-[60vh] overflow-y-auto">
            <ChooseSkills
              source={outcome.result.source.split('/').pop() ?? outcome.result.source}
              choices={outcome.result.choices}
              onAdd={async (names) => {
                setError(null);
                try {
                  await add.mutateAsync({ source: outcome.result.source, names });
                  return true;
                } catch (reason) {
                  setError(skillError(reason, s));
                  return false;
                }
              }}
            />
          </div>
        )}
        {error && (
          <p role="alert" className="text-meta text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Dialog.Close render={<Button variant="primary" />}>{s.close}</Dialog.Close>
        </div>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
