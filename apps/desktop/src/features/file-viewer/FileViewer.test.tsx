import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { FileNavigationProvider } from '@/shared/files';
import { LocaleProvider } from '@/shared/i18n';
import { scriptedConnection, ServerProvider, type Script } from '@/shared/server';

import { FileViewer } from './FileViewer';

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});
function mount(script: Script) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <ServerProvider connection={scriptedConnection(script)}>
        <LocaleProvider locale="en">
          <FileNavigationProvider cwd="/project">
            <div style={{ height: 600 }}>
              <FileViewer />
            </div>
          </FileNavigationProvider>
        </LocaleProvider>
      </ServerProvider>
    </QueryClientProvider>,
  );
}

it('loads folders on demand, opens a local file and preserves expanded folders when returning', async () => {
  const requests: string[] = [];
  mount({
    results: {
      'files/list': ({ path = '' }) => {
        requests.push(path);
        return {
          entries:
            path === ''
              ? [{ name: 'src', path: 'src', kind: 'directory' }]
              : [{ name: 'App.tsx', path: 'src/App.tsx', kind: 'file' }],
          nextOffset: 1,
          hasMore: false,
        };
      },
      'files/read': ({ path, line = 1 }) => ({
        path: `/project/${path}`,
        relativePath: path,
        content: 'export const app = true;',
        startLine: 1,
        totalLines: 1,
        line,
        truncated: false,
      }),
    },
  });
  const folder = await screen.findByRole('treeitem', { name: 'src' });
  expect(requests).toEqual(['']);
  fireEvent.click(folder);
  const file = await screen.findByRole('treeitem', { name: 'App.tsx' });
  expect(requests).toEqual(['', 'src']);
  fireEvent.click(file);
  const source = await screen.findByText('export const app = true;');
  expect(source.parentElement?.classList.contains('bg-selected')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Go to line 1' }));
  await waitFor(() =>
    expect(screen.getByText('export const app = true;').parentElement?.classList.contains('bg-selected')).toBe(true),
  );
  expect(screen.queryByRole('tree')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Files' }));
  expect(screen.getByRole('treeitem', { name: 'src', expanded: true })).toBeTruthy();
  expect(screen.getByRole('treeitem', { name: 'App.tsx' })).toBeTruthy();
});

it('supports keyboard expansion, movement, file selection and return to the parent', async () => {
  mount({
    results: {
      'files/list': ({ path = '' }) => ({
        entries:
          path === ''
            ? [{ name: 'src', path: 'src', kind: 'directory' }]
            : [{ name: 'App.tsx', path: 'src/App.tsx', kind: 'file' }],
        nextOffset: 1,
        hasMore: false,
      }),
      'files/read': ({ path }) => ({
        path,
        relativePath: path,
        content: 'hello',
        startLine: 1,
        totalLines: 1,
        line: 1,
        truncated: false,
      }),
    },
  });
  const root = screen.getByRole('treeitem', { name: 'project' });
  await screen.findByRole('treeitem', { name: 'src' });
  root.focus();
  fireEvent.keyDown(root, { key: 'ArrowDown' });
  const folder = screen.getByRole('treeitem', { name: 'src' });
  expect(document.activeElement).toBe(folder);
  fireEvent.keyDown(folder, { key: 'ArrowRight' });
  await screen.findByRole('treeitem', { name: 'App.tsx' });
  fireEvent.keyDown(folder, { key: 'ArrowRight' });
  const file = screen.getByRole('treeitem', { name: 'App.tsx' });
  expect(document.activeElement).toBe(file);
  fireEvent.keyDown(file, { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(folder);
  fireEvent.keyDown(folder, { key: 'ArrowRight' });
  fireEvent.keyDown(file, { key: 'Enter' });
  await screen.findByText('hello');
});

it('retries folder failures and reads remaining directory pages without toggling the folder', async () => {
  let failed = false;
  const pages: number[] = [];
  mount({
    results: {
      'files/list': ({ offset = 0 }) => {
        if (!failed) {
          failed = true;
          throw new Error('Folder unavailable');
        }
        pages.push(offset);
        return {
          entries: [{ name: offset ? 'b.ts' : 'a.ts', path: offset ? 'b.ts' : 'a.ts', kind: 'file' }],
          nextOffset: offset + 1,
          hasMore: offset === 0,
        };
      },
    },
  });
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByRole('treeitem', { name: 'a.ts' });
  fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
  await screen.findByRole('treeitem', { name: 'b.ts' });
  expect(screen.getByRole('treeitem', { name: 'project', expanded: true })).toBeTruthy();
  expect(pages).toEqual([0, 1]);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh file tree' }));
  await waitFor(() => expect(pages.length).toBeGreaterThan(2));
});

it('opens the editor and folder with the selected location and copies the absolute path without a line input', async () => {
  const action = vi.fn(() => ({ ok: true }));
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  mount({
    results: {
      'files/list': () => ({
        entries: [{ name: 'a.json', path: 'a.json', kind: 'file' }],
        nextOffset: 1,
        hasMore: false,
      }),
      'files/read': () => ({
        path: '/project/a.json',
        relativePath: 'a.json',
        content: '{}',
        startLine: 1,
        totalLines: 1,
        line: 1,
        truncated: false,
      }),
      'files/action': action,
    },
  });
  fireEvent.click(await screen.findByRole('treeitem', { name: 'a.json' }));
  await screen.findByText('{}');
  expect(screen.queryByRole('spinbutton')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Previous lines' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open in external editor' }));
  await waitFor(() =>
    expect(action).toHaveBeenCalledWith(
      { cwd: '/project', path: '/project/a.json', line: 1, action: 'editor' },
      expect.anything(),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'File actions' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Reveal in folder' }));
  await waitFor(() =>
    expect(action).toHaveBeenCalledWith(
      { cwd: '/project', path: '/project/a.json', line: 1, action: 'reveal' },
      expect.anything(),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'File actions' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy path' }));
  await screen.findByText('Copied');
  expect(writeText).toHaveBeenCalledWith('/project/a.json');
});
