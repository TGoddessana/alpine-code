import type { ConnectionInfo, ConnectionsListResult, ProjectInfo, ProviderInfo } from '@alpine/protocol';

import { ServerError } from './connection';
import type { Script } from './scripted';

/** The providers the server ships, for scripts. */
export const PROVIDERS: ProviderInfo[] = [
  { id: 'anthropic', name: 'Anthropic', billing: 'usage', keyEnv: 'ANTHROPIC_API_KEY' },
  { id: 'openai', name: 'OpenAI', billing: 'usage', keyEnv: 'OPENAI_API_KEY' },
  { id: 'google', name: 'Google Gemini', billing: 'usage', keyEnv: 'GEMINI_API_KEY' },
  { id: 'openrouter', name: 'OpenRouter', billing: 'usage', keyEnv: 'OPENROUTER_API_KEY' },
  { id: 'zai-coding-plan', name: 'GLM Coding Plan', billing: 'subscription', keyEnv: 'ZAI_API_KEY' },
  { id: 'kimi-for-coding', name: 'Kimi For Coding', billing: 'subscription', keyEnv: 'KIMI_API_KEY' },
  { id: 'minimax-coding-plan', name: 'MiniMax Coding Plan', billing: 'subscription', keyEnv: 'MINIMAX_API_KEY' },
];

export const NOTHING_CONNECTED: ConnectionsListResult = { connections: [], defaultModel: null, providers: PROVIDERS };

export const CONNECTED: ConnectionsListResult = {
  connections: [
    { name: 'anthropic', provider: 'anthropic', baseUrl: null, billing: 'usage', hasKey: true },
    { name: 'zai-coding-plan', provider: 'zai-coding-plan', baseUrl: null, billing: 'subscription', hasKey: false },
    { name: 'local', provider: null, baseUrl: 'http://localhost:11434/v1', billing: 'none', hasKey: false },
  ],
  defaultModel: 'anthropic/claude-sonnet-5',
  providers: PROVIDERS,
};

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

export const PROJECTS: ProjectInfo[] = [
  { path: '/Users/me/alpine-code', name: 'alpine-code', branch: 'main', lastUsedAt: hoursAgo(0.2), hidden: false },
  { path: '/Users/me/docs-site', name: 'docs-site', branch: 'main', lastUsedAt: hoursAgo(2), hidden: false },
  { path: '/Users/me/infra-terraform', name: 'infra-terraform', branch: null, lastUsedAt: hoursAgo(26), hidden: false },
];

const MODELS: Record<string, string[]> = {
  anthropic: ['claude-sonnet-5', 'claude-opus-5-5', 'claude-haiku-4-5'],
  local: ['gpt-oss:20b', 'qwen3-coder:30b'],
};

interface ScriptState {
  connections: ConnectionsListResult;
  projects: ProjectInfo[];
}

/**
 * A server that remembers what the app does to it. Keys starting with `sk-` pass, others are rejected; local
 * addresses answer, others do not; clones of `owner/fails` fail.
 */
export function statefulScript(start: ScriptState): Script {
  let { connections, projects } = start;
  const project = (path: string): ProjectInfo => ({
    path,
    name: path.split('/').pop() ?? path,
    branch: 'main',
    lastUsedAt: new Date().toISOString(),
    hidden: false,
  });
  return {
    results: {
      initialize: { protocolVersion: 1, server: { name: 'scripted', version: 'browser' } },
      'connections/list': () => connections,
      'connections/models': ({ provider, baseUrl, apiKey }) => {
        if (baseUrl && !baseUrl.includes('localhost'))
          throw new ServerError(-32000, 'Connection error.', { reason: 'unreachable' });
        if (baseUrl) return { models: MODELS.local! };
        const saved = connections.connections.find((c) => c.provider === provider)?.hasKey;
        if (!apiKey?.startsWith('sk-') && !(apiKey === undefined && saved))
          throw new ServerError(-32000, 'invalid x-api-key', { reason: 'auth' });
        return { models: MODELS[provider ?? ''] ?? ['glm-5.2', 'glm-5.2-air'] };
      },
      'connections/add': ({ provider, baseUrl, apiKey, model, makeDefault }) => {
        const name = provider ?? 'local';
        const billing = PROVIDERS.find((p) => p.id === provider)?.billing ?? 'none';
        const connection: ConnectionInfo = {
          name,
          provider: provider ?? null,
          baseUrl: baseUrl ?? null,
          billing,
          hasKey: !!apiKey,
        };
        const others = connections.connections.filter((c) => c.name !== name);
        const defaultModel = makeDefault ? `${name}/${model}` : connections.defaultModel;
        connections = { ...connections, connections: [...others, connection], defaultModel };
        return { connection, defaultModel };
      },
      'connections/setDefault': ({ model }) => {
        connections = { ...connections, defaultModel: model };
        return { defaultModel: model };
      },
      'projects/list': () => ({ projects, cloneParent: '/Users/me' }),
      'projects/open': ({ path }) => {
        const opened = project(path);
        projects = [opened, ...projects.filter((p) => p.path !== path)];
        return { project: opened };
      },
      'projects/hide': ({ path }) => {
        projects = projects.map((p) => (p.path === path ? { ...p, hidden: true } : p));
        return {};
      },
      'projects/clone': ({ address, parent }) => {
        if (address.includes('fails'))
          throw new ServerError(-32000, "fatal: repository 'https://github.com/owner/fails.git/' not found", {
            reason: 'clone_failed',
          });
        const opened = project(
          `${parent}/${address
            .split('/')
            .pop()
            ?.replace(/\.git$/, '')}`,
        );
        projects = [opened, ...projects];
        return { project: opened };
      },
    },
  };
}

/** A first run: nothing connected, no projects. */
export const firstRunScript = () => statefulScript({ connections: NOTHING_CONNECTED, projects: [] });

/** Everything set up: three connections and three projects. */
export const setUpScript = () => statefulScript({ connections: CONNECTED, projects: PROJECTS });
