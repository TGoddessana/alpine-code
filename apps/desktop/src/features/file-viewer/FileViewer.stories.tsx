import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent } from 'storybook/test';

import { FileNavigationProvider, FileReference } from '@/shared/files';
import type { Script } from '@/shared/server';

import { FileViewer } from './FileViewer';

const server = {
  results: {
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
    (Story) => (
      <FileNavigationProvider cwd="/project">
        <div className="flex h-screen max-w-4xl flex-col bg-canvas p-5">
          <div className="mb-4">
            <FileReference value="src/App.tsx:242" />
          </div>
          <Story />
        </div>
      </FileNavigationProvider>
    ),
  ],
} satisfies Meta<typeof FileViewer>;
export default meta;
type Story = StoryObj<typeof meta>;
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
