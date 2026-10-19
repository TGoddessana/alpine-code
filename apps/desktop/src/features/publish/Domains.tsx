import type { AppInfo, Domain } from '@alpine/protocol';
import { Button, Input, LinkButton } from '@alpine/ui/primitives';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';

import { useMessages } from '@/shared/i18n';
import { openInBrowser } from '@/shared/platform';
import {
  ServerError,
  useAddDomain,
  useCheckDomain,
  useCloudStatus,
  useDomains,
  useRemoveDomain,
  useSendMessage,
  useSetBadge,
} from '@/shared/server';

import { messages } from './messages';
import { Mark } from './parts';

export interface DomainsProps {
  cwd: string;
  /** The project's app; without one (never published) there is nothing to attach a domain to. */
  app: AppInfo | null | undefined;
  /** The project's session, where the records go when the person wants the AI's help. */
  sessionId?: string | null;
  onBack: () => void;
  /** Pro would open this up; the sheet shows the plans. */
  onUpgrade: () => void;
  /** After the AI was sent a message. */
  onClose: () => void;
}

const reasonOf = (error: unknown) => (error instanceof ServerError ? error.data?.reason : undefined);

/**
 * The custom domain and the badge (decisions 20, 21 in docs/alpine-cloud.md). A domain is added by name; the sheet
 * lists the DNS records with what each one is for in plain words, offers a one-click connect when the registrar
 * supports Domain Connect and otherwise the AI's help, and checks again by itself while it waits. The badge is Pro's
 * to turn off. What a plan allows comes from `cloud/status` limits, so a free account sees the way to Pro instead.
 */
export function Domains({ cwd, app, sessionId, onBack, onUpgrade, onClose }: DomainsProps) {
  const t = useMessages(messages);
  const limits = useCloudStatus().data?.limits;
  const open = limits?.customDomains === true;
  const domains = useDomains(cwd, open && !!app);
  const setBadge = useSetBadge(cwd);
  return (
    <>
      <div className="flex flex-col gap-1">
        <LinkButton className="-ml-1 self-start" onClick={onBack}>
          <ArrowLeft aria-hidden="true" size={14} strokeWidth={1.75} className="mr-1" />
          {t.domainsBack}
        </LinkButton>
        <h2 className="text-title">{t.domainsTitle}</h2>
      </div>
      <section className="flex flex-col gap-3 border-t border-line-subtle pt-3">
        <h3 className="text-meta font-semibold text-fg-muted">{t.domainsSection}</h3>
        {!open ? (
          <p className="flex items-baseline justify-between gap-3 text-body text-fg-muted">
            {t.domainsProOnly}
            <LinkButton onClick={onUpgrade}>{t.seePro}</LinkButton>
          </p>
        ) : !app ? (
          <p className="text-body text-fg-muted">{t.domainsNeedApp}</p>
        ) : (
          <>
            <p className="text-body text-fg-muted">{t.domainsLead}</p>
            {domains.data?.domains.map((domain) => (
              <DomainCard key={domain.id} cwd={cwd} domain={domain} sessionId={sessionId} onClose={onClose} />
            ))}
            {domains.isSuccess && domains.data.domains.length === 0 && (
              <p className="text-body text-fg-muted">{t.domainNone}</p>
            )}
            <AddDomain cwd={cwd} />
          </>
        )}
      </section>
      <section className="flex flex-col gap-2 border-t border-line-subtle pt-3">
        <h3 className="text-meta font-semibold text-fg-muted">{t.badgeSection}</h3>
        <label className="inline-flex items-center gap-2 text-body text-fg">
          <input
            type="checkbox"
            checked={app?.badge ?? true}
            // The badge is on for free; Pro can turn it off (limits.badge is whether the plan puts it on).
            disabled={!app || limits?.badge !== false || setBadge.isPending}
            onChange={(event) => setBadge.mutate(event.target.checked)}
            className="size-3.5 cursor-pointer accent-interactive disabled:cursor-default"
          />
          {t.badgeLabel}
        </label>
        {limits?.badge !== false && (
          <p className="flex items-baseline justify-between gap-3 text-meta text-fg-muted">
            {t.badgeFree}
            <LinkButton onClick={onUpgrade}>{t.seePro}</LinkButton>
          </p>
        )}
        {setBadge.isError && (
          <p role="alert" className="text-meta text-danger">
            {t.badgeFailed}
          </p>
        )}
      </section>
    </>
  );
}

