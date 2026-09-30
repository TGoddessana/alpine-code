import type { ConnectionInfo } from '@alpine/protocol';
import { Button, Dialog, LinkButton, NativeSelect } from '@alpine/ui/primitives';
import { useEffect, useRef, useState } from 'react';

import { useMessages } from '@/shared/i18n';
import { openInBrowser } from '@/shared/platform';
import { CHATGPT_USAGE_URL, useChatGPTSignIn, useConnectionModels, useSetDefaultModel } from '@/shared/server';

import { Form, Hint } from './check';
import { messages } from './messages';

export interface ChatGPTSignInProps {
  /** Sign in again to this connection's account. Without it a new account is added, and the welcome follows. */
  connection?: string;
  /** Ask again for permission to use the plan. */
  consent?: boolean;
  /** Shows '‹ How to connect'; the first run passes it. */
  onBack?: () => void;
  /** Offered when plan usage is declined. */
  onApiKey?: () => void;
  onDone?: () => void;
  /** Start new sessions with the model chosen in the welcome. */
  makeDefault: boolean;
}

/**
 * Boards FirstRunChatGPT, FirstRunChatGPTDone and FirstRunChatGPTDeclined: the browser sign-in, then, for a new
 * account, the one-time 'You're using your ChatGPT plan' with a model to start with. Signing in starts as soon as the
 * sheet opens and the page opens in the default browser.
 */
export function ChatGPTSignIn({
  connection,
  consent = false,
  onBack,
  onApiKey,
  onDone,
  makeDefault,
}: ChatGPTSignInProps) {
  const t = useMessages(messages);
  const { state, start, cancel } = useChatGPTSignIn();
  const began = useRef(false);

  const begin = (again: { connection?: string; consent?: boolean } = { connection, consent }) =>
    void start(again).then((url) => {
      if (url) void openInBrowser(url);
    });

  useEffect(() => {
    // Once per sheet, even when React runs effects twice in development.
    if (began.current) return;
    began.current = true;
    begin();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- starts once, with the props the sheet opened with
  }, []);

  useEffect(() => {
    // Signing in again to a known account needs no welcome.
    if (state.status === 'connected' && connection) onDone?.();
  }, [state, connection, onDone]);

  if (state.status === 'connected' && !connection)
    return <Welcome connection={state.connection} makeDefault={makeDefault} onDone={onDone} />;

  if (state.status === 'declined')
    return (
      <>
        <Head onBack={onBack} title={t.chatgptDeclinedTitle} lead={t.chatgptDeclinedLead} />
        {state.connection?.account?.email && (
          <Form>
            <span>{t.account}</span>
            <span className="flex min-h-8 items-center">{state.connection.account.email}</span>
          </Form>
        )}
        <div className="flex justify-end gap-2 pt-2">
          {onApiKey && <Button onClick={onApiKey}>{t.connectWithApiKey}</Button>}
          <Button
            variant="primary"
            onClick={() =>
              begin(state.connection ? { connection: state.connection.name, consent: true } : { consent: true })
            }
          >
            {t.allowAgain}
          </Button>
        </div>
      </>
    );

  const stopped = state.status === 'timed_out' || state.status === 'failed';
  return (
    <>
      <Head onBack={onBack} title={t.chatgpt} lead={t.chatgptLead} />
      {stopped ? (
        <p role="alert" className="text-meta text-danger">
          {state.status === 'timed_out' ? t.chatgptTimedOut : t.chatgptFailed(state.message ?? '')}
        </p>
      ) : (
        <div role="status" className="flex min-h-10 items-center gap-2 rounded-lg border border-line-subtle px-3">
          <span aria-hidden="true" className="text-fg-muted">
            ●
          </span>
          <span>{t.chatgptWaiting}</span>
        </div>
      )}
      {state.status === 'waiting' && <NoBrowser url={state.url} />}
      <div className="flex justify-end gap-2 pt-2">
        {onBack ? (
          <Button
            onClick={() => {
              cancel();
              onBack();
            }}
          >
            {t.cancel}
          </Button>
        ) : (
          <Dialog.Close render={<Button />} onClick={cancel}>
            {t.cancel}
          </Dialog.Close>
        )}
        {stopped && (
          <Button variant="primary" onClick={() => begin()}>
            {t.tryAgain}
          </Button>
        )}
      </div>
    </>
  );
}

function Head({ onBack, title, lead }: { onBack?: () => void; title: string; lead: string }) {
  const t = useMessages(messages);
  return (
    <div className="flex flex-col items-start gap-2">
      {onBack && (
        <LinkButton className="-ml-1" onClick={onBack}>
          {t.backToMethods}
        </LinkButton>
      )}
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Description>{lead}</Dialog.Description>
    </div>
  );
}

function NoBrowser({ url }: { url: string }) {
  const t = useMessages(messages);
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-1">
      <span className="text-meta text-fg-muted">{t.chatgptNoBrowser}</span>
      <LinkButton onClick={() => void openInBrowser(url)}>{t.openAgain}</LinkButton>
      <LinkButton onClick={() => void navigator.clipboard.writeText(url).then(() => setCopied(true))}>
        {copied ? t.copied : t.copyAddress}
      </LinkButton>
    </div>
  );
}

/** Shown once, right after a new account connects: what the plan pays for, and a model to start with. */
function Welcome({
  connection,
  makeDefault,
  onDone,
}: {
  connection: ConnectionInfo;
  makeDefault: boolean;
  onDone?: () => void;
}) {
  const t = useMessages(messages);
  const models = useConnectionModels(makeDefault ? { connection: connection.name } : null);
  const setDefault = useSetDefaultModel();
  const [picked, setPicked] = useState<string | null>(null);
  const model = picked ?? models.data?.models[0] ?? null;

  const finish = () => {
    if (makeDefault && model) setDefault.mutate(`${connection.name}/${model}`, { onSuccess: () => onDone?.() });
    else onDone?.();
  };

  return (
    <>
      <div className="flex flex-col gap-2">
        <Dialog.Title>{t.chatgptWelcomeTitle}</Dialog.Title>
        <Dialog.Description>{t.chatgptWelcomeLead}</Dialog.Description>
      </div>
      <Form>
        <span>{t.account}</span>
        <span className="flex min-h-8 items-center">{connection.account?.email}</span>
        {makeDefault && (
          <>
            <label htmlFor="chatgpt-model">{t.model}</label>
            <NativeSelect
              id="chatgpt-model"
              value={model ?? ''}
              disabled={!models.data}
              onChange={(event) => setPicked(event.target.value)}
            >
              {(models.data?.models ?? []).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </NativeSelect>
            <Hint>{models.error ? t.checkFailed(models.error.message) : t.newSessionModel}</Hint>
          </>
        )}
      </Form>
      <div className="flex items-center gap-2 pt-2">
        <LinkButton className="-ml-1" onClick={() => void openInBrowser(CHATGPT_USAGE_URL)}>
          {t.manageUsage}
        </LinkButton>
        <span className="grow" />
        <Button variant="primary" disabled={makeDefault && !model} onClick={finish}>
          {t.gotIt}
        </Button>
      </div>
    </>
  );
}
