import type { ConnectionInfo, ProviderInfo } from '@alpine/protocol';

import type { messages } from './messages';

type Words = (typeof messages)['ko'];

/**
 * How a saved connection is named on screen: 'Anthropic API 키', 'GLM Coding Plan', '로컬 서버 · localhost:11434',
 * '호환 서버 · llm.example.com'.
 */
export function connectionLabel(connection: ConnectionInfo, providers: ProviderInfo[], t: Words): string {
  if (connection.account) return t.chatgptConnection(connection.account.email);
  const provider = providers.find((p) => p.id === connection.provider);
  if (!provider) {
    const address = (connection.baseUrl ?? '').replace(/^https?:\/\//, '').replace(/\/v1\/?$/, '');
    return isLocal(connection.baseUrl) ? t.localConnection(address) : t.compatibleConnection(address);
  }
  return provider.billing === 'subscription' ? provider.name : t.apiKeyConnection(provider.name);
}

/** This computer or the local network: a server the user runs, not a hosted service. */
export function isLocal(baseUrl: string | null | undefined): boolean {
  let host: string;
  try {
    host = new URL(baseUrl ?? '').hostname.replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  return (
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.localhost') ||
    /^(127\.|10\.|192\.168\.|0\.0\.0\.0$)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}
