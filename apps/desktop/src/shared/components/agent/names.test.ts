import type { OfferedTool } from '@alpine/protocol';
import { describe, expect, it } from 'vitest';

import { agentMessages } from './messages';
import { abilities, agentName, alpineTools, isBuiltin, shortModel, toolLabel } from './names';

const t = agentMessages.ko;

describe('agentName', () => {
  it('reads the default agent, which has no name, as 기본 에이전트', () => {
    expect(agentName({ id: 'default', name: '' }, t)).toBe('기본 에이전트');
  });

  it('shows a name the user gave', () => {
    expect(agentName({ id: 'a-site', name: '홈페이지 담당' }, t)).toBe('홈페이지 담당');
  });
});

describe('toolLabel', () => {
  it('says a built-in tool in plain words and a user tool as it is', () => {
    expect(toolLabel('read', t)).toBe('파일 읽기');
    expect(toolLabel('edit', t)).toBe('파일 고치기');
    expect(toolLabel('fetch', t)).toBe('fetch');
    expect(toolLabel('propose_memory', t)).toBe('기억 제안');
    expect(isBuiltin('grep')).toBe(true);
    expect(isBuiltin('fetch')).toBe(false);
  });
});

describe('shortModel', () => {
  it('drops the connection name', () => {
    expect(shortModel('anthropic/claude-sonnet-5')).toBe('claude-sonnet-5');
    expect(shortModel('gpt-5')).toBe('gpt-5');
  });
});

describe('abilities', () => {
  it('lists what all six built-in tools allow', () => {
    expect(abilities(['read', 'glob', 'grep', 'write', 'edit', 'bash'], t)).toBe('파일 보기 · 바꾸기 · 명령');
  });

  it('says a reader cannot change files', () => {
    expect(abilities(['read', 'glob', 'grep'], t)).toBe('파일 보기 · 파일은 바꾸지 못해요');
  });

  it('counts the user tools', () => {
    expect(abilities(['read', 'write', 'fetch', 'weather'], t)).toBe('파일 보기 · 바꾸기 · 도구 2개 더');
    expect(abilities(['fetch'], t)).toBe('도구 1개 더');
  });

  it('does not count the memory tool, which every agent has', () => {
    expect(abilities(['read', 'propose_memory'], t)).toBe('파일 보기 · 파일은 바꾸지 못해요');
  });
});

describe('alpineTools', () => {
  const offered = (name: string, origin: OfferedTool['origin'], optional: boolean): OfferedTool => ({
    tool: { name, description: '', params: [], readOnly: true, openWorld: false, ask: 'never' },
    origin,
    optional,
  });

  it('takes the built-in and memory tools from the list, not the user tools', () => {
    const tools = [
      offered('read', 'builtin', true),
      offered('propose_memory', 'memory', false),
      offered('fetch', 'user', true),
    ];
    expect(alpineTools(tools)).toEqual([
      { name: 'read', optional: true },
      { name: 'propose_memory', optional: false },
    ]);
  });

  it('falls back to the built-ins until the list is there', () => {
    expect(alpineTools(undefined).map((x) => x.name)).toEqual(['read', 'glob', 'grep', 'write', 'edit', 'bash']);
  });
});
