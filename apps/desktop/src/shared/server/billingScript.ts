import type { Domain, DomainRecord } from '@alpine/protocol';

import { ServerError } from './connection';
import { APP } from './publishScript';
import type { Script, ScriptContext } from './scripted';

export interface BillingScriptOptions {
  /** Starts with this domain already added: still waiting for DNS (`pending`) or `active`. Default: none. */
  domain?: 'pending' | 'active';
  /** The domain's registrar can be connected in one click (Domain Connect); otherwise the person is shown records. */
  domainConnect?: boolean;
  /** Checking a pending domain finds the records (it turns active); default: it keeps waiting. */
  dnsReady?: boolean;
  /** Milliseconds until the payment "is paid" after `cloud/checkout`; default 1500. `null`: never (the person is still paying). */
  checkoutMs?: number | null;
}

interface Env {
  /** Pro or its trial: custom domains and hiding the badge are open. */
  pro: () => boolean;
  /** The plan changed by paying; announces `cloud/changed`. */
  paid: (context: ScriptContext) => void;
  /** Whether the badge shows on the app; it is also what `publish/status` says. */
  badge: { get: () => boolean; set: (shown: boolean) => void };
}

const RECORDS = (name: string, mail: boolean): DomainRecord[] => [
  { type: 'CNAME', name, value: 'cname.alpinesite.app', purpose: 'web', ok: false },
  ...(mail
    ? [
        { type: 'TXT', name, value: 'v=spf1 include:amazonses.com ~all', purpose: 'spf', ok: false },
        {
          type: 'TXT',
          name: `resend._domainkey.${name}`,
          value: 'p=MIGfMA0GCSqGSIb3DQEBAQUAA4GN',
          purpose: 'dkim',
          ok: false,
        },
        { type: 'TXT', name: `_dmarc.${name}`, value: 'v=DMARC1; p=none', purpose: 'dmarc', ok: false },
      ]
    : []),
];

/**
 * Pro in a story or a test (docs/alpine-cloud-api.md 4.10 to 4.12): the payment page that "pays" by itself, custom
 * domains with their DNS records, and the badge. Merged into `cloudScript`, which owns the plan.
 */
export function billingResults(options: BillingScriptOptions, env: Env): NonNullable<Script['results']> {
  let counter = 0;
  const domains: Domain[] = [];
  const records = new Map<string, DomainRecord[]>();
  const add = (name: string, mail: boolean, status: 'pending' | 'active') => {
    const id = `dom_${++counter}`;
    const list = RECORDS(name, mail).map((record) => ({ ...record, ok: status === 'active' }));
    records.set(id, list);
    domains.push({
      id,
      name,
      status,
      records: list,
      domainConnect: options.domainConnect
        ? { provider: 'Cloudflare', url: `https://dash.cloudflare.com/domain-connect?domain=${name}` }
        : null,
    });
    return domains.at(-1)!;
  };
  if (options.domain) add('booking.example.com', true, options.domain);

  const needPro = () => {
    if (!env.pro()) throw new ServerError(-32000, 'This needs Pro.', { reason: 'payment_required' });
  };
  const find = (id: string) => {
    const found = domains.find((domain) => domain.id === id);
    if (!found) throw new ServerError(-32000, 'No such domain.', { reason: 'not_found' });
    return found;
  };

  return {
    'cloud/checkout': (_params, context) => {
      const ms = options.checkoutMs === undefined ? 1500 : options.checkoutMs;
      if (ms !== null) setTimeout(() => env.paid(context), ms);
      return { url: 'http://127.0.0.1:8787/v1/billing/fake/checkout' };
    },
    'publish/domains': () => ({ domains: [...domains] }),
    'publish/addDomain': ({ domain, mail }) => {
      needPro();
      const name = domain.trim().toLowerCase();
      if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(name))
        throw new ServerError(-32000, 'That is not a domain name.', { reason: 'invalid' });
      if (domains.some((existing) => existing.name === name))
        throw new ServerError(-32000, 'Already added.', { reason: 'name_taken' });
      return { domain: add(name, mail ?? false, 'pending') };
    },
    'publish/checkDomain': ({ id }) => {
      const found = find(id);
      if (options.dnsReady && found.status === 'pending') {
        found.status = 'active';
        found.records = (found.records ?? []).map((record) => ({ ...record, ok: true }));
      }
      return { domain: { ...found } };
    },
    'publish/removeDomain': ({ id }) => {
      domains.splice(domains.indexOf(find(id)), 1);
      return {};
    },
    'publish/setBadge': ({ badge: next }) => {
      if (!next) needPro();
      env.badge.set(next);
      return { app: { ...APP, badge: next } };
    },
  };
}
