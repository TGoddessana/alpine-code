import type { ConnectionInfo, ProviderInfo } from '@alpine/protocol';

import type { messages } from './messages';

type Words = (typeof messages)['ko'];

/** How a saved connection is named on screen: 'Anthropic API 키', 'GLM Coding Plan', '로컬 서버 · localhost:11434'. */
export function connectionLabel(connection: ConnectionInfo, providers: ProviderInfo[], t: Words): string {
  const provider = providers.find((p) => p.id === connection.provider);
  if (!provider)
    return t.localConnection((connection.baseUrl ?? '').replace(/^https?:\/\//, '').replace(/\/v1\/?$/, ''));
  return provider.billing === 'subscription' ? provider.name : t.apiKeyConnection(provider.name);
}
