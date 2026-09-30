import { LinkButton } from '@alpine/ui/primitives';
import clsx from 'clsx';

import { useFormat, useMessages } from '@/shared/i18n';
import { openInBrowser } from '@/shared/platform';
import { useProjectGit } from '@/shared/server';

import { messages } from './messages';

/**
 * The line over the input: where it runs, then branch · +added −deleted · PR #n · CI, or 'no git'.
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
      <span className="inline-flex min-w-0 items-center gap-1 font-mono text-fg">
        <BranchIcon />
        <span className="truncate">{git.branch ?? t.detached}</span>
      </span>
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

function BranchIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="3.5" cy="2.5" r="1.3" />
      <circle cx="3.5" cy="9.5" r="1.3" />
      <circle cx="8.5" cy="4" r="1.3" />
      <path d="M3.5 3.8v4.4M8.5 5.3c0 2-2.5 2-4.6 2.9" />
    </svg>
  );
}
