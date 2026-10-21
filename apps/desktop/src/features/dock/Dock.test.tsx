import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Folder, SquareTerminal } from 'lucide-react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocaleProvider } from '@/shared/i18n';

import { Dock, DockLayout, DockToggle } from './Dock';
import { useDockOpen } from './state';

const tabs = [{ id: 'one', label: '첫째', content: <p>첫째 내용</p> }];

function Page({ list = tabs, scope = 'session:one' }: { list?: typeof tabs; scope?: string }) {
  return (
    <LocaleProvider locale="ko">
      <DockToggle files={3} />
      <DockLayout scope={scope} tabs={list}>
        <main>페이지</main>
      </DockLayout>
    </LocaleProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  // The shared open state outlives a render; start every test closed.
  render(<ResetClosed />);
  cleanup();
});
afterEach(cleanup);

/** 크게 보기 and 작게 보기 are under ⋮ (더보기). */
async function fromMore(name: string) {
  fireEvent.click(screen.getByRole('button', { name: '더보기' }));
  fireEvent.click(await screen.findByRole('menuitem', { name }));
}

function ResetClosed() {
  const [, setOpen] = useDockOpen();
  setOpen(false);
  return null;
}

describe('dock', () => {
  it('opens and closes from the toggle, which counts changed files only while closed', () => {
    render(<Page />);
    expect(screen.queryByRole('complementary')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '오른쪽 창 열기, 바뀐 파일 3개' }));
    expect(screen.getByRole('complementary', { name: '오른쪽 창' })).toBeTruthy();
    const toggle = screen.getByRole('button', { name: '오른쪽 창 닫기', pressed: true });
    expect(toggle.textContent).toBe('');
    expect(localStorage.getItem('alpine.work-result.open')).toBe('true');
    fireEvent.click(toggle);
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('preserves unfinished input when closed and immediately reopened', () => {
    render(
      <Page list={[{ id: 'draft', label: '초안', content: <textarea aria-label="초안 내용" defaultValue="" /> }]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /오른쪽 창 열기/ }));
    const input = screen.getByRole('textbox', { name: '초안 내용' }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '아직 작성 중인 내용' } });
    fireEvent.click(screen.getByRole('button', { name: '오른쪽 창 닫기', pressed: true }));
    expect(screen.queryByRole('textbox', { name: '초안 내용' })).toBeNull();
    expect(input.closest('[inert]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /오른쪽 창 열기/ }));
    expect(screen.getByRole('textbox', { name: '초안 내용' })).toBe(input);
    expect(input.value).toBe('아직 작성 중인 내용');
  });

  it('has no close button of its own: the top bar closes it', () => {
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: /오른쪽 창 열기/ }));
    const dock = screen.getByRole('complementary');
    expect(dock.querySelector('button[aria-label="오른쪽 창 닫기"]')).toBeNull();
  });

  it('shows icon tabs named by their label, a line after a divider, and the rarer places under ⋮', async () => {
    const icons: {
      id: string;
      label: string;
      icon?: LucideIcon;
      divider?: boolean;
      more?: boolean;
      content: ReactElement;
    }[] = [
      { id: 'one', label: '첫째', divider: true, content: <p>첫째 내용</p> },
      { id: 'term', label: '터미널', icon: SquareTerminal, content: <p>터미널 내용</p> },
      { id: 'files', label: '파일', icon: Folder, content: <p>파일 내용</p> },
      { id: 'rare', label: '드문 곳', more: true, content: <p>드문 내용</p> },
    ];
    render(<Page list={icons} />);
    fireEvent.click(screen.getByRole('button', { name: /오른쪽 창 열기/ }));
    const term = screen.getByRole('tab', { name: '터미널' });
    expect(term.textContent).toBe('');
    expect(screen.queryByRole('tab', { name: '드문 곳' })).toBeNull();
    fireEvent.keyDown(screen.getByRole('tab', { name: '첫째' }), { key: 'End' });
    expect(screen.getByRole('tabpanel').textContent).toBe('파일 내용');
    await fromMore('드문 곳');
    expect(screen.getByRole('tabpanel').textContent).toBe('드문 내용');
  });

  it('shows the tab strip with the tab I am on, so a surface is just one more entry', () => {
    render(<Page list={[...tabs, { id: 'two', label: '둘째', content: <p>둘째 내용</p> }]} />);
    fireEvent.click(screen.getByRole('button', { name: /오른쪽 창 열기/ }));
    const [first, second] = screen.getAllByRole('tab');
    expect(screen.getByRole('tablist')).toBeTruthy();
    expect(first!.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('첫째 내용');
    fireEvent.click(second!);
    expect(second!.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('둘째 내용');
    fireEvent.keyDown(second!, { key: 'ArrowLeft' });
    expect(screen.getByRole('tabpanel').textContent).toBe('첫째 내용');
  });

  it('points aria-controls only at the rendered tabpanel, and moves with Home and End', () => {
    const three = [
      ...tabs,
      { id: 'two', label: '둘째', content: <p>둘째 내용</p> },
      { id: 'three', label: '셋째', content: <p>셋째 내용</p> },
    ];
    render(<Page list={three} />);
    fireEvent.click(screen.getByRole('button', { name: /오른쪽 창 열기/ }));
    const [first, second, third] = screen.getAllByRole('tab');
    expect(first!.getAttribute('aria-controls')).toBe('dock-panel-one');
    expect(second!.getAttribute('aria-controls')).toBeNull();
    expect(third!.getAttribute('aria-controls')).toBeNull();
    expect(document.getElementById('dock-panel-one')).toBeTruthy();

    fireEvent.keyDown(first!, { key: 'End' });
    expect(third!.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('셋째 내용');
    expect(third!.getAttribute('aria-controls')).toBe('dock-panel-three');
    expect(first!.getAttribute('aria-controls')).toBeNull();
    expect(document.activeElement).toBe(third);

    fireEvent.keyDown(third!, { key: 'Home' });
    expect(first!.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('첫째 내용');
  });

  it('takes the whole width under 크게 보기 and gives it back, keeping the page mounted', async () => {
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: /오른쪽 창 열기/ }));
    const page = screen.getByText('페이지');
    const dock = screen.getByRole('complementary');
    expect(dock.style.width).toBe('360px');
    expect(screen.getByRole('separator', { name: '오른쪽 창 너비' })).toBeTruthy();

    await fromMore('크게 보기');
    expect(dock.style.width).toBe('');
    expect(page.parentElement!.className).toContain('hidden');
    expect(screen.queryByRole('separator')).toBeNull();

    await fromMore('작게 보기');
    expect(dock.style.width).toBe('360px');
    expect(page.parentElement!.className).not.toContain('hidden');
  });

  it('shows the normal width on another page, and does not bring 크게 보기 back when returning', async () => {
    const { rerender } = render(<Page scope="session:one" />);
    fireEvent.click(screen.getByRole('button', { name: /오른쪽 창 열기/ }));
    await fromMore('크게 보기');
    const page = screen.getByText('페이지');
    expect(page.parentElement!.className).toContain('hidden');

    rerender(<Page scope="session:two" />);
    expect(screen.getByText('페이지').parentElement!.className).not.toContain('hidden');
    expect(screen.getByRole('complementary').dataset.expanded).toBe('false');

    rerender(<Page scope="session:one" />);
    expect(screen.getByText('페이지').parentElement!.className).not.toContain('hidden');
    expect(screen.getByRole('complementary').dataset.expanded).toBe('false');
  });

  it('starts with the normal width when the page unmounts while enlarged and is mounted again', async () => {
    const { unmount } = render(<Page scope="session:one" />);
    fireEvent.click(screen.getByRole('button', { name: /오른쪽 창 열기/ }));
    await fromMore('크게 보기');
    expect(screen.getByText('페이지').parentElement!.className).toContain('hidden');

    unmount();
    render(<Page scope="session:one" />);
    expect(screen.getByText('페이지').parentElement!.className).not.toContain('hidden');
    expect(screen.getByRole('complementary').dataset.expanded).toBe('false');
  });

  it('starts with the normal width again after being closed while enlarged', async () => {
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: /오른쪽 창 열기/ }));
    await fromMore('크게 보기');
    fireEvent.click(screen.getByRole('button', { name: '오른쪽 창 닫기', pressed: true }));
    fireEvent.click(screen.getByRole('button', { name: /오른쪽 창 열기/ }));
    expect(screen.getByRole('complementary').dataset.expanded).toBe('false');
  });
});

describe('Dock alone', () => {
  it('names itself as an aside', () => {
    render(
      <LocaleProvider locale="en">
        <Dock tabs={tabs} />
      </LocaleProvider>,
    );
    expect(screen.getByRole('complementary', { name: 'Side panel' })).toBeTruthy();
  });
});
