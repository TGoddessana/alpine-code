import type { ConnectionInfo, ConnectionsListResult, ProjectInfo, ProviderInfo } from '@alpine/protocol';

import { ServerError } from './connection';
import { memoryScript } from './memoryScript';
import { mergeScripts, type Script } from './scripted';
import { sessionInfo, sessionScript, type SessionScriptOptions } from './sessionScript';
import { toolsScript } from './toolsScript';

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

/** A signed-in ChatGPT account, as the server reports it. */
export const CHATGPT_CONNECTION: ConnectionInfo = {
  name: 'chatgpt',
  provider: 'chatgpt',
  baseUrl: 'https://api.openai.com/v1',
  billing: 'subscription',
  hasKey: true,
  account: { email: 'you@example.com', signedIn: true, planUsage: true },
};

export const NOTHING_CONNECTED: ConnectionsListResult = { connections: [], defaultModel: null, providers: PROVIDERS };

export const CONNECTED: ConnectionsListResult = {
  connections: [
    { name: 'anthropic', provider: 'anthropic', baseUrl: null, billing: 'usage', hasKey: true },
    { name: 'zai-coding-plan', provider: 'zai-coding-plan', baseUrl: null, billing: 'subscription', hasKey: false },
    { name: 'local', provider: null, baseUrl: 'http://localhost:11434/v1', billing: 'none', hasKey: false },
    CHATGPT_CONNECTION,
  ],
  defaultModel: 'anthropic/claude-sonnet-5',
  providers: PROVIDERS,
};

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

export const PROJECTS: ProjectInfo[] = [
  { path: '/Users/me/alpine-code', name: 'alpine-code', branch: 'main', lastUsedAt: hoursAgo(0.2), archived: false },
  { path: '/Users/me/docs-site', name: 'docs-site', branch: 'main', lastUsedAt: hoursAgo(2), archived: false },
  {
    path: '/Users/me/infra-terraform',
    name: 'infra-terraform',
    branch: null,
    lastUsedAt: hoursAgo(26),
    archived: false,
  },
];

const MODELS: Record<string, string[]> = {
  anthropic: ['claude-sonnet-5', 'claude-opus-5-5', 'claude-haiku-4-5'],
  local: ['gpt-oss:20b', 'qwen3-coder:30b'],
  chatgpt: ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5'],
};

/** What a model router answers: hundreds of models. */
const ROUTER_MODELS = ['anthropic', 'amazon', 'google', 'meta-llama', 'mistralai', 'openai', 'qwen', 'x-ai'].flatMap(
  (vendor) => Array.from({ length: 40 }, (_, i) => `${vendor}/model-${i + 1}`),
);

/** Everything set up, plus a router with hundreds of models, for the model picker. */
export const withRouterScript = () =>
  statefulScript({
    connections: {
      ...CONNECTED,
      connections: [
        ...CONNECTED.connections,
        { name: 'router', provider: null, baseUrl: 'https://llm.router.example/v1', billing: 'none', hasKey: true },
      ],
    },
    projects: PROJECTS,
  });

interface ScriptState {
  connections: ConnectionsListResult;
  projects: ProjectInfo[];
  /** How a ChatGPT sign-in ends, a moment after it starts: signed in (the default), or with plan usage declined. */
  chatgpt?: 'connected' | 'declined';
}

/**
 * A server that remembers what the app does to it. Keys starting with `sk-` pass, others are rejected; local
 * addresses answer, others do not; clones of `owner/fails` fail.
 */
