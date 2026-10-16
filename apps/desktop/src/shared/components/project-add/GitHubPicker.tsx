import type { GitHubRepository } from '@alpine/protocol';
import { Button, LinkButton } from '@alpine/ui/primitives';
import { useState } from 'react';

import { useFormat, useMessages } from '@/shared/i18n';
import { openInBrowser } from '@/shared/platform';
import { useGitHub, useGitHubRepos, useGitHubSignIn } from '@/shared/server';

import { messages } from './messages';

/** Rows shown before the list scrolls. */
const SHOWN = 6;

/**
 * Under the address: signed out, a way to sign in to GitHub; signing in, the code to enter on github.com; signed in,
 * the user's repositories, narrowed by what is typed in the address box. Picking one gets it at once. Shows nothing
 * when this build has no GitHub app.
 */
export function GitHubPicker({
  filter,
  disabled,
  onPick,
}: {
  filter: string;
  disabled: boolean;
  onPick: (address: string) => void;
}) {
  const t = useMessages(messages);
  const status = useGitHub().data;
  const signIn = useGitHubSignIn();
  const [copied, setCopied] = useState(false);
  if (!status?.available) return null;

  if (status.account) return <Repositories filter={filter} disabled={disabled} onPick={onPick} />;

  const { state } = signIn;
  if (state.status === 'waiting')
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-line px-4 py-4 text-center">
        <p className="text-meta text-fg-muted">{t.enterCode}</p>
        <p className="font-mono text-display tracking-widest" aria-label={t.codeLabel}>
          {state.userCode}
        </p>
        <div className="flex items-center gap-1">
          <LinkButton onClick={() => void navigator.clipboard.writeText(state.userCode).then(() => setCopied(true))}>
            {copied ? t.copied : t.copyCode}
          </LinkButton>
          <span className="text-meta text-fg-faint" aria-hidden="true">
            ·
          </span>
          <LinkButton onClick={() => void openInBrowser(state.verificationUri)}>{t.openGitHubAgain}</LinkButton>
          <span className="text-meta text-fg-faint" aria-hidden="true">
            ·
          </span>
          <LinkButton onClick={signIn.cancel}>{t.cancel}</LinkButton>
        </div>
      </div>
    );

  const start = async () => {
    const started = await signIn.start();
    if (!started) return;
    setCopied(false);
    // The code goes to the clipboard so pasting it is all there is to do on GitHub.
    void navigator.clipboard
      .writeText(started.userCode)
      .then(() => setCopied(true))
      .catch(() => {});
    void openInBrowser(started.verificationUri);
  };
  const ended =
    state.status === 'declined'
      ? t.gitHubDeclined
      : state.status === 'timed_out'
        ? t.gitHubTimedOut
        : state.status === 'failed'
          ? t.gitHubFailed(state.message ?? '')
          : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2" aria-hidden="true">
        <span className="h-px grow bg-line" />
        <span className="text-meta text-fg-muted">{t.or}</span>
        <span className="h-px grow bg-line" />
      </div>
      <Button type="button" disabled={state.status === 'starting'} onClick={() => void start()}>
        {t.signInToGitHub}
      </Button>
      <p className={ended ? 'text-meta text-danger' : 'text-meta text-fg-muted'} role={ended ? 'alert' : undefined}>
        {ended ?? t.signInToGitHubHint}
      </p>
    </div>
  );
}

function Repositories({
  filter,
  disabled,
  onPick,
}: {
  filter: string;
  disabled: boolean;
  onPick: (address: string) => void;
}) {
  const t = useMessages(messages);
  const format = useFormat();
  const status = useGitHub().data!;
  const repos = useGitHubRepos(true);
  const words = filter.trim().toLowerCase();
  const shown = (repos.data?.repositories ?? []).filter((r) => !words || r.fullName.toLowerCase().includes(words));
  const footer = (
    <p className="text-meta text-fg-muted">
      {t.signedInAs(status.account!.login)} · {t.missingOrgRepos}{' '}
      <LinkButton onClick={() => void openInBrowser(status.accessUrl)}>{t.askOrgAccess}</LinkButton>
    </p>
  );

  if (repos.isPending) return <p className="text-meta text-fg-muted">{t.loadingRepos}</p>;
  if (repos.isError) return <p className="text-meta text-danger">{t.reposFailed}</p>;
  return (
    <div className="flex flex-col gap-2">
      {shown.length > 0 ? (
        <ul
          aria-label={t.yourRepos}
          className="flex flex-col overflow-y-auto rounded-lg border border-line"
          style={{ maxHeight: `${SHOWN * 2.5}rem` }}
        >
          {shown.map((repo) => (
            <li key={repo.fullName} className="border-b border-line last:border-b-0">
              <RepoRow
                repo={repo}
                since={repo.pushedAt ? format.since(new Date(repo.pushedAt)) : null}
                disabled={disabled}
                onPick={onPick}
              />
            </li>
          ))}
        </ul>
      ) : (
        words && <p className="text-meta text-fg-muted">{t.noRepoMatches}</p>
      )}
      {footer}
    </div>
  );
}

function RepoRow({
  repo,
  since,
  disabled,
  onPick,
}: {
  repo: GitHubRepository;
  since: string | null;
  disabled: boolean;
  onPick: (address: string) => void;
}) {
  const t = useMessages(messages);
  const [owner, name] = repo.fullName.split('/');
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(repo.cloneUrl)}
      title={repo.description ?? repo.fullName}
      className="flex min-h-10 w-full cursor-pointer items-center gap-2 px-3 text-left text-body hover:bg-hover disabled:cursor-default"
    >
      <span className="min-w-0 grow truncate">
        <span className="text-fg-muted">{owner} / </span>
        {name}
      </span>
      {repo.private && <span className="shrink-0 text-meta text-fg-muted">{t.private}</span>}
      {since && <span className="shrink-0 text-meta text-fg-faint">{since}</span>}
    </button>
  );
}
