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
    const { getByRole } = show(<Composer running bar={null} onStop={onStop} />);
    esc();
    expect(onStop).toHaveBeenCalledOnce();
    expect(getByRole('button', { name: '멈추기' })).toHaveProperty('title', '멈추기 · Esc');
  });

  it('leaves Esc alone when nothing runs, while composing Hangul, and while a dialog or menu is open', () => {
    const onStop = vi.fn();
    const { unmount } = show(<Composer bar={null} onStop={onStop} />);
    esc();
    unmount();
    show(<Composer running bar={null} onStop={onStop} />);
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
});
