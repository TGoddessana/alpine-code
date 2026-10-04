import { LinkButton } from '@alpine/ui/primitives';
import clsx from 'clsx';

import { useFormat, useMessages } from '@/shared/i18n';
import { openInBrowser } from '@/shared/platform';
import { useProjectGit } from '@/shared/server';

import { messages } from './messages';

/**
 * The line over the input: where it runs, then +added −deleted · PR #n · automatic checks, or 'no git' (the branch is in the top bar).
 * Numbers stay grey: red means risk or failure here, so only failing CI gets a red dot.
 */
export function GitBar({ path }: { path: string }) {
  const t = useMessages(messages);
  const format = useFormat();
  const query = useProjectGit(path);
  const git = query.data?.git;
  if (!git)
    return (
      <div aria-label={t.label} className="flex min-h-6 items-center gap-2 text-meta whitespace-nowrap text-fg-muted">
        <span>{t.local}</span>
        {query.isSuccess && (
          <>
            <Sep />
            <span>{t.noGit}</span>
          </>
        )}
      </div>
    );
  const pr = git.pullRequest;
  const added = format.number(git.added);
  const deleted = format.number(git.deleted);

  return (
    <div
      aria-label={t.label}
      className="flex min-h-6 min-w-0 items-center gap-2 text-meta whitespace-nowrap text-fg-muted"
    >
      <span>{t.local}</span>
      <Sep />
      {git.added || git.deleted ? (
        <span aria-label={t.changes(added, deleted)}>
          +{added} −{deleted}
        </span>
      ) : (
        <span>{t.noChanges}</span>
      )}
      {pr && (
        <>
          <Sep />
          <LinkButton
            className="min-h-6 px-0.5"
            aria-label={t.openPr(pr.number)}
            onClick={() => void openInBrowser(pr.url)}
          >
            PR #{pr.number}
          </LinkButton>
          {pr.checks && (
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={clsx(
                  'size-1.5 rounded-full',
                  pr.checks === 'failing' ? 'bg-danger' : 'bg-fg-muted',
                  pr.checks === 'passing' && 'hidden',
                )}
              />
              {t[pr.checks]}
            </span>
          )}
        </>
      )}
    </div>
  );
}

function Sep() {
  return (
    <span aria-hidden="true" className="text-fg-faint">
      ·
    </span>
  );
}
