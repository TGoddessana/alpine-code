import { AutoHeight, Button, Input, LinkButton } from '@alpine/ui/primitives';
import { ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { useFormat, useMessages } from '@/shared/i18n';

import { messages } from './messages';
import { previewSignIn, type AlpineAccount, type AlpineSignInApi, type SignInMethod } from './preview';

type Step =
  | { name: 'choose' }
  | { name: 'waiting'; method: Exclude<SignInMethod, 'email'> }
  | { name: 'email' }
  | { name: 'code'; email: string }
  | { name: 'welcome'; account: AlpineAccount };

export interface AlpineSignInProps {
  /** Why the sign-in is asked for now, when something asked for it (publishing, Pro). Replaces the usual lead. */
  reason?: string;
  /** Shows the free credits once, after the first sign-in. Publishing goes straight on instead. */
  welcome?: boolean;
  onBack?: () => void;
  onDone: (account: AlpineAccount) => void;
  api?: AlpineSignInApi;
}

/**
 * Decision 3 and 23: the one Alpine account, by Google, GitHub or a code sent by email. The first run shows it as the
 * top row of the AI list; publishing and Pro show it with the reason they need it. Each step settles in place and the
 * sheet follows its height.
 */
export function AlpineSignIn({ reason, welcome = false, onBack, onDone, api = previewSignIn }: AlpineSignInProps) {
  const t = useMessages(messages);
  const [step, setStep] = useState<Step>({ name: 'choose' });
  const finish = (account: AlpineAccount) => (welcome ? setStep({ name: 'welcome', account }) : onDone(account));

  const viaBrowser = (method: Exclude<SignInMethod, 'email'>) => {
    setStep({ name: 'waiting', method });
    void api.browser(method).then(finish);
  };

  let body: ReactNode;
  switch (step.name) {
    case 'choose':
      body = (
        <>
          <Heading title={t.signInTitle} lead={reason ?? t.signInLead} />
          <div className="flex flex-col gap-2">
            <Way label={t.google} onClick={() => viaBrowser('google')} />
            <Way label={t.github} onClick={() => viaBrowser('github')} />
            <Way label={t.email} onClick={() => setStep({ name: 'email' })} />
          </div>
          {onBack && (
            <div>
              <LinkButton onClick={onBack}>{t.back}</LinkButton>
            </div>
          )}
        </>
      );
      break;
    case 'waiting':
      body = (
        <>
          <Heading title={t.waitingTitle} lead={t.waitingLead} />
          <p role="status" className="inline-flex items-center gap-2 text-meta text-fg-muted">
            <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-interactive" />
            {step.method === 'google' ? t.google : t.github}
          </p>
          <div className="flex items-center justify-between">
            <LinkButton onClick={() => setStep({ name: 'choose' })}>{t.back}</LinkButton>
            <LinkButton onClick={() => viaBrowser(step.method)}>{t.openAgain}</LinkButton>
          </div>
        </>
      );
      break;
    case 'email':
      body = (
        <EmailStep
          api={api}
          onBack={() => setStep({ name: 'choose' })}
          onSent={(email) => setStep({ name: 'code', email })}
        />
      );
      break;
    case 'code':
      body = <CodeStep api={api} email={step.email} onBack={() => setStep({ name: 'email' })} onDone={finish} />;
      break;
    case 'welcome':
      body = <Welcome account={step.account} onStart={() => onDone(step.account)} />;
      break;
  }

  return (
    <AutoHeight>
      <div key={step.name} className="motion-step flex flex-col gap-4">
        {body}
      </div>
    </AutoHeight>
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
  api,
  onBack,
  onSent,
}: {
  api: AlpineSignInApi;
  onBack: () => void;
  onSent: (email: string) => void;
}) {
  const t = useMessages(messages);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const send = () => {
    setSending(true);
    void api.sendCode(email).then(() => onSent(email));
  };
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !sending) send();
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
      <div className="flex items-center justify-between">
        <LinkButton onClick={onBack}>{t.back}</LinkButton>
        <Button type="submit" variant="primary" disabled={!valid || sending}>
          {t.sendCode}
        </Button>
      </div>
    </form>
  );
}

function CodeStep({
  api,
  email,
  onBack,
  onDone,
}: {
  api: AlpineSignInApi;
  email: string;
  onBack: () => void;
  onDone: (account: AlpineAccount) => void;
}) {
  const t = useMessages(messages);
  const [code, setCode] = useState('');
  const [wrong, setWrong] = useState(false);
  const change = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    setWrong(false);
    if (digits.length === 6)
      api.verify(email, digits).then(onDone, () => {
        setWrong(true);
      });
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
          value={code}
          onChange={(event) => change(event.target.value)}
          className="min-h-11 text-center font-mono text-title"
          style={{ letterSpacing: '0.5em' }}
        />
      </label>
      {wrong && (
        <p role="alert" className="motion-step text-meta text-danger">
          {t.wrongCode}
        </p>
      )}
      <div className="flex items-center justify-between">
        <LinkButton onClick={onBack}>{t.back}</LinkButton>
        <LinkButton onClick={() => void api.sendCode(email)}>{t.resend}</LinkButton>
      </div>
    </>
  );
}

function Welcome({ account, onStart }: { account: AlpineAccount; onStart: () => void }) {
  const t = useMessages(messages);
  const format = useFormat();
  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="text-title">{t.welcomeTitle(account.name)}</h2>
        <p className="text-body text-fg">{t.welcomeCredits(format.number(account.credits))}</p>
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
