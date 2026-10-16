import { Button, Dialog, Input, LinkButton } from '@alpine/ui/primitives';
import { ChevronLeft } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useMessages } from '@/shared/i18n';
import { openInBrowser } from '@/shared/platform';
import {
  ServerError,
  useCancelClone,
  useCloneProject,
  useGitHub,
  useGitHubRepos,
  useGitTools,
  useInstallGitTools,
} from '@/shared/server';

import { GitHubPicker } from './GitHubPicker';
import { messages } from './messages';

/**
 * 회사·팀 프로젝트 받기: an address, nothing else. Where it goes is a setting, not a question. The dialog stays only
 * until the host has answered, so a wrong address or a missing sign-in is fixed here; then it closes and the clone
 * goes on in the background. `onDone` gets the folder: the project, or the clone on its way there.
 */
export function CloneDialog({
  open,
  onOpenChange,
  onDone,
  address,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (path: string) => void;
  /** Filled in, to try a clone again. */
  address?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Popup size="sm">
        {open && (
          <CloneForm
            initialAddress={address}
            onDone={(path) => {
              onOpenChange(false);
              onDone(path);
            }}
          />
        )}
      </Dialog.Popup>
    </Dialog.Root>
  );
}

/** The address, and what it takes to get it. `onBack` returns to the choices it was picked from. */
export function CloneForm({
  onDone,
  onBack,
  initialAddress = '',
}: {
  onDone: (path: string) => void;
  onBack?: () => void;
  initialAddress?: string;
}) {
  const t = useMessages(messages);
  const [address, setAddress] = useState(initialAddress);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [installing, setInstalling] = useState(false);
  const clone = useCloneProject();
  const cancel = useCancelClone();
  const install = useInstallGitTools();
  const tools = useGitTools();
  // The clone this form waits for; closing the form while it waits cancels it, and stops waiting for the installer.
  const attempt = useRef<string | null>(null);
  const closed = useRef(false);
  const cancelClone = cancel.mutate;
  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
      if (attempt.current) cancelClone(attempt.current);
    };
  }, [cancelClone]);

  const reason = clone.error instanceof ServerError ? clone.error.data?.reason : undefined;
  const https = isHttps(address);
  const signingIn = reason === 'no_access' && https;
  const withSignIn = clone.variables?.username !== undefined;
  const ready = address.trim() !== '' && (!signingIn || (username.trim() !== '' && password !== ''));

  const signedInToGitHub = !!useGitHub().data?.account;
  const repos = useGitHubRepos(signedInToGitHub).data?.repositories;
  // Words typed to search the list (not an address): Enter gets the first repository that matches.
  const firstMatch = /[/:@]/.test(address.trim())
    ? undefined
    : repos?.find((r) => r.fullName.toLowerCase().includes(address.trim().toLowerCase()));

  /** Gets `target` (what is typed, or a repository picked from the list). */
  const submit = (target = address) => {
    if (!target.trim() || (target === address && !ready) || clone.isPending) return;
    const id = crypto.randomUUID();
    attempt.current = id;
    const signIn = signingIn ? { username: username.trim(), password } : {};
    clone.mutate(
      { id, address: target.trim(), ...signIn },
      {
        onSuccess: (result) => {
          if (attempt.current !== id) return;
          attempt.current = null;
          onDone(result.project?.path ?? result.clone!.path);
        },
        onError: () => {
          if (attempt.current === id) attempt.current = null;
        },
      },
    );
  };

  // Opens Apple's installer, then asks every few seconds whether it finished; then carries on with the address the
  // user already gave.
  const installTools = async () => {
    setInstalling(true);
    try {
      await install.mutateAsync();
      while (!closed.current) {
        await new Promise((resolve) => setTimeout(resolve, INSTALL_CHECK_MS));
        if ((await tools.refetch()).data?.ready) break;
      }
    } finally {
      if (!closed.current) setInstalling(false);
    }
    if (!closed.current) submit();
  };

  if (reason === 'no_git_tools')
    return (
      <>
        <Dialog.Title>{t.toolsTitle}</Dialog.Title>
        <p className="text-body text-fg-muted">
          {tools.data?.installable === false ? t.toolsElsewhere : installing ? t.installing : t.toolsLead}
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Dialog.Close render={<Button />}>{t.cancel}</Dialog.Close>
          {tools.data?.installable === false ? (
            <Button variant="primary" onClick={() => void openInBrowser('https://git-scm.com/downloads')}>
              {t.getGit}
            </Button>
          ) : (
            <Button variant="primary" disabled={installing} onClick={() => void installTools()}>
              {installing ? t.waitingForInstall : t.install}
            </Button>
          )}
        </div>
      </>
    );

  const host = hostOf(address);
  const token = host ? TOKEN_PAGES[host] : undefined;
  const problem = !clone.error
    ? null
    : reason === 'no_access'
      ? withSignIn
        ? t.wrongSignIn
        : https
          ? t.noAccess
          : t.sshNoAccess
      : reason === 'unreachable'
        ? t.unreachable(host ?? address.trim())
        : t.failed(clone.error.message);

  return (
    <>
      <div className="flex items-center gap-1">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={t.back}
            title={t.back}
            className="-ml-1.5 inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
          >
            <ChevronLeft size={18} strokeWidth={1.5} aria-hidden="true" />
          </button>
        )}
        <Dialog.Title>{t.title}</Dialog.Title>
      </div>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (firstMatch && address.trim()) {
            setAddress(firstMatch.cloneUrl);
            submit(firstMatch.cloneUrl);
          } else submit();
        }}
      >
        <label htmlFor="clone-address" className="sr-only">
          {t.address}
        </label>
        <Input
          id="clone-address"
          autoFocus
          spellCheck={false}
          placeholder={signedInToGitHub ? t.searchPlaceholder : t.addressPlaceholder}
          value={address}
          onValueChange={(next) => {
            setAddress(next);
            clone.reset();
          }}
        />
        {problem && (
          <p role="alert" className="text-meta text-danger">
            {problem}
          </p>
        )}
        {signingIn && (
          <div className="flex flex-col gap-2">
            <p className="text-meta text-fg-muted">
              {t.signInLead}{' '}
              {token ? (
                <LinkButton onClick={() => void openInBrowser(token.url)}>{t.makeToken(token.site)}</LinkButton>
              ) : (
                t.tokenHint
              )}
            </p>
            <Input
              aria-label={t.username}
              placeholder={t.username}
              autoComplete="username"
              spellCheck={false}
              value={username}
              onValueChange={setUsername}
            />
            <Input
              aria-label={t.password}
              placeholder={t.password}
              type="password"
              autoComplete="current-password"
              value={password}
              onValueChange={setPassword}
            />
          </div>
        )}
        {!signingIn && (
          <GitHubPicker
            filter={address}
            disabled={clone.isPending}
            onPick={(picked) => {
              setAddress(picked);
              submit(picked);
            }}
          />
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Dialog.Close render={<Button type="button" />}>{t.cancel}</Dialog.Close>
          <Button type="submit" variant="primary" disabled={!ready || clone.isPending}>
            {clone.isPending ? t.checking : signingIn ? t.signInAndGet : t.get}
          </Button>
        </div>
      </form>
    </>
  );
}

