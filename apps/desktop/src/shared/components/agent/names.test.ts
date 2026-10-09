import { describe, expect, it } from 'vitest';

import { agentMessages } from './messages';
import { abilities, agentName, isBuiltin, toolDoes, toolLabel } from './names';

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
    expect(toolDoes('bash', t)).toBe('터미널 명령을 실행해요');
    expect(toolDoes('fetch', t)).toBe('');
    expect(isBuiltin('grep')).toBe(true);
    expect(isBuiltin('fetch')).toBe(false);
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
});
