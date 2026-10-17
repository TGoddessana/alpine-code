import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/i18n';

import { AgentChip } from './AgentChip';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/shared/server', () => ({
  useAgents: () => ({
    data: {
      agents: [{ id: 'default', name: '', look: 'alpine', color: 'blue', model: 'other/configured-model', tools: [] }],
    },
  }),
  useConnections: () => ({ data: { defaultModel: 'other/default-model' } }),
}));

function show(context: 'new' | 'session', model: string | null, disabled = false) {
  return render(
    <LocaleProvider locale="ko">
      <AgentChip context={context} agentId="default" model={model} disabled={disabled} onChange={() => {}} />
    </LocaleProvider>,
  );
}

describe('AgentChip model label', () => {
  afterEach(cleanup);

  it('shows the actual session model beside the agent name, including while running', () => {
    const { getByRole } = show('session', 'openai/gpt-5', true);
    const chip = getByRole('button', { name: /기본 에이전트 · gpt-5/ });
    expect(chip.textContent).toContain('· gpt-5');
    expect(chip).toHaveProperty('disabled', true);
    expect(chip.textContent).not.toContain('configured-model');
  });

  it('omits the separator when the session model is unknown', () => {
    const { getByRole } = show('session', null);
    expect(getByRole('button').textContent).toBe('기본 에이전트');
  });

  it('keeps the new-conversation chip name-only', () => {
    const { getByRole } = show('new', 'openai/gpt-5');
    expect(getByRole('button').textContent).toBe('기본 에이전트');
    expect(getByRole('button')).toHaveProperty('title', 'gpt-5');
  });
});
