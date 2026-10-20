import type { ConnectionInfo, ConnectionsListResult } from '@alpine/protocol';
import { Button, Dialog, Menu, NativeSelect } from '@alpine/ui/primitives';
import {
  ArrowUpRight,
  ChevronRight,
  Ellipsis,
  Info,
  KeyRound,
  MessagesSquare,
  Plus,
  Server,
  Snowflake,
} from 'lucide-react';
import { useState, type KeyboardEvent, type ReactNode } from 'react';

import {
  ApiKeyForm,
  ChatGPTSignIn,
  connectionLabel,
  connectMessages,
  LocalServerForm,
} from '@/shared/components/connect';
import { AlpineSignIn } from '@/shared/components/cloud';
import { openInBrowser } from '@/shared/platform';
import { useMessages } from '@/shared/i18n';
import {
  CHATGPT_USAGE_URL,
  useChatGPTSignOut,
  useCloudEnabled,
  useCloudSignOut,
  useCloudStatus,
  useConnections,
  useModelsOf,
  useRemoveConnection,
  useSetDefaultModel,
  useSetReviewModel,
  useSettings,
  shownModels,
} from '@/shared/server';

import { messages } from './messages';
import { ModelsDialog } from './ModelsDialog';

type Sheet =
  | { kind: 'add' }
  | { kind: 'api-key'; provider?: string }
  | { kind: 'local'; address?: string }
  | { kind: 'chatgpt'; connection?: string; consent?: boolean }
  | { kind: 'alpine' }
  | null;

const fieldRow = 'grid items-center gap-3 py-5 sm:grid-cols-2 sm:gap-6 not-first:border-t not-first:border-line-subtle';

/** A short provider name; addresses and account details are displayed separately. */
function providerName(connection: ConnectionInfo, data: ConnectionsListResult) {
  if (connection.account) return 'ChatGPT';
  const provider = data.providers.find((item) => item.id === connection.provider);
  if (provider) return provider.name;
  try {
    return new URL(connection.baseUrl ?? '').hostname;
  } catch {
    return connection.name;
  }
}

