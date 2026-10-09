import type { AgentInfo, ToolFileInfo, ToolSummary } from '@alpine/protocol';

import { ServerError } from './connection';
import type { Script } from './scripted';

const BUILTIN: ToolSummary[] = [
  ['read', 'Read a text file, view an image or list a directory.', 'never'],
  ['glob', 'Find files by name pattern.', 'never'],
  ['grep', 'Search file contents with a regular expression.', 'never'],
  ['write', 'Write a file.', 'edit'],
  ['edit', 'Replace text in a file.', 'edit'],
  ['bash', 'Run a shell command.', 'ask'],
].map(([name, description, ask]) => ({
  name: name!,
  description: description!,
  params: [],
  readOnly: ask === 'never',
  openWorld: ask === 'ask',
  ask: ask as ToolSummary['ask'],
}));

const FETCH_SOURCE = `# /// script
# dependencies = ["httpx"]
# ///
import httpx
from alpineagents import tool


@tool(read_only=True, open_world=True)
def fetch(url: str, max_chars: int = 20000) -> str:
    """웹 페이지를 가져와 글만 돌려줘요.

    Args:
        url: 가져올 페이지 주소 (https://로 시작)
        max_chars: 돌려줄 최대 글자 수
    """
    response = httpx.get(url, follow_redirects=True, timeout=20)
    response.raise_for_status()
    return response.text[:max_chars]
`;

const SIX = BUILTIN.map((t) => t.name);

/** The agents a scripted server starts with: the default one and three the user made. */
export const AGENTS: AgentInfo[] = [
  {
    id: 'default',
    name: '',
    description: '',
    model: null,
    instructions: '',
    tools: [...SIX, 'fetch'],
    look: 'antenna',
    color: 2,
  },
  {
    id: 'a-site',
    name: '홈페이지 담당',
    description: '가게 홈페이지를 만들고 고쳐요',
    model: 'anthropic/claude-sonnet-5',
    instructions: '바꾸기 전에 화면부터 보여 줘.\n어려운 말은 쉽게 풀어서.',
    tools: [...SIX, 'fetch'],
    look: 'hardhat',
    color: 1,
  },
  {
    id: 'a-review',
    name: '꼼꼼한 검토자',
    description: '바뀐 내용을 읽고 문제를 찾아요',
    model: null,
    instructions: '고치지 말고 의견만 적어 줘.',
    tools: ['read', 'glob', 'grep'],
    look: 'glasses',
    color: 3,
  },
  {
    id: 'a-writer',
    name: '블로그 작가',
    description: '가게 소식을 블로그 글로 써요',
    model: null,
    instructions: '존댓말, 짧은 문장.\n이모지는 쓰지 마.',
    tools: ['read', 'write', 'edit'],
    look: 'beret',
    color: 4,
  },
];

/**
 * What the scripted servers share about agents: the list (which the agents screen edits and sessions read), and each
 * project's last agent by path. One store per running script, so a session sees the agent just made.
 */
export interface AgentStore {
  agents: AgentInfo[];
  lastAgent: Map<string, string>;
}

export const agentStore = (): AgentStore => ({ agents: AGENTS.map((a) => ({ ...a })), lastAgent: new Map() });

const LOOKS = [
  'antenna',
  'hardhat',
  'glasses',
  'beret',
  'headphones',
  'cap',
  'chef',
  'sprout',
  'ribbon',
  'beanie',
  'bowtie',
  'grad',
] as const;

