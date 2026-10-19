import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider, type Locale } from '@/shared/i18n';
import {
  publishServer,
  scriptedConnection,
  ServerProvider,
  type CloudScriptOptions,
  type ServerConnection,
} from '@/shared/server';

import { dataType, fromWire, toWire } from './convert';
import { DataPanel } from './DataPanel';

function mount(options: CloudScriptOptions = {}, locale: Locale = 'ko') {
  const base = scriptedConnection(publishServer({ publishMs: 0, ...options }));
  const requests: { method: string; params: Record<string, unknown> }[] = [];
  const connection: ServerConnection = {
    request: (method, params) => {
      requests.push({ method, params: params as Record<string, unknown> });
      return base.request(method, params);
    },
    subscribe: base.subscribe,
  };
  const onExport = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ServerProvider connection={connection}>
        <LocaleProvider locale={locale}>
          <DataPanel cwd="/project" onExport={onExport} />
        </LocaleProvider>
      </ServerProvider>
    </QueryClientProvider>,
  );
  const sent = (method: string) => requests.filter((r) => r.method === method).map((r) => r.params);
  return { sent, onExport };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const row = (name: RegExp) => screen.findByRole('row', { name });

describe('SQLite types in the tab', () => {
  it('maps declared types to the tab kinds and back', () => {
    expect(dataType('INTEGER')).toBe('integer');
    expect(dataType('varchar(80)')).toBe('text');
    expect(dataType('BOOLEAN')).toBe('boolean');
    expect(dataType('DATETIME')).toBe('timestamp');
    expect(dataType('timestamp')).toBe('timestamp');
    expect(dataType('JSON')).toBe('json');
    expect(dataType('REAL')).toBe('real');
    expect(dataType('numeric(10,2)')).toBe('real');
    expect(dataType('')).toBe('text');
    expect(fromWire('boolean', 1)).toBe(true);
    expect(fromWire('json', '{"a":1}')).toEqual({ a: 1 });
    expect(fromWire('json', 'not json')).toBe('not json');
    expect(toWire('boolean', false)).toBe(0);
    expect(toWire('json', { a: 1 })).toBe('{"a":1}');
  });
});

describe('the live data', () => {
  it('says it is the live data, shows rows, and offers nothing to change them', async () => {
    mount({ data: 'live' });
    expect(await screen.findByText('실제 데이터')).toBeTruthy();
    expect(screen.getByText(/바꾸려면 AI에게 말해 주세요/)).toBeTruthy();
    fireEvent.click(await row(/^1$/));
    expect(await screen.findByText('박지윤')).toBeTruthy();
    // The secret column is shown masked.
    expect(screen.getAllByText('••••').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '고치기' })).toBeNull();
    expect(screen.queryByRole('button', { name: '이 행 지우기' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /‹ bookings/ }));
    expect(screen.queryByRole('button', { name: '행 추가' })).toBeNull();
  });

  it('reads newest first for a counting key, and says the live label in English too', async () => {
    const { sent } = mount({ data: 'live' }, 'en');
    expect(await screen.findByText('Live data')).toBeTruthy();
    await waitFor(() => expect(sent('data/rows').length).toBeGreaterThan(0));
    expect(sent('data/rows')[0]).toMatchObject({
      source: 'live',
      table: 'bookings',
      order: 'id',
      dir: 'desc',
      limit: 500,
    });
    expect(screen.getByText(/You can only look here/)).toBeTruthy();
  });

  it('highlights a row that arrives while the tab is open, then lets the highlight go', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mount({ data: 'live', bookingArrivesMs: 1000 });
    expect(await row(/^3$/)).toBeTruthy();
    expect(screen.queryByRole('row', { name: /^4$/ })).toBeNull();
    // The tab looks again every five seconds.
    await act(() => vi.advanceTimersByTimeAsync(5200));
    const arrived = await row(/^4$/);
    expect(arrived.className).toContain('motion-arrive');
    expect(screen.getByRole('row', { name: /^3$/ }).className).not.toContain('motion-arrive');
    await act(() => vi.advanceTimersByTimeAsync(4500));
    expect(screen.getByRole('row', { name: /^4$/ }).className).not.toContain('motion-arrive');
  });

  it('puts a dot on another table that grew, until it is opened', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mount({ data: 'live', bookingArrivesMs: 1000 });
    fireEvent.click(await screen.findByRole('tab', { name: /classes/ }));
    await row(/^3$/);
    await act(() => vi.advanceTimersByTimeAsync(5200));
    const bookings = await screen.findByRole('tab', { name: /bookings/ });
    await waitFor(() => expect(bookings.querySelector('.rounded-full.bg-interactive')).toBeTruthy());
    fireEvent.click(bookings);
    expect(bookings.querySelector('.size-1\\.5.bg-interactive')).toBeNull();
  });

  it('lists what the AI read, newest first, with the question it asked', async () => {
    mount({ data: 'live' });
    fireEvent.click(await screen.findByRole('button', { name: 'AI가 읽은 기록 2건' }));
    expect(await screen.findByText(/SELECT status, count/)).toBeTruthy();
    expect(screen.getByText(/bookings, classes/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /‹ 데이터/ }));
    expect(await row(/^1$/)).toBeTruthy();
  });

  it('says so when the AI has read nothing yet', async () => {
    mount({ data: 'live', aiReads: 0 });
    fireEvent.click(await screen.findByRole('button', { name: 'AI가 읽은 기록 0건' }));
    expect(await screen.findByText('아직 AI가 실제 데이터를 읽은 적이 없어요.')).toBeTruthy();
  });

  it('asks for only the first 500 rows of a big table and says so', async () => {
    mount({ data: 'live', eventRows: 5000 });
    fireEvent.click(await screen.findByRole('tab', { name: /events/ }));
    expect(await screen.findByText('처음 500행만 보여요')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /events/ }).textContent).toContain('5,000');
  });

  it('answers read_only when a save reaches the live data anyway', async () => {
    const connection = scriptedConnection(publishServer({ data: 'live' }));
    await expect(
      connection.request('data/save', {
        cwd: '/project',
        source: 'live',
        table: 'bookings',
        key: { id: 1 },
        cells: { status: 'x' },
      }),
    ).rejects.toMatchObject({ data: { reason: 'read_only' } });
  });
});