/** Connected providers, the method chooser, and defaults for new chats. */
export function ConnectionTab() {
  const t = useMessages(messages);
  const c = useMessages(connectMessages);
  const connections = useConnections();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [removing, setRemoving] = useState<ConnectionInfo | null>(null);
  const [choosing, setChoosing] = useState<ConnectionInfo | null>(null);
  const cloud = useCloudEnabled();
  const alpine = useCloudStatus(cloud).data;
  const data = connections.data;
  if (!data) return null;

  return (
    <div className="mx-auto flex w-full max-w-240 flex-col gap-8 pb-8">
      <section aria-label={t.connected} className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-title font-semibold">{t.connected}</h2>
            <p className="mt-1 text-body text-fg-muted">{t.connectionsLead}</p>
          </div>
          <Button variant="primary" onClick={() => setSheet({ kind: 'add' })}>
            <Plus size={16} aria-hidden="true" />
            {t.addConnection}
          </Button>
        </div>
        <div className="rounded-xl border border-line-subtle bg-canvas-raised">
          {data.connections.length === 0 ? (
            <p className="px-5 py-8 text-center text-body text-fg-muted">{t.noConnections}</p>
          ) : (
            data.connections.map((connection) => {
              const name = providerName(connection, data);
              const Icon = connection.account ? MessagesSquare : connection.provider ? KeyRound : Server;
              return (
                <div
                  key={connection.name}
                  className="flex flex-wrap items-center gap-3 p-5 not-first:border-t not-first:border-line-subtle"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line-subtle bg-canvas">
                    <Icon size={18} aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-body font-semibold wrap-anywhere">{name}</h3>
                    {(connection.account?.email ??
                      (connection.provider === 'alpine' ? alpine?.account?.email : null)) && (
                      <p className="text-meta text-fg-muted wrap-anywhere">
                        {connection.account?.email ?? alpine?.account?.email}
                      </p>
                    )}
                    <Status connection={connection} data={data} />
                  </div>
                  <div className="ml-auto flex w-full max-w-full items-center gap-2 pl-13 sm:w-auto sm:pl-0">
                    {connection.account ? (
                      <ChatGPTActions
                        connection={connection}
                        onSignIn={(consent) => setSheet({ kind: 'chatgpt', connection: connection.name, consent })}
                      />
                    ) : connection.provider === 'alpine' ? (
                      <>
                        <Button onClick={() => setChoosing(connection)}>{t.chooseModels}</Button>
                        <AlpineActions label={t.connectionActions(name)} />
                      </>
                    ) : (
                      <>
                        <Button onClick={() => setChoosing(connection)}>{t.chooseModels}</Button>
                        <ActionsMenu label={t.connectionActions(name)}>
                          <Menu.Item
                            onClick={() =>
                              setSheet(
                                connection.provider
                                  ? { kind: 'api-key', provider: connection.provider }
                                  : { kind: 'local', address: connection.baseUrl ?? undefined },
                              )
                            }
                          >
                            {t.change}
                          </Menu.Item>
                          <Menu.Separator />
                          <Menu.Item className="text-danger" onClick={() => setRemoving(connection)}>
                            {t.remove}
                          </Menu.Item>
                        </ActionsMenu>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {data.connections.length > 0 && (
        <section aria-label={t.defaultModel}>
          <h2 className="text-title font-semibold">{t.defaultModel}</h2>
          <p className="mt-1 text-body text-fg-muted">{t.defaultModelLead}</p>
          <div className="mt-5 rounded-xl border border-line-subtle bg-canvas-raised px-5">
            <div className={fieldRow}>
              <label htmlFor="settings-default-model" className="text-body font-medium">
                {t.newSession}
              </label>
              <DefaultModel id="settings-default-model" data={data} />
            </div>
            <div className={fieldRow}>
              <div>
                <label htmlFor="settings-review-model" className="text-body font-medium">
                  {t.reviewModel}
                </label>
                <p className="mt-1 text-meta text-fg-muted">{t.reviewModelLead}</p>
              </div>
              <ReviewModel id="settings-review-model" data={data} />
            </div>
          </div>
          <p className="mt-3 flex items-center gap-2 text-meta text-fg-muted">
            <Info size={14} aria-hidden="true" />
            {t.appliesToNewSessions}
          </p>
        </section>
      )}

      <Dialog.Root open={sheet !== null} onOpenChange={(open) => !open && setSheet(null)}>
        <Dialog.Popup>
          {sheet?.kind === 'add' && (
            <>
              <div className="flex flex-col gap-2">
                <Dialog.Title>{t.addConnection}</Dialog.Title>
                <Dialog.Description>{t.addConnectionLead}</Dialog.Description>
              </div>
              <div className="flex flex-col gap-3">
                {cloud && !alpine?.signedIn && (
                  <AddMethod
                    icon={<Snowflake size={18} />}
                    label={t.alpineStart}
                    note={t.alpineStartNote}
                    onClick={() => setSheet({ kind: 'alpine' })}
                  />
                )}
                <AddMethod
                  icon={<MessagesSquare size={18} />}
                  label={c.chatgpt}
                  note={c.chatgptNote}
                  onClick={() => setSheet({ kind: 'chatgpt' })}
                />
                <AddMethod
                  icon={<KeyRound size={18} />}
                  label={c.apiKey}
                  note={c.apiKeyNote}
                  onClick={() => setSheet({ kind: 'api-key' })}
                />
                <AddMethod
                  icon={<Server size={18} />}
                  label={c.local}
                  note={c.localNote}
                  onClick={() => setSheet({ kind: 'local' })}
                />
              </div>
              <div className="flex justify-end">
                <Dialog.Close render={<Button />}>{t.cancel}</Dialog.Close>
              </div>
            </>
          )}
          {sheet?.kind === 'api-key' && (
            <>
              <ApiKeyForm
                onBack={() => setSheet({ kind: 'add' })}
                providers={data.providers}
                initialProvider={sheet.provider}
                makeDefault={data.defaultModel === null}
                onDone={() => setSheet(null)}
              />
            </>
          )}
          {sheet?.kind === 'chatgpt' && (
            <ChatGPTSignIn
              onBack={() => setSheet({ kind: 'add' })}
              connection={sheet.connection}
              consent={sheet.consent}
              makeDefault={data.defaultModel === null}
              onApiKey={() => setSheet({ kind: 'api-key' })}
              onDone={() => setSheet(null)}
            />
          )}
          {sheet?.kind === 'alpine' && (
            <AlpineSignIn onBack={() => setSheet({ kind: 'add' })} onDone={() => setSheet(null)} />
          )}
          {sheet?.kind === 'local' && (
            <LocalServerForm
              onBack={() => setSheet({ kind: 'add' })}
              initialAddress={sheet.address}
              makeDefault={data.defaultModel === null}
              onDone={() => setSheet(null)}
            />
          )}
        </Dialog.Popup>
      </Dialog.Root>

      <RemoveDialog connection={removing} data={data} onClose={() => setRemoving(null)} />
      <ModelsDialog connection={choosing} data={data} onClose={() => setChoosing(null)} />
    </div>
  );
}

/**
 * What deleting a connection removes, before it is gone. Like deleting a project, Enter never confirms: focus starts
 * on Cancel, and only a click or ⌘Enter deletes.
 */
function RemoveDialog({
  connection,
  data,
  onClose,
}: {
  connection: ConnectionInfo | null;
  data: ConnectionsListResult;
  onClose: () => void;
}) {
  const t = useMessages(messages);
  const c = useMessages(connectMessages);
  const remove = useRemoveConnection();
  const close = () => {
    remove.reset();
    onClose();
  };
  const confirm = () => {
    if (connection) remove.mutate(connection.name, { onSuccess: close });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && event.metaKey) {
      event.preventDefault();
      confirm();
    }
  };
  const defaultOnIt = connection && data.defaultModel?.startsWith(`${connection.name}/`) ? data.defaultModel : null;

  return (
    <Dialog.Root open={connection !== null} onOpenChange={(open) => !open && close()}>
      <Dialog.Popup size="sm" role="alertdialog" onKeyDown={onKeyDown}>
        {connection && (
          <>
            <div className="flex flex-col gap-2">
              <Dialog.Title>{t.removeTitle(connectionLabel(connection, data.providers, c))}</Dialog.Title>
              <Dialog.Description>{t.removeLead}</Dialog.Description>
              {defaultOnIt && (
                <p className="text-body">{t.removeDefault(defaultOnIt.slice(defaultOnIt.indexOf('/') + 1))}</p>
              )}
            </div>
            {remove.error && (
              <p role="alert" className="text-meta text-danger">
                {remove.error.message}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 pt-2">
              <Dialog.Close render={<Button />}>{t.cancel}</Dialog.Close>
              <Button variant="danger" disabled={remove.isPending} onClick={confirm}>
                {t.confirmRemove}
                <kbd className="rounded-sm border border-on-fill/50 px-1 font-sans text-meta">⌘↩</kbd>
              </Button>
            </div>
          </>
        )}
      </Dialog.Popup>
    </Dialog.Root>
  );
}

function ActionsMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={label}
        className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted hover:bg-hover"
      >
        <Ellipsis size={18} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Popup align="end">{children}</Menu.Popup>
    </Menu.Root>
  );
}

function AddMethod({
  icon,
  label,
  note,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  note: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-line-subtle p-4 text-left hover:bg-canvas-sunken"
    >
      <span aria-hidden="true" className="shrink-0 text-fg-muted">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium">{label}</span>
        <span className="mt-1 block text-meta text-fg-muted">{note}</span>
      </span>
      <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-fg-muted" />
    </button>
  );
}

/** How it is paid for, or what is missing. Limits and spend come with usage tracking. */
function Status({ connection, data }: { connection: ConnectionInfo; data: ConnectionsListResult }) {
  const c = useMessages(connectMessages);
  if (connection.account) {
    const { signedIn, planUsage } = connection.account;
    if (signedIn && planUsage) return null;
    const text = !signedIn ? c.chatgptSignedOut : c.chatgptPlanOff;
    return <span className={signedIn ? 'text-meta text-fg-muted' : 'text-meta text-danger'}>{text}</span>;
  }
  const provider = data.providers.find((p) => p.id === connection.provider);
  if (provider?.id === 'alpine')
    return (
      <span className={connection.hasKey ? 'text-meta text-fg-muted' : 'text-meta text-danger'}>
        {connection.hasKey ? c.alpineCredits : c.alpineSignedOut}
      </span>
    );
  if (provider && !connection.hasKey) return <span className="text-meta text-danger">{c.noKey(provider.keyEnv)}</span>;
  if (!provider)
    return (
      <span className="text-meta text-fg-muted wrap-anywhere">{connection.baseUrl?.replace(/^https?:\/\//, '')}</span>
    );
  return (
    <span className="text-meta text-fg-muted">{provider.billing === 'subscription' ? c.subscription : c.usage}</span>
  );
}

/** Every model of every connection, grouped by connection. The current default stays listed even if unreachable. */
function DefaultModel({ id, data }: { id: string; data: ConnectionsListResult }) {
  const t = useMessages(messages);
  const setDefault = useSetDefaultModel();
  return (
    <ModelSelect
      id={id}
      data={data}
      value={data.defaultModel}
      empty={data.defaultModel === null ? t.chooseModel : null}
      onChange={(model) => model && setDefault.mutate(model)}
    />
  );
}

/** The model auto mode's reviewer uses; first comes "the session's own model", which is the default. */
function ReviewModel({ id, data }: { id: string; data: ConnectionsListResult }) {
  const t = useMessages(messages);
  const settings = useSettings();
  const setReviewModel = useSetReviewModel();
  if (!settings.data) return null;
  const value = setReviewModel.isPending ? setReviewModel.variables : settings.data.reviewModel;
  return (
    <ModelSelect
      id={id}
      data={data}
      value={value ?? null}
      empty={t.sameAsSession}
      onChange={(model) => setReviewModel.mutate(model)}
    />
  );
}

/** Every model of every connection, grouped by connection, after an `empty` choice if given. `value` stays listed
 * even when its connection cannot list it. */
function ModelSelect({
  id,
  data,
  value,
  empty,
  onChange,
}: {
  id: string;
  data: ConnectionsListResult;
  value: string | null;
  empty: string | null;
  onChange: (model: string | null) => void;
}) {
  const c = useMessages(connectMessages);
  const lists = useModelsOf(data.connections.map((connection) => ({ connection: connection.name })));
  const keep = (connection: string) =>
    value?.startsWith(`${connection}/`) ? value.slice(connection.length + 1) : null;
  const shown = data.connections.map((connection, i) => shownModels(lists[i]?.data, [keep(connection.name)]));
  const listed = new Set(data.connections.flatMap((connection, i) => shown[i]!.map((m) => `${connection.name}/${m}`)));
  const fallbackConnection = data.connections.find((connection) => value?.startsWith(`${connection.name}/`));
  const fallbackLabel = fallbackConnection
    ? `${providerName(fallbackConnection, data)} · ${value?.slice(fallbackConnection.name.length + 1)}`
    : value;
  return (
    <NativeSelect id={id} value={value ?? ''} onChange={(event) => onChange(event.target.value || null)}>
      {empty !== null && <option value="">{empty}</option>}
      {value !== null && !listed.has(value) && <option value={value}>{fallbackLabel}</option>}
      {data.connections.map((connection, i) => (
        <optgroup key={connection.name} label={connectionLabel(connection, data.providers, c)}>
          {shown[i]!.map((model) => (
            <option key={model} value={`${connection.name}/${model}`}>
              {providerName(connection, data)} · {model}
            </option>
          ))}
        </optgroup>
      ))}
    </NativeSelect>
  );
}

/** The Alpine connection's one action: signing out of the account that pays for it. */
function AlpineActions({ label }: { label: string }) {
  const c = useMessages(connectMessages);
  const signOut = useCloudSignOut();
  return (
    <ActionsMenu label={label}>
      <Menu.Item disabled={signOut.isPending} onClick={() => signOut.mutate()}>
        {c.signOut}
      </Menu.Item>
    </ActionsMenu>
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
  const t = useMessages(messages);
  const account = connection.account!;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {signOut.data?.revoked === false && !account.signedIn && (
        <span className="text-meta text-fg-muted" role="status">
          {c.signOutUnconfirmed}
        </span>
      )}
      {!account.signedIn ? (
        <Button onClick={() => onSignIn(false)}>{c.signInAgain}</Button>
      ) : !account.planUsage ? (
        <Button onClick={() => onSignIn(true)}>{c.allowAgain}</Button>
      ) : (
        <Button onClick={() => void openInBrowser(CHATGPT_USAGE_URL)}>
          {t.viewUsage}
          <ArrowUpRight size={14} aria-hidden="true" />
        </Button>
      )}
      {account.signedIn && (
        <ActionsMenu label={t.connectionActions('ChatGPT')}>
          <Menu.Item disabled={signOut.isPending} onClick={() => signOut.mutate(connection.name)}>
            {c.signOut}
          </Menu.Item>
        </ActionsMenu>
      )}
      {signOut.error && (
        <p className="w-full text-meta text-danger" role="alert">
          {signOut.error.message}
        </p>
      )}
    </div>
  );
}
