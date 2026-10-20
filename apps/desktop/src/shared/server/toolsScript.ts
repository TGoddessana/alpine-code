import type { AgentInfo, ToolSummary } from '@alpine/protocol';

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

const SIX = BUILTIN.map((t) => t.name);

/** The agents a scripted server starts with: the default one and three the user made. */
export const AGENTS: AgentInfo[] = [
  {
    id: 'default',
    name: '',
    description: '',
    model: null,
    instructions: '',
    tools: SIX,
    look: 'antenna',
    color: 2,
  },
  {
    id: 'a-site',
    name: '홈페이지 담당',
    description: '가게 홈페이지를 만들고 고쳐요',
    model: 'anthropic/claude-sonnet-5',
    instructions: '바꾸기 전에 화면부터 보여 줘.\n어려운 말은 쉽게 풀어서.',
    tools: SIX,
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

/** Agents, remembered while the script runs, and the tools they can have. */
export function toolsScript(store: AgentStore = agentStore()): Script {
  let nextAgent = store.agents.length;

  return {
    results: {
      'tools/list': () => ({
        tools: [
          ...BUILTIN.map((tool) => ({ tool, origin: 'builtin' as const, optional: true })),
          { tool: PROPOSE_MEMORY, origin: 'memory' as const, optional: false },
        ],
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
