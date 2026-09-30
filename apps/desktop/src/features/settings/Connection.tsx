import type { ConnectionInfo, ConnectionsListResult } from '@alpine/protocol';
import { Dialog, LinkButton, NativeSelect } from '@alpine/ui/primitives';
import { useState, type ReactNode } from 'react';

import {
  ApiKeyForm,
  ChatGPTSignIn,
  connectionLabel,
  connectMessages,
  LocalServerForm,
} from '@/shared/components/connect';
import { openInBrowser } from '@/shared/platform';
import { useMessages } from '@/shared/i18n';
import { CHATGPT_USAGE_URL, useChatGPTSignOut, useConnections, useModelsOf, useSetDefaultModel } from '@/shared/server';

import { messages } from './messages';

type Sheet =
  | { kind: 'api-key'; provider?: string }
  | { kind: 'local'; address?: string }
  | { kind: 'chatgpt'; connection?: string; consent?: boolean }
  | null;

const row =
  'grid min-h-10 grid-cols-[200px_minmax(0,1fr)_auto] items-center gap-4 text-body not-first:border-t not-first:border-line-subtle';

/** Board Connection: what is connected, what can be added (the first run's list), and the default model. */
export function ConnectionTab() {
  const t = useMessages(messages);
  const c = useMessages(connectMessages);
  const connections = useConnections();
  const [sheet, setSheet] = useState<Sheet>(null);
  const data = connections.data;
  if (!data) return null;

  return (
    <div className="flex max-w-180 flex-col gap-8">
      <Section title={t.connected}>
        {data.connections.length === 0 ? (
          <p className="flex min-h-10 items-center text-fg-muted">{t.noConnections}</p>
        ) : (
          data.connections.map((connection) => (
            <div key={connection.name} className={row}>
              <span className="truncate">{connectionLabel(connection, data.providers, c)}</span>
              <Status connection={connection} data={data} />
              {connection.account ? (
                <ChatGPTActions
                  connection={connection}
                  onSignIn={(consent) => setSheet({ kind: 'chatgpt', connection: connection.name, consent })}
                />
              ) : (
                <LinkButton
                  onClick={() =>
                    setSheet(
                      connection.provider
                        ? { kind: 'api-key', provider: connection.provider }
                        : { kind: 'local', address: connection.baseUrl ?? undefined },
                    )
                  }
                >
                  {t.change}
                </LinkButton>
              )}
            </div>
          ))
        )}
      </Section>

      <Section title={t.addConnection}>
        <AddRow
          label={c.chatgpt}
          note={c.chatgptNote}
          link={`${c.continueWithChatGPT} ›`}
          onConnect={() => setSheet({ kind: 'chatgpt' })}
        />
        <AddRow label={c.copilot} note={c.soon} />
        <AddRow label={c.apiKey} note={c.apiKeyNote} onConnect={() => setSheet({ kind: 'api-key' })} />
        <AddRow label={c.local} note={c.localNote} onConnect={() => setSheet({ kind: 'local' })} />
        <p className="pt-2 text-meta text-fg-muted">{c.claudeNote}</p>
      </Section>

      {data.connections.length > 0 && (
        <Section title={t.defaultModel}>
          <div className={row}>
            <label htmlFor="settings-default-model">{t.newSession}</label>
            <DefaultModel id="settings-default-model" data={data} />
            <span />
          </div>
        </Section>
      )}

      <Dialog.Root open={sheet !== null} onOpenChange={(open) => !open && setSheet(null)}>
        <Dialog.Popup>
          {sheet?.kind === 'api-key' && (
            <ApiKeyForm
              providers={data.providers}
              initialProvider={sheet.provider}
              makeDefault={data.defaultModel === null}
              onDone={() => setSheet(null)}
            />
          )}
          {sheet?.kind === 'chatgpt' && (
            <ChatGPTSignIn
              connection={sheet.connection}
              consent={sheet.consent}
              makeDefault={data.defaultModel === null}
              onApiKey={() => setSheet({ kind: 'api-key' })}
              onDone={() => setSheet(null)}
            />
          )}
          {sheet?.kind === 'local' && (
            <LocalServerForm
              initialAddress={sheet.address}
              makeDefault={data.defaultModel === null}
              onDone={() => setSheet(null)}
            />
          )}
        </Dialog.Popup>
      </Dialog.Root>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <h2 className="text-lead">{title}</h2>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

function AddRow({
  label,
  note,
  link,
  onConnect,
}: {
  label: string;
  note: string;
  link?: string;
  onConnect?: () => void;
}) {
  const t = useMessages(messages);
  return (
    <div className={row}>
      <span className={onConnect ? undefined : 'text-fg-muted'}>{label}</span>
      <span className="text-meta text-fg-muted">{note}</span>
      {onConnect ? <LinkButton onClick={onConnect}>{link ?? t.connectLink}</LinkButton> : <span />}
    </div>
  );
}

/** How it is paid for, or what is missing. Limits and spend come with usage tracking. */
function Status({ connection, data }: { connection: ConnectionInfo; data: ConnectionsListResult }) {
  const c = useMessages(connectMessages);
  if (connection.account) {
    const { signedIn, planUsage } = connection.account;
    const text = !signedIn ? c.chatgptSignedOut : !planUsage ? c.chatgptPlanOff : c.chatgptUsageThere;
    return <span className={signedIn ? 'text-meta text-fg-muted' : 'text-meta text-danger'}>{text}</span>;
  }
  const provider = data.providers.find((p) => p.id === connection.provider);
  if (provider && !connection.hasKey) return <span className="text-meta text-danger">{c.noKey(provider.keyEnv)}</span>;
  if (!provider) return <span className="truncate font-mono text-meta text-fg-muted">{connection.baseUrl}</span>;
  return (
    <span className="text-meta text-fg-muted">{provider.billing === 'subscription' ? c.subscription : c.usage}</span>
  );
}

/** Every model of every connection, grouped by connection. The current default stays listed even if unreachable. */
function DefaultModel({ id, data }: { id: string; data: ConnectionsListResult }) {
  const t = useMessages(messages);
  const c = useMessages(connectMessages);
  const setDefault = useSetDefaultModel();
  const lists = useModelsOf(data.connections.map((connection) => ({ connection: connection.name })));
  const listed = new Set(
    data.connections.flatMap((connection, i) => (lists[i]?.data?.models ?? []).map((m) => `${connection.name}/${m}`)),
  );
  return (
    <NativeSelect id={id} value={data.defaultModel ?? ''} onChange={(event) => setDefault.mutate(event.target.value)}>
      {data.defaultModel === null && <option value="">{t.chooseModel}</option>}
      {data.defaultModel !== null && !listed.has(data.defaultModel) && <option>{data.defaultModel}</option>}
      {data.connections.map((connection, i) => (
        <optgroup key={connection.name} label={connectionLabel(connection, data.providers, c)}>
          {(lists[i]?.data?.models ?? []).map((model) => (
            <option key={model} value={`${connection.name}/${model}`}>
              {model}
            </option>
          ))}
        </optgroup>
      ))}
    </NativeSelect>
  );
}

/** A ChatGPT account's actions: while signed in, its usage page and signing out; otherwise signing in again. */
function ChatGPTActions({
  connection,
  onSignIn,
}: {
  connection: ConnectionInfo;
  onSignIn: (consent: boolean) => void;
}) {
  const c = useMessages(connectMessages);
  const signOut = useChatGPTSignOut();
  const account = connection.account!;
  if (!account.signedIn)
    return (
      <span className="inline-flex items-center gap-1">
        {signOut.data?.revoked === false && (
          <span className="text-meta text-fg-muted" role="status">
            {c.signOutUnconfirmed}
          </span>
        )}
        <LinkButton onClick={() => onSignIn(false)}>{c.signInAgain}</LinkButton>
      </span>
    );
  if (!account.planUsage) return <LinkButton onClick={() => onSignIn(true)}>{c.allowAgain}</LinkButton>;
  return (
    <span className="inline-flex items-center gap-1">
      <LinkButton onClick={() => void openInBrowser(CHATGPT_USAGE_URL)}>{c.manageUsage}</LinkButton>
      <LinkButton disabled={signOut.isPending} onClick={() => signOut.mutate(connection.name)}>
        {c.signOut}
      </LinkButton>
    </span>
  );
}
