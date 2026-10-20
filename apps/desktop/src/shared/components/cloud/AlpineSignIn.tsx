import { AutoHeight, Button, Input, LinkButton } from '@alpine/ui/primitives';
import { ChevronRight } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { useFormat, useLocale, useMessages } from '@/shared/i18n';
import { openInBrowser } from '@/shared/platform';
import {
  ServerError,
  useAlpineSignIn,
  useCloudStatus,
  useSendCode,
  useSignInMethods,
  useVerifyCode,
} from '@/shared/server';

import { messages } from './messages';

type Method = 'google' | 'github';

type Step =
  | { name: 'choose' }
  | { name: 'waiting'; method: Method }
  | { name: 'email' }
  | { name: 'code'; email: string }
  | { name: 'welcome' };

export interface AlpineSignInProps {
  /** Why the sign-in is asked for now, when something asked for it (publishing, Pro). Replaces the usual lead. */
  reason?: string;
  /** Shows the free credits once, after the first sign-in. Publishing goes straight on instead. */
  welcome?: boolean;
  /** There is a step before this one to go back to. */
  onBack?: () => void;
  /** There is none (opened from Settings): the sheet only closes. Ignored when `onBack` is given. */
  onClose?: () => void;
  /** Signed in: the server has the account, the plan and the credits (`useCloudStatus`). */
  onDone: () => void;
}

/**
 * Decision 3 and 23: the one Alpine account, by Google, GitHub or a code sent by email, on the server's
 * `cloud/signIn` and `cloud/sendCode`. The first run shows it as the top row of the AI list; publishing and Pro show it
 * with the reason they need it. Each step settles in place and the sheet follows its height.
 */
export function AlpineSignIn({ reason, welcome = false, onBack, onClose, onDone }: AlpineSignInProps) {
  const t = useMessages(messages);
  const [step, setStep] = useState<Step>({ name: 'choose' });
  const signIn = useAlpineSignIn();
  const methods = useSignInMethods();
  // A server that sends only the email code has nothing to choose from: the sheet starts at the address.
  const emailOnly = methods !== null && methods.length === 1 && methods[0] === 'email';
  const current: Step = step.name === 'choose' && emailOnly ? { name: 'email' } : step;
  const connected = step.name === 'waiting' && signIn.state.status === 'connected';
  const finish = () => (welcome ? setStep({ name: 'welcome' }) : onDone());

  useEffect(() => {
    // The browser came back signed in. With a welcome it is shown from the state below; without, publishing goes on.
    if (connected && !welcome) onDone();
  }, [connected, welcome, onDone]);

  const viaBrowser = (method: Method) => {
    setStep({ name: 'waiting', method });
    void signIn.start(method).then((url) => {
      if (url) void openInBrowser(url);
    });
  };
  const leaveBrowser = () => {
    signIn.cancel();
    setStep({ name: 'choose' });
  };

  let body: ReactNode;
  if (connected && welcome) body = <Welcome onStart={onDone} />;
  else
    switch (current.name) {
      case 'choose':
        body = (
          <>
            <Heading title={t.signInTitle} lead={reason ?? t.signInLead} />
            <div className="flex flex-col gap-2">
              {methods?.includes('google') && <Way label={t.google} onClick={() => viaBrowser('google')} />}
              {methods?.includes('github') && <Way label={t.github} onClick={() => viaBrowser('github')} />}
              {methods?.includes('email') && <Way label={t.email} onClick={() => setStep({ name: 'email' })} />}
            </div>
            {(onBack || onClose) && (
              <div>
                <LinkButton onClick={onBack ?? onClose}>{onBack ? t.back : t.close}</LinkButton>
              </div>
            )}
          </>
        );
        break;
      case 'waiting': {
        const { state } = signIn;
        const stopped = state.status === 'timed_out' || state.status === 'failed';
        body = (
          <>
            <Heading title={t.waitingTitle} lead={t.waitingLead} />
            {stopped ? (
              <p role="alert" className="text-meta text-danger">
                {state.status === 'timed_out' ? t.timedOut : t.signInFailed(state.message ?? '')}
              </p>
            ) : (
              <p role="status" className="inline-flex items-center gap-2 text-meta text-fg-muted">
                <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-interactive" />
                {current.method === 'google' ? t.google : t.github}
              </p>
            )}
            <div className="flex items-center justify-between">
              <LinkButton onClick={leaveBrowser}>{t.back}</LinkButton>
              {stopped ? (
                <LinkButton onClick={() => viaBrowser(current.method)}>{t.tryAgain}</LinkButton>
              ) : (
                state.status === 'waiting' && <NoBrowser url={state.url} />
              )}
            </div>
          </>
        );
        break;
      }
      case 'email':
        body = (
          <EmailStep
            onBack={emailOnly ? (onBack ?? onClose) : () => setStep({ name: 'choose' })}
            closes={emailOnly && !onBack}
            onSent={(email) => setStep({ name: 'code', email })}
          />
        );
        break;
      case 'code':
        body = <CodeStep email={current.email} onBack={() => setStep({ name: 'email' })} onDone={finish} />;
        break;
      case 'welcome':
        body = <Welcome onStart={onDone} />;
        break;
    }

  return (
    <AutoHeight>
      <div key={connected ? 'welcome' : current.name} className="motion-step flex flex-col gap-4">
        {body}
      </div>
    </AutoHeight>
  );
}

