import type { AgentAsk, ApprovalItem, SessionAnswerParams } from '@alpine/protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { LocaleProvider } from '@/shared/i18n';
import { scriptedConnection, ServerProvider } from '@/shared/server';

import { ApprovalCard } from './ApprovalCard';

afterEach(cleanup);

const write = (agent: string, task: string, path: string, line: string): AgentAsk => ({
  agent,
  task,
  callId: `call-${agent}`,
  title: `Create ${path}`,
  preview: `--- a/${path}\n+++ b/${path}\n@@ -0,0 +1 @@\n+${line}\n`,
  previewKind: 'diff',
  tool: 'write',
  args: { path, content: line },
});

const card: ApprovalItem = {
  id: 'r1',
  kind: 'approval',
  callId: 'call-a1',
  title: 'Create hero.html',
  preview: null,
  previewKind: 'diff',
  reason: null,
  remember: 'file writes in this project',
  decision: null,
  feedback: null,
  tool: 'write',
  args: { path: 'hero.html' },
  review: null,
  reviewError: null,
  askedBy: [
    write('a1', 'hero section', 'hero.html', '<h1>Bakery</h1>'),
    write('a2', 'menu section', 'menu.html', '<ul></ul>'),
  ],
};

function mount(approval: ApprovalItem) {
  const answers: SessionAnswerParams[] = [];
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ServerProvider
        connection={scriptedConnection({
          results: {
            'session/answer': (params) => {
              answers.push(params);
              return { accepted: true };
            },
          },
        })}
      >
        <LocaleProvider locale="en">
          <ApprovalCard sessionId="s" approval={approval} />
        </LocaleProvider>
      </ServerProvider>
    </QueryClientProvider>,
  );
  return answers;
}

it("shows every agent's own call under its task, not only the first one's", () => {
  mount(card);
  expect(screen.getByText('2 agents are asking')).toBeTruthy();
  const menu = screen.getByRole('listitem', { name: 'menu section' });
  expect(within(menu).getByTitle('menu.html')).toBeTruthy();
  expect(within(menu).getByText('+<ul></ul>')).toBeTruthy();
  const hero = screen.getByRole('listitem', { name: 'hero section' });
  expect(within(hero).getByText('+<h1>Bakery</h1>')).toBeTruthy();
});

it("skips one agent's call from its line, and answers all of them from the buttons below", async () => {
  const answers = mount(card);
  fireEvent.click(screen.getByRole('button', { name: 'Skip only menu section' }));
  await waitFor(() => expect(answers).toHaveLength(1));
  expect(answers[0]).toEqual({ sessionId: 's', requestId: 'r1', decision: 'deny', agent: 'a2' });
  fireEvent.click(screen.getByRole('button', { name: 'Allow all' }));
  await waitFor(() => expect(answers).toHaveLength(2));
  expect(answers[1]).toEqual({ sessionId: 's', requestId: 'r1', decision: 'allow' });
});

it('has no line of its own to skip when one agent asks', () => {
  mount({ ...card, askedBy: [card.askedBy[0]!] });
  expect(screen.getByText('hero section')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Skip only/ })).toBeNull();
  expect(screen.getByRole('button', { name: 'Allow' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy();
});