function AddDomain({ cwd }: { cwd: string }) {
  const t = useMessages(messages);
  const add = useAddDomain(cwd);
  const [name, setName] = useState('');
  const [mail, setMail] = useState(false);
  const reason = reasonOf(add.error);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() && !add.isPending) add.mutate({ domain: name.trim(), mail }, { onSuccess: () => setName('') });
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-meta text-fg-muted">{t.domainInput}</span>
        <div className="flex gap-2">
          <Input
            autoComplete="off"
            spellCheck={false}
            placeholder={t.domainPlaceholder}
            value={name}
            onChange={(event) => (add.reset(), setName(event.target.value))}
          />
          <Button type="submit" disabled={!name.trim() || add.isPending}>
            {t.domainAdd}
          </Button>
        </div>
      </label>
      <label className="inline-flex items-center gap-2 text-meta text-fg">
        <input
          type="checkbox"
          checked={mail}
          onChange={(event) => setMail(event.target.checked)}
          className="size-3.5 cursor-pointer accent-interactive"
        />
        {t.domainMail}
      </label>
      {add.isError && (
        <p role="alert" className="motion-step text-meta text-danger">
          {reason === 'invalid' ? t.domainInvalid : reason === 'name_taken' ? t.domainTaken : t.domainFailed}
        </p>
      )}
    </form>
  );
}

function DomainCard({
  cwd,
  domain,
  sessionId,
  onClose,
}: {
  cwd: string;
  domain: Domain;
  sessionId?: string | null;
  onClose: () => void;
}) {
  const t = useMessages(messages);
  const check = useCheckDomain(cwd);
  const remove = useRemoveDomain(cwd);
  const send = useSendMessage();
  const [asking, setAsking] = useState(false);
  const records = domain.records ?? [];
  const waiting = domain.status !== 'active';
  const lines = records.map((record) => `${record.type}  ${record.name}  ${record.value}`).join('\n');
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate font-mono text-body text-fg">{domain.name}</p>
        <span role="status" className="shrink-0 text-meta text-fg-muted">
          {t.domainStatus(domain.status)}
        </span>
      </div>
      {waiting && records.length > 0 && (
        <>
          <p className="text-meta text-fg-muted">{t.domainRecordsLead}</p>
          <ul className="flex flex-col gap-2">
            {records.map((record) => (
              <li key={`${record.type}-${record.name}`} className="flex gap-2">
                <Mark state={record.ok ? 'ok' : 'running'} />
                <div className="flex min-w-0 grow flex-col gap-0.5">
                  <p className="text-body text-fg">{t.recordPurpose(record.purpose)}</p>
                  <p className="font-mono text-meta break-all text-fg-muted">
                    {record.type} · {record.name}
                  </p>
                  <p className="font-mono text-meta break-all text-fg-muted">{record.value}</p>
                </div>
                <LinkButton
                  className="shrink-0 self-start"
                  onClick={() => void navigator.clipboard?.writeText(record.value)}
                >
                  {t.recordCopy}
                </LinkButton>
              </li>
            ))}
          </ul>
        </>
      )}
      {waiting && (
        <div className="flex flex-wrap items-center gap-3">
          {domain.domainConnect ? (
            <Button variant="primary" onClick={() => void openInBrowser(domain.domainConnect!.url)}>
              {t.domainConnect(domain.domainConnect.provider)}
            </Button>
          ) : (
            sessionId && (
              <Button
                disabled={send.isPending}
                onClick={() =>
                  send.mutate({ sessionId, text: t.domainAskMessage(domain.name, lines) }, { onSuccess: onClose })
                }
              >
                {t.domainAskAi}
              </Button>
            )
          )}
          <LinkButton disabled={check.isPending} onClick={() => check.mutate(domain.id)}>
            {check.isPending ? t.domainChecking : t.domainCheck}
          </LinkButton>
        </div>
      )}
      {check.isSuccess && check.data.domain.status === 'pending' && (
        <p role="status" className="text-meta text-fg-muted">
          {t.domainStillWaiting}
        </p>
      )}
      {asking ? (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-meta text-fg">
            {t.domainRemoveAsk}
          </p>
          <div className="flex gap-2">
            <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(domain.id)}>
              {t.domainRemoveYes}
            </Button>
            <Button onClick={() => setAsking(false)}>{t.domainRemoveNo}</Button>
          </div>
        </div>
      ) : (
        <div>
          <LinkButton className="-ml-1" onClick={() => setAsking(true)}>
            {t.domainRemove}
          </LinkButton>
        </div>
      )}
    </div>
  );
}