/** Where the sign-in page is, for when the browser did not open by itself. */
function NoBrowser({ url }: { url: string }) {
  const t = useMessages(messages);
  const [copied, setCopied] = useState(false);
  return (
    <span className="flex items-center gap-3">
      <LinkButton onClick={() => void openInBrowser(url)}>{t.openAgain}</LinkButton>
      <LinkButton onClick={() => void navigator.clipboard.writeText(url).then(() => setCopied(true))}>
        {copied ? t.copied : t.copyAddress}
      </LinkButton>
    </span>
  );
}

function Heading({ title, lead }: { title: string; lead: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-title">{title}</h2>
      <p className="text-body text-fg-muted">{lead}</p>
    </div>
  );
}

function Way({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-10 w-full cursor-pointer items-center justify-between rounded-lg border border-line bg-canvas-raised px-3 text-left text-body hover:bg-hover"
    >
      {label}
      <ChevronRight size={16} strokeWidth={1.5} className="text-fg-muted" aria-hidden="true" />
    </button>
  );
}

function EmailStep({
  onBack,
  closes = false,
  onSent,
}: {
  onBack?: () => void;
  closes?: boolean;
  onSent: (email: string) => void;
}) {
  const t = useMessages(messages);
  const { locale } = useLocale();
  const send = useSendCode();
  const [email, setEmail] = useState('');
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const submit = () => send.mutate({ email, locale }, { onSuccess: () => onSent(email) });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !send.isPending) submit();
      }}
    >
      <Heading title={t.email} lead={t.signInLead} />
      <label className="flex flex-col gap-1.5">
        <span className="text-meta text-fg-muted">{t.emailLabel}</span>
        <Input
          type="email"
          autoFocus
          autoComplete="email"
          placeholder={t.emailPlaceholder}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      {send.error && (
        <p role="alert" className="motion-step text-meta text-danger">
          {t.sendFailed(send.error.message)}
        </p>
      )}
      <div className="flex items-center justify-between">
        {onBack ? <LinkButton onClick={onBack}>{closes ? t.close : t.back}</LinkButton> : <span />}
        <Button type="submit" variant="primary" disabled={!valid || send.isPending}>
          {t.sendCode}
        </Button>
      </div>
    </form>
  );
}

function CodeStep({ email, onBack, onDone }: { email: string; onBack: () => void; onDone: () => void }) {
  const t = useMessages(messages);
  const { locale } = useLocale();
  const verify = useVerifyCode();
  const resend = useSendCode();
  const [code, setCode] = useState('');
  const wrong = verify.error instanceof ServerError && verify.error.data?.reason === 'invalid_code';
  const change = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    verify.reset();
    if (digits.length === 6) verify.mutate({ email, code: digits }, { onSuccess: onDone });
  };
  return (
    <>
      <Heading title={t.codeTitle} lead={t.codeLead(email)} />
      <label className="flex flex-col gap-1.5">
        <span className="sr-only">{t.codeLabel}</span>
        <Input
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-invalid={wrong}
          disabled={verify.isPending}
          value={code}
          onChange={(event) => change(event.target.value)}
          className="min-h-11 text-center font-mono text-title"
          style={{ letterSpacing: '0.5em' }}
        />
      </label>
      {verify.error && (
        <p role="alert" className="motion-step text-meta text-danger">
          {wrong ? t.wrongCode : t.verifyFailed(verify.error.message)}
        </p>
      )}
      <div className="flex items-center justify-between">
        <LinkButton onClick={onBack}>{t.back}</LinkButton>
        <LinkButton onClick={() => resend.mutate({ email, locale })}>
          {resend.isSuccess ? t.sentAgain : t.resend}
        </LinkButton>
      </div>
    </>
  );
}

function Welcome({ onStart }: { onStart: () => void }) {
  const t = useMessages(messages);
  const format = useFormat();
  const status = useCloudStatus().data;
  const name = status?.account?.name ?? status?.account?.email ?? null;
  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="text-title">{name ? t.welcomeTitle(name) : t.welcomeTitleAnon}</h2>
        {status?.credits && (
          <p className="text-body text-fg">{t.welcomeCredits(format.number(status.credits.balance))}</p>
        )}
        <p className="text-body text-fg-muted">{t.welcomeLead}</p>
      </div>
      <div className="flex justify-end">
        <Button variant="primary" autoFocus onClick={onStart}>
          {t.start}
        </Button>
      </div>
    </>
  );
}
