import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

  it('closes from its own close button', () => {
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: /오른쪽 창 열기/ }));
    const dock = screen.getByRole('complementary');
    fireEvent.click(dock.querySelector('button[aria-label="오른쪽 창 닫기"]')!);
    expect(screen.queryByRole('complementary')).toBeNull();
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

  it('takes the whole width under 크게 보기 and gives it back, keeping the page mounted', () => {
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: /오른쪽 창 열기/ }));
    const page = screen.getByText('페이지');
    const dock = screen.getByRole('complementary');
    expect(dock.style.width).toBe('360px');
    expect(screen.getByRole('separator', { name: '오른쪽 창 너비' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '크게 보기', pressed: false }));
    expect(dock.style.width).toBe('');
    expect(page.parentElement!.className).toContain('hidden');
    expect(screen.queryByRole('separator')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '작게 보기', pressed: true }));
    expect(dock.style.width).toBe('360px');
    expect(page.parentElement!.className).not.toContain('hidden');
  });

  it('shows the normal width on another page, and does not bring 크게 보기 back when returning', () => {
    const { rerender } = render(<Page scope="session:one" />);
    fireEvent.click(screen.getByRole('button', { name: /오른쪽 창 열기/ }));
    fireEvent.click(screen.getByRole('button', { name: '크게 보기' }));
    const page = screen.getByText('페이지');
    expect(page.parentElement!.className).toContain('hidden');

    rerender(<Page scope="session:two" />);
    expect(screen.getByText('페이지').parentElement!.className).not.toContain('hidden');
    expect(screen.getByRole('button', { name: '크게 보기', pressed: false })).toBeTruthy();

    rerender(<Page scope="session:one" />);
    expect(screen.getByText('페이지').parentElement!.className).not.toContain('hidden');
    expect(screen.getByRole('button', { name: '크게 보기', pressed: false })).toBeTruthy();
  });

  it('starts with the normal width when the page unmounts while enlarged and is mounted again', () => {
    const { unmount } = render(<Page scope="session:one" />);
    fireEvent.click(screen.getByRole('button', { name: /오른쪽 창 열기/ }));
    fireEvent.click(screen.getByRole('button', { name: '크게 보기' }));
    expect(screen.getByText('페이지').parentElement!.className).toContain('hidden');

    unmount();
    render(<Page scope="session:one" />);
    expect(screen.getByText('페이지').parentElement!.className).not.toContain('hidden');
    expect(screen.getByRole('button', { name: '크게 보기', pressed: false })).toBeTruthy();
  });

  it('starts with the normal width again after being closed while enlarged', () => {
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: /오른쪽 창 열기/ }));
    fireEvent.click(screen.getByRole('button', { name: '크게 보기' }));
    fireEvent.click(screen.getByRole('button', { name: '오른쪽 창 닫기', pressed: true }));
    fireEvent.click(screen.getByRole('button', { name: /오른쪽 창 열기/ }));
    expect(screen.getByRole('button', { name: '크게 보기', pressed: false })).toBeTruthy();
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
