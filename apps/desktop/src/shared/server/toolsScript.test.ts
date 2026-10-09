import { describe, expect, it } from 'vitest';

import { scriptedConnection } from './scripted';
import { AGENTS, toolsScript } from './toolsScript';

const NEW = { ...AGENTS[0]!, id: '', name: '새 에이전트' };

describe('toolsScript agents', () => {
  it('adds an agent with a new id and keeps a free character', async () => {
    const connection = scriptedConnection(toolsScript());
    const { agent } = await connection.request('agents/save', { agent: { ...NEW, look: 'chef', color: 5 } });
    expect(agent.id).toMatch(/^a-/);
    expect([agent.look, agent.color]).toEqual(['chef', 5]);
    expect((await connection.request('agents/list', {})).agents).toHaveLength(AGENTS.length + 1);
  });

  it('gives a taken character to the next free colour of the same look', async () => {
    const connection = scriptedConnection(toolsScript());
    const { agent } = await connection.request('agents/save', { agent: { ...NEW, look: 'hardhat', color: 1 } });
    expect([agent.look, agent.color]).toEqual(['hardhat', 2]);
  });

  it('lets an existing agent share a look and colour, as the core does', async () => {
    const connection = scriptedConnection(toolsScript());
    const site = AGENTS.find((a) => a.id === 'a-site')!;
    const { agent } = await connection.request('agents/save', { agent: { ...site, look: 'glasses', color: 3 } });
    expect([agent.look, agent.color]).toEqual(['glasses', 3]);
  });

  it('trims the text, drops repeated tools and replaces an unknown look or colour', async () => {
    const connection = scriptedConnection(toolsScript());
    const { agent } = await connection.request('agents/save', {
      agent: {
        ...NEW,
        name: '  이름 ',
        description: ' 설명  ',
        tools: ['read', 'read', 'grep'],
        look: 'nope' as never,
        color: 99,
      },
    });
    expect(agent).toMatchObject({ name: '이름', description: '설명', tools: ['read', 'grep'], look: 'antenna' });
    expect(agent.color).toBeGreaterThanOrEqual(1);
    expect(agent.color).toBeLessThanOrEqual(8);
  });

  it('keeps the default agent when it is deleted', async () => {
    const connection = scriptedConnection(toolsScript());
    await connection.request('agents/delete', { id: 'default' });
    await connection.request('agents/delete', { id: 'a-site' });
    const ids = (await connection.request('agents/list', {})).agents.map((a) => a.id);
    expect(ids).toEqual(['default', 'a-review', 'a-writer']);
  });

  it('turns a new tool on in one agent and strips deleted tools from all', async () => {
    const connection = scriptedConnection(toolsScript());
    const source = '@tool(read_only=True)\ndef stats(x: str) -> str:\n    """Counts."""\n';
    await connection.request('tools/save', { name: 'stats', source, enableIn: 'a-review' });
    const tools = async (id: string) =>
      (await connection.request('agents/list', {})).agents.find((a) => a.id === id)!.tools;
    expect(await tools('a-review')).toContain('stats');
    expect(await tools('a-site')).not.toContain('stats');
    await connection.request('tools/delete', { name: 'fetch' });
    expect(await tools('default')).not.toContain('fetch');
    expect(await tools('a-site')).not.toContain('fetch');
  });
});