describe('the practice data', () => {
  it('says it stays on this Mac, and is the one editable source', async () => {
    mount({ data: 'practice' });
    expect(await screen.findByText('연습 데이터 · 이 Mac에만 있어요')).toBeTruthy();
    expect(await screen.findByRole('button', { name: '행 추가' })).toBeTruthy();
    expect(screen.queryByText(/AI가 읽은 기록/)).toBeNull();
  });

  it('saves only what changed, by the row key, and shows the new value', async () => {
    const { sent } = mount({ data: 'practice' });
    fireEvent.click(await row(/^1$/));
    fireEvent.click(await screen.findByRole('button', { name: '고치기' }));
    // A secret column is not an input.
    expect(screen.queryByLabelText('api_token (text)')).toBeNull();
    fireEvent.input(screen.getByLabelText('status (text)'), { target: { value: 'waitlisted' } });
    fireEvent.change(screen.getByLabelText('paid (boolean)'), { target: { value: 'true' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('저장했어요.')).toBeTruthy();
    expect(sent('data/save')).toEqual([
      {
        cwd: '/project',
        source: 'practice',
        table: 'bookings',
        key: { id: 1 },
        cells: { status: 'waitlisted', paid: 1 },
      },
    ]);
    expect(await screen.findByText('waitlisted')).toBeTruthy();
  });

  it('adds a row without sending the key the database makes, and leaves empty fields out', async () => {
    const { sent } = mount({ data: 'practice' });
    fireEvent.click(await screen.findByRole('tab', { name: /classes/ }));
    fireEvent.click(await screen.findByRole('button', { name: '행 추가' }));
    fireEvent.input(await screen.findByLabelText('title (text)'), { target: { value: '비누 만들기' } });
    fireEvent.input(screen.getByLabelText('seats (integer)'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(sent('data/save')).toHaveLength(1));
    expect(sent('data/save')[0]).toMatchObject({
      table: 'classes',
      key: null,
      cells: { title: '비누 만들기', seats: 12 },
    });
    fireEvent.click(await screen.findByRole('row', { name: /^4$/ }));
    expect(await screen.findByText('비누 만들기')).toBeTruthy();
  });

  it('asks once before deleting, then deletes by the row key', async () => {
    const { sent } = mount({ data: 'practice' });
    fireEvent.click(await row(/^1$/));
    fireEvent.click(await screen.findByRole('button', { name: '이 행 지우기' }));
    expect(sent('data/delete')).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '지우기' }));
    expect(await screen.findByText('지웠어요.')).toBeTruthy();
    expect(sent('data/delete')).toEqual([{ cwd: '/project', source: 'practice', table: 'bookings', key: { id: 1 } }]);
    expect(await screen.findByText(/아직 들어온 데이터가 없어요/)).toBeTruthy();
  });

  it("shows the server's words when a save fails and keeps the form", async () => {
    const base = scriptedConnection(publishServer({ publishMs: 0, data: 'practice' }));
    const connection: ServerConnection = {
      request: (method, params) =>
        method === 'data/save' ? Promise.reject(new Error('database is locked')) : base.request(method, params),
      subscribe: base.subscribe,
    };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ServerProvider connection={connection}>
          <LocaleProvider locale="ko">
            <DataPanel cwd="/project" />
          </LocaleProvider>
        </ServerProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(await row(/^1$/));
    fireEvent.click(await screen.findByRole('button', { name: '고치기' }));
    fireEvent.input(screen.getByLabelText('status (text)'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect((await screen.findByRole('alert')).textContent).toContain('database is locked');
    expect(screen.getByRole('button', { name: '저장' })).toBeTruthy();
  });
});

describe('both sources', () => {
  it('shows the live data first and switches to the practice data and back', async () => {
    mount({ data: 'both' });
    const live = await screen.findByRole('button', { name: /실제 데이터/ });
    const practice = screen.getByRole('button', { name: /연습 데이터/ });
    expect(live.getAttribute('aria-pressed')).toBe('true');
    expect(await row(/^3$/)).toBeTruthy();
    fireEvent.click(practice);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /연습 데이터/ }).getAttribute('aria-pressed')).toBe('true'),
    );
    expect(await screen.findByRole('button', { name: '행 추가' })).toBeTruthy();
    // The practice bookings table holds one row, the live one three.
    expect(within(screen.getByRole('tab', { name: /bookings/ })).getByText('1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /실제 데이터/ }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '행 추가' })).toBeNull());
  });

  it('draws nothing when there is no data to show', () => {
    mount({ data: 'none' });
    expect(screen.queryByText(/데이터/)).toBeNull();
  });
});