/** The first free look and colour from the asked pair on: looks first, then colours, as the core does. */
function freeCharacter(taken: Set<string>, look: AgentInfo['look'], color: number): Pick<AgentInfo, 'look' | 'color'> {
  for (let i = 0; i < LOOKS.length; i++) {
    const l = LOOKS[(Math.max(LOOKS.indexOf(look), 0) + i) % LOOKS.length]!;
    for (let j = 0; j < 8; j++) {
      const c = ((color - 1 + j) % 8) + 1;
      if (!taken.has(`${l}/${c}`)) return { look: l, color: c };
    }
  }
  return { look, color };
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/**
 * Tool files and agents, remembered while the script runs: one ready tool, one changed outside the app, one
 * broken. `tools/check` reads the `def` names and docstrings without running anything; `trafilatura` needs an
 * approval.
 */
export function toolsScript(store: AgentStore = agentStore()): Script {
  const sources: Record<string, string> = { fetch: FETCH_SOURCE, order_stats: '', csv_summary: 'def oops(:\n' };
  let files: ToolFileInfo[] = [
    ready('fetch', FETCH_SOURCE),
    {
      name: 'order_stats',
      status: 'unconfirmed',
      error: null,
      missingPackage: null,
      changedAt: minutesAgo(12),
      tools: [],
      packages: [],
    },
    {
      name: 'csv_summary',
      status: 'error',
      error: 'Line 1: invalid syntax',
      missingPackage: null,
      changedAt: minutesAgo(90),
      tools: [],
      packages: [],
    },
  ];
  let nextAgent = store.agents.length;
  const approved = new Set<string>();

  return {
    results: {
      'tools/list': () => ({ builtin: BUILTIN, files, folder: '/Users/me/.alpine-code/tools' }),
      'tools/source': ({ name }) => ({ source: sources[name] ?? '' }),
      'tools/check': ({ source }) => {
        const packages = dependencies(source);
        const pending = packages.filter((p) => p === 'trafilatura' && !approved.has(p));
        if (pending.length > 0)
          return {
            tools: [],
            packages,
            error: null,
            missingPackage: null,
            needsApproval: pending.map((name) => ({
              name,
              firstRelease: '2019-05',
              lastMonthDownloads: 1_200_000,
              similar: [],
            })),
          };
        if (source.includes('def oops(:'))
          return { tools: [], packages, error: 'Line 1: invalid syntax', missingPackage: null, needsApproval: [] };
        return { tools: summarize(source), packages, error: null, missingPackage: null, needsApproval: [] };
      },
      'tools/save': ({ name, source, enableIn }) => {
        if (!/^[a-z_][a-z0-9_]*$/.test(name))
          throw new ServerError(-32000, 'Use lowercase letters, digits and _', { reason: 'invalid_name' });
        const before = new Set(files.find((f) => f.name === name)?.tools.map((t) => t.name));
        const file = ready(name, source);
        sources[name] = source;
        files = [...files.filter((f) => f.name !== name), file];
        const added = file.tools.filter((t) => !before.has(t.name)).map((t) => t.name);
        if (enableIn)
          store.agents = store.agents.map((a) => (a.id === enableIn ? { ...a, tools: [...a.tools, ...added] } : a));
        return { file };
      },
      'tools/confirm': ({ name }) => {
        const file = ready(name, sources[name] ?? '');
        files = files.map((f) => (f.name === name ? file : f));
        return { file };
      },
      'tools/delete': ({ name }) => {
        const gone = new Set(files.find((f) => f.name === name)?.tools.map((t) => t.name));
        files = files.filter((f) => f.name !== name);
        store.agents = store.agents.map((a) => ({ ...a, tools: a.tools.filter((t) => !gone.has(t)) }));
        return {};
      },
      'tools/install': ({ packages }) => {
        packages.forEach((p) => approved.add(p));
        return {};
      },
      'tools/test': ({ args }) => ({ ok: true, output: `Example Domain\n${JSON.stringify(args)}`, seconds: 0.4 }),
      'tools/draft': ({ description }) => ({
        source: FETCH_SOURCE.replace('웹 페이지를 가져와 글만 돌려줘요.', description.split('\n')[0] ?? ''),
      }),
      'agents/list': () => ({ agents: store.agents }),
      'agents/save': ({ agent }) => {
        // As the core does: text is trimmed, tools de-duplicated, an unknown look or colour replaced, and only a
        // new agent is moved off a look and colour another agent has.
        const look = LOOKS.includes(agent.look as (typeof LOOKS)[number]) ? agent.look : 'antenna';
        const color = Number.isInteger(agent.color) && agent.color >= 1 && agent.color <= 8 ? agent.color : 1;
        const taken = new Set(store.agents.map((a) => `${a.look}/${a.color}`));
        const character =
          !agent.id && taken.has(`${look}/${color}`) ? freeCharacter(taken, look, color) : { look, color };
        const saved: AgentInfo = {
          ...agent,
          ...character,
          name: agent.name.trim(),
          description: agent.description.trim(),
          tools: [...new Set(agent.tools)],
          id: agent.id || `a-${nextAgent++}`,
        };
        store.agents = store.agents.some((a) => a.id === saved.id)
          ? store.agents.map((a) => (a.id === saved.id ? saved : a))
          : [...store.agents, saved];
        return { agent: saved };
      },
      'agents/delete': ({ id }) => {
        store.agents = store.agents.filter((a) => a.id !== id || a.id === 'default');
        return {};
      },
    },
  };
}

function ready(name: string, source: string): ToolFileInfo {
  return {
    name,
    status: 'ready',
    error: null,
    missingPackage: null,
    changedAt: new Date().toISOString(),
    tools: summarize(source),
    packages: dependencies(source),
  };
}

function dependencies(source: string) {
  const block = /# dependencies = \[(.*?)\]/s.exec(source)?.[1] ?? '';
  return [...block.matchAll(/"([A-Za-z0-9._-]+)/g)].map((m) => m[1]!.toLowerCase());
}

/** The `@tool` functions of `source`, read without running it: name, first docstring line, typed parameters. */
function summarize(source: string): ToolSummary[] {
  const tools: ToolSummary[] = [];
  const pattern = /@tool\(([^)]*)\)\s*\ndef (\w+)\(([^)]*)\)[^:]*:\s*\n\s*"""([^\n]*)/g;
  for (const [, hints, name, params, doc] of source.matchAll(pattern)) {
    const readOnly = hints!.includes('read_only=True');
    const openWorld = !hints!.includes('open_world=False');
    tools.push({
      name: name!,
      description: doc!.trim(),
      params: params!
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => {
          const [left, value] = p.split('=').map((s) => s.trim());
          const [paramName, type] = left!.split(':').map((s) => s.trim());
          const described = new RegExp(`${paramName}: ([^\\n]*)`).exec(source.split('Args:')[1] ?? '')?.[1];
          return {
            name: paramName!,
            type: type === 'int' ? 'integer' : type === 'float' ? 'number' : type === 'bool' ? 'boolean' : 'string',
            description: described ?? '',
            required: value === undefined,
            default: value === undefined ? null : Number.isNaN(Number(value)) ? value : Number(value),
          };
        }),
      readOnly,
      openWorld,
      ask: readOnly && !openWorld ? 'never' : !readOnly && !openWorld ? 'edit' : 'ask',
    });
  }
  return tools;
}
