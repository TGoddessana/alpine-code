import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent } from 'storybook/test';

import { FileNavigationProvider, FileReference } from '@/shared/files';
import type { Script } from '@/shared/server';

import { FileViewer } from './FileViewer';

const server = {
  results: {
    'files/list': ({ path = '' }) => ({
      entries:
        path === ''
          ? [
              { name: 'public', path: 'public', kind: 'directory' },
              { name: 'src', path: 'src', kind: 'directory' },
              { name: '.gitignore', path: '.gitignore', kind: 'file' },
              { name: 'package.json', path: 'package.json', kind: 'file' },
              { name: 'README.md', path: 'README.md', kind: 'file' },
            ]
          : path === 'src'
            ? [
                { name: 'components', path: 'src/components', kind: 'directory' },
                { name: 'App.tsx', path: 'src/App.tsx', kind: 'file' },
                { name: 'main.tsx', path: 'src/main.tsx', kind: 'file' },
                { name: 'styles.css', path: 'src/styles.css', kind: 'file' },
              ]
            : [],
      hasMore: false,
      nextOffset: 5,
    }),
    'files/read': ({ path, line = 1, limit = 400 }) => {
      const startLine = Math.max(1, line - 200);
      return {
        path: `/project/${path.replace('/project/', '')}`,
        relativePath: 'src/App.tsx',
        line: Math.min(line, 900),
        startLine,
        totalLines: 900,
        truncated: true,
        content: Array.from(
          { length: Math.min(limit, 901 - startLine) },
          (_, index) => `const item${startLine + index} = ${startLine + index};`,
        ).join('\n'),
      };
    },
    'files/search': () => ({ paths: ['src/App.tsx', 'src/App.test.tsx'], truncated: false }),
    'files/action': () => {
      throw new Error('External editor is unavailable');
    },
  },
} satisfies Script;
const meta = {
  title: 'Workspace/File viewer',
  component: FileViewer,
  parameters: { server },
  decorators: [
    (Story, { parameters }) => (
      <FileNavigationProvider cwd="/project">
        <div className="flex h-screen max-w-110 flex-col bg-canvas p-5">
          {parameters.reference !== false && (
            <div className="mb-4">
              <FileReference value="src/App.tsx:242" />
            </div>
          )}
          <Story />
        </div>
      </FileNavigationProvider>
    ),
  ],
} satisfies Meta<typeof FileViewer>;
export default meta;
type Story = StoryObj<typeof meta>;
export const FolderTree: Story = {
  parameters: { reference: false },
  play: async () => {
    await userEvent.click(await screen.findByRole('treeitem', { name: 'src' }));
    await expect(await screen.findByRole('treeitem', { name: 'App.tsx' })).toBeVisible();
  },
};
export const BrowseAndReturn: Story = {
  parameters: { reference: false },
  play: async () => {
    await userEvent.click(await screen.findByRole('treeitem', { name: 'src' }));
    await userEvent.click(await screen.findByRole('treeitem', { name: 'App.tsx' }));
    await expect(await screen.findByText('const item1 = 1;')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /^(파일 목록|Files)$/ }));
    await expect(screen.getByRole('treeitem', { name: 'src', expanded: true })).toBeVisible();
    await expect(screen.getByRole('treeitem', { name: 'App.tsx' })).toBeVisible();
  },
};
export const Source: Story = {
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'src/App.tsx:242' }));
    await expect(await screen.findByText('const item242 = 242;')).toBeVisible();
  },
};
export const EditorFailure: Story = {
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'src/App.tsx:242' }));
    await userEvent.click(await screen.findByRole('button', { name: /외부 에디터로 열기|Open in external editor/ }));
    await expect(await screen.findByRole('alert')).toHaveTextContent('External editor is unavailable');
  },
};
export const MissingFile: Story = {
  parameters: {
    server: {
      results: {
        ...server.results,
        'files/read': () => {
          throw new Error('File does not exist');
        },
      },
    } satisfies Script,
  },
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'src/App.tsx:242' }));
    await expect(await screen.findByRole('alert')).toHaveTextContent('File does not exist');
  },
};

export const CompactSource: Story = {
  parameters: {
    reference: false,
    server: {
      results: {
        ...server.results,
        'files/read': () => ({
          path: '/project/package.json',
          relativePath: 'package.json',
          content:
            '{\n  "name": "alpine-code",\n  "private": true,\n  "scripts": {\n    "dev": "vite",\n    "build": "tsc && vite build"\n  }\n}',
          startLine: 1,
          totalLines: 8,
          line: 1,
          truncated: false,
        }),
        'files/action': () => ({ ok: true }),
      },
    } satisfies Script,
  },
  play: async () => {
    await userEvent.click(await screen.findByRole('treeitem', { name: 'package.json' }));
  },
};