export function statefulScript(start: ScriptState): Script {
  let { connections, projects } = start;
  const signIns = new Map<string, ReturnType<typeof setTimeout>>();
  /** Models shown or hidden by hand, by connection: `connections/showModel`. */
  const chosen = new Map<string, Map<string, boolean>>();
  /** A router shows each vendor's newest by default, as the server does with the models.dev catalog. */
  const hiddenOf = (name: string, models: string[]) =>
    models.filter((model) => {
      const byHand = chosen.get(name)?.get(model);
      return byHand === undefined ? !model.endsWith('/model-40') : !byHand;
    });
  const project = (path: string): ProjectInfo => ({
    path,
    name: path.split('/').pop() ?? path,
    branch: 'main',
    lastUsedAt: new Date().toISOString(),
    archived: false,
  });
  return {
    results: {
      initialize: { protocolVersion: 1, server: { name: 'scripted', version: 'browser' } },
      'connections/list': () => connections,
      'connections/models': ({ connection: name, provider: askedProvider, baseUrl, apiKey }) => {
        const saved = name ? connections.connections.find((c) => c.name === name) : undefined;
        if (saved?.account) return { models: MODELS.chatgpt! };
        if (saved && !saved.provider)
          return saved.baseUrl?.includes('router')
            ? { models: ROUTER_MODELS, hidden: hiddenOf(saved.name, ROUTER_MODELS) }
            : { models: MODELS.local! };
        const provider = saved?.provider ?? askedProvider;
        if (baseUrl && !baseUrl.includes('localhost'))
          throw new ServerError(-32000, 'Connection error.', { reason: 'unreachable' });
        if (baseUrl) return { models: MODELS.local! };
        const hasKey = connections.connections.find((c) => c.provider === provider)?.hasKey;
        if (!apiKey?.startsWith('sk-') && !(apiKey === undefined && hasKey))
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
      'chatgpt/signIn': ({ connection: again, consent }, context) => {
        const attemptId = `attempt-${signIns.size + 1}`;
        const planUsage = consent || start.chatgpt !== 'declined';
        const timer = setTimeout(() => {
          signIns.delete(attemptId);
          const name = again ?? 'chatgpt';
          const connection: ConnectionInfo = {
            ...CHATGPT_CONNECTION,
            name,
            hasKey: planUsage,
            account: { email: 'you@example.com', signedIn: true, planUsage },
          };
          connections = {
            ...connections,
            connections: [...connections.connections.filter((c) => c.name !== name), connection],
          };
          context.emit({
            method: 'chatgpt/signInFinished',
            params: { attemptId, result: 'connected', connection, message: null },
          });
        }, 1500);
        signIns.set(attemptId, timer);
        return { attemptId, url: 'https://auth.openai.com/api/accounts/authorize?client_id=dynamic_agent_client' };
      },
      'chatgpt/cancelSignIn': ({ attemptId }, context) => {
        clearTimeout(signIns.get(attemptId));
        signIns.delete(attemptId);
        context.emit({ method: 'chatgpt/signInFinished', params: { attemptId, result: 'cancelled' } });
        return {};
      },
      'chatgpt/signOut': ({ connection: name }) => {
        connections = {
          ...connections,
          connections: connections.connections.map((c) =>
            c.name === name && c.account ? { ...c, hasKey: false, account: { ...c.account, signedIn: false } } : c,
          ),
        };
        return { revoked: true };
      },
      'connections/remove': ({ connection: name }) => {
        const defaultModel = connections.defaultModel?.startsWith(`${name}/`) ? null : connections.defaultModel;
        connections = {
          ...connections,
          connections: connections.connections.filter((c) => c.name !== name),
          defaultModel,
        };
        return { defaultModel };
      },
      'connections/showModel': ({ connection: name, model, shown }) => {
        chosen.set(name, new Map(chosen.get(name)).set(model, shown));
        return {};
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
      'projects/archive': ({ path }) => {
        projects = projects.map((p) => (p.path === path ? { ...p, archived: true } : p));
        return {};
      },
      'projects/git': ({ path }) => ({
        git: path.endsWith('infra-terraform')
          ? null
          : {
              branch: 'main',
              added: path.endsWith('alpine-code') ? 188 : 0,
              deleted: path.endsWith('alpine-code') ? 42 : 0,
              pullRequest: path.endsWith('alpine-code')
                ? { number: 214, url: 'https://github.com/owner/alpine-code/pull/214', checks: 'pending' }
                : null,
            },
      }),
      'projects/delete': ({ path }) => {
        projects = projects.filter((p) => p.path !== path);
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
export const firstRunScript = (chatgpt: ScriptState['chatgpt'] = 'connected') =>
  statefulScript({ connections: NOTHING_CONNECTED, projects: [], chatgpt });

/** Everything set up: three connections and three projects. */
export const setUpScript = () =>
  mergeScripts(statefulScript({ connections: CONNECTED, projects: PROJECTS }), toolsScript(), memoryScript());

/** Two earlier sessions, for a rail that is not empty. */
export const SESSIONS = [
  sessionInfo({
    id: 's-old-1',
    title: 'Fix the flaky login test',
    createdAt: hoursAgo(5),
    updatedAt: hoursAgo(4),
    usage: {
      inputTokens: 18_400,
      outputTokens: 2_100,
      cacheReadTokens: 9_000,
      cacheWriteTokens: 2_500,
      requests: 6,
      cost: 0.11,
    },
    contextUsed: 20_500,
  }),
  sessionInfo({
    id: 's-old-2',
    title: 'Explain the build setup',
    cwd: '/Users/me/docs-site',
    createdAt: hoursAgo(30),
    updatedAt: hoursAgo(29),
  }),
];

/**
 * Everything set up, and a server that runs sessions: `session/send` plays a turn (see `sessionScript`), so a story
 * can send a message, answer the approval and watch the reply.
 */
export const chatScript = (options: SessionScriptOptions = {}) =>
  mergeScripts(setUpScript(), sessionScript({ sessions: SESSIONS.map((info) => ({ info })), ...options }));
