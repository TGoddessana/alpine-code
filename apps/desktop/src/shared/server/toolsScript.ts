import type { ProfileInfo, ToolFileInfo, ToolSummary } from '@alpine/protocol';

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

const PROPOSE_MEMORY: ToolSummary = {
  name: 'propose_memory',
  description: 'Suggest something to remember in later sessions.',
  params: [],
  readOnly: true,
  openWorld: false,
  ask: 'never',
};

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

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/**
 * Tool files and profiles, remembered while the script runs: one ready tool, one changed outside the app, one
 * broken. `tools/check` reads the `def` names and docstrings without running anything; `trafilatura` needs an
 * approval.
 */
export function toolsScript(): Script {
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
  let profiles: ProfileInfo[] = [
    { id: 'default', name: '', project: null, model: null, tools: BUILTIN.map((t) => t.name) },
    {
      id: 'p-shop',
      name: '쇼핑몰 작업',
      project: '/Users/me/alpine-code',
      model: null,
      tools: [...BUILTIN.map((t) => t.name), 'fetch'],
    },
    { id: 'p-light', name: 'Motif-3 가볍게', project: null, model: 'local/motif-3', tools: ['read', 'grep', 'edit'] },
  ];
  const approved = new Set<string>();

  const resolve = (cwd: string, model: string | null) =>
    profiles
      .filter((p) => (p.project === null || p.project === cwd) && (p.model === null || p.model === model))
      .reduce((best, p) => (rank(p) > rank(best) ? p : best));

  return {
    results: {
      'tools/list': () => ({
        tools: [
          ...BUILTIN.map((tool) => ({ tool, origin: 'builtin' as const, optional: true })),
          { tool: PROPOSE_MEMORY, origin: 'memory' as const, optional: false },
          ...files.flatMap((f) => f.tools).map((tool) => ({ tool, origin: 'user' as const, optional: true })),
        ],
        files,
        folder: '/Users/me/.alpine-code/tools',
      }),
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
        if (enableIn) profiles = profiles.map((p) => (p.id === enableIn ? { ...p, tools: [...p.tools, ...added] } : p));
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
        profiles = profiles.map((p) => ({ ...p, tools: p.tools.filter((t) => !gone.has(t)) }));
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
      'profiles/list': () => ({ profiles }),
      'profiles/save': ({ profile }) => {
        const clash = profiles.find(
          (p) => p.id !== profile.id && p.project === profile.project && p.model === profile.model,
        );
        if (clash) throw new ServerError(-32000, 'Another profile applies there', { reason: 'profile_conflict' });
        const saved = profile.id ? profile : { ...profile, id: `p-${profiles.length}` };
        profiles = profile.id ? profiles.map((p) => (p.id === saved.id ? saved : p)) : [...profiles, saved];
        return { profile: saved };
      },
      'profiles/delete': ({ id }) => {
        profiles = profiles.filter((p) => p.id !== id || p.id === 'default');
        return {};
      },
      'profiles/resolve': ({ cwd, model }) => ({ profile: resolve(cwd, model ?? null) }),
    },
  };
}

function rank(profile: ProfileInfo) {
  return (profile.project !== null ? 2 : 0) + (profile.model !== null ? 1 : 0);
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
