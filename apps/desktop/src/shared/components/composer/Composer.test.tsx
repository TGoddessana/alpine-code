import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/i18n';
import { ServerProvider, type ServerConnection } from '@/shared/server';

import { Composer } from './Composer';

const connection = {
  request: async () => ({ connections: [], defaultModel: null }),
  subscribe: () => () => {},
} as unknown as ServerConnection;

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <ServerProvider connection={connection}>
        <LocaleProvider locale="ko">{children}</LocaleProvider>
      </ServerProvider>
    </QueryClientProvider>
  );
}

const show = (element: ReactNode) => render(element, { wrapper: Providers });

const esc = (init: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key: 'Escape', ...init });

describe('Composer', () => {
  afterEach(cleanup);

  it('stops the run with Esc from anywhere, and says so on the stop button', () => {
    const onStop = vi.fn();
    const { getByRole } = show(<Composer running onStop={onStop} />);
    esc();
    expect(onStop).toHaveBeenCalledOnce();
    expect(getByRole('button', { name: '멈추기' })).toHaveProperty('title', '멈추기 · Esc');
  });

  it('leaves Esc alone when nothing runs, while composing Hangul, and while a dialog or menu is open', () => {
    const onStop = vi.fn();
    const { unmount } = show(<Composer onStop={onStop} />);
    esc();
    unmount();
    show(<Composer running onStop={onStop} />);
    esc({ isComposing: true });
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    esc();
    expect(onStop).not.toHaveBeenCalled();
    dialog.remove();
    esc();
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('puts the agent first on the left of the bar, then the safety chip, and the bar on the right', () => {
    const { getByRole } = show(
      <Composer
        agent={<button type="button">에이전트</button>}
        bar={<button type="button">오른쪽</button>}
        mode={{ value: 'default', onChange: () => {} }}
      />,
    );
    const names = ['에이전트', /^안전/, '오른쪽'].map((name) => getByRole('button', { name }));
    expect(names[0]!.compareDocumentPosition(names[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(names[1]!.compareDocumentPosition(names[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('goes to the next permission mode with Shift+Tab in the box, from never asking back to asking', () => {
    const onChange = vi.fn();
    const { getByRole, rerender } = show(<Composer mode={{ value: 'accept_edits', onChange }} />);
    const box = getByRole('textbox');
    fireEvent.keyDown(box, { key: 'Tab', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith('auto');
    rerender(<Composer mode={{ value: 'auto', onChange }} />);
    fireEvent.keyDown(box, { key: 'Tab', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith('yolo');
    rerender(<Composer mode={{ value: 'yolo', onChange }} />);
    fireEvent.keyDown(box, { key: 'Tab', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith('default');
    fireEvent.keyDown(box, { key: 'Tab' });
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(getByRole('button', { name: '안전: 묻지 않고 다 하기' })).toBeTruthy();
  });
});