/** How often to ask whether Apple's installer finished. */
const INSTALL_CHECK_MS = 3000;

/** Where each well-known host lets you make a token that can read repositories. */
const TOKEN_PAGES: Record<string, { site: string; url: string }> = {
  'github.com': { site: 'GitHub', url: 'https://github.com/settings/tokens/new?scopes=repo&description=AlpineCode' },
  'gitlab.com': {
    site: 'GitLab',
    url: 'https://gitlab.com/-/user_settings/personal_access_tokens?name=AlpineCode&scopes=read_repository,write_repository',
  },
  'bitbucket.org': { site: 'Bitbucket', url: 'https://bitbucket.org/account/settings/app-passwords/new' },
};

const SCP_LIKE = /^[^@/\s]+@([^:/\s]+):/;

/** The host an address points at: `owner/repo` is GitHub, as the server reads it. */
export function hostOf(address: string): string | null {
  const text = address.trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(text)) return 'github.com';
  const scp = SCP_LIKE.exec(text);
  if (scp) return scp[1]!;
  try {
    return new URL(text.includes('://') ? text : `https://${text}`).hostname || null;
  } catch {
    return null;
  }
}

/** Whether git signs in with a user name and password (or token) for the address, rather than an SSH key. */
export function isHttps(address: string): boolean {
  const text = address.trim();
  return !SCP_LIKE.test(text) && !text.startsWith('ssh://');
}
