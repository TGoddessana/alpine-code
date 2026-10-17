import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { WorkspacePreview } from './WorkspacePreview';

const meta = {
  title: 'Workspace improvements/Preview',
  component: WorkspacePreview,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof WorkspacePreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FileViewer: Story = {
  name: '01 · 파일 경로와 원본 뷰어',
  args: { mode: 'files' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /src\/components\/MenuCard.tsx/ }));
    await expect(canvas.getByText('대화에서 선택한 위치 · 23행')).toBeVisible();
    await userEvent.type(canvas.getByRole('textbox', { name: '프로젝트 파일 찾기' }), 'menu.ts');
    await userEvent.click(canvas.getByRole('button', { name: 'menu.ts' }));
    await expect(canvas.getByLabelText('menu.ts 원본')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: /src\/components\/MenuCard.tsx/ }));
  },
};

export const PersistentTerminal: Story = {
  name: '02 · 유지되는 터미널과 실시간 로그',
  args: { mode: 'terminal' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '테스트' }));
    await expect(canvas.getByText('Tests 12 passed (12)', { exact: false })).toBeVisible();
    await userEvent.type(canvas.getByRole('textbox', { name: '터미널 입력' }), 'pwd{Enter}');
    await expect(canvas.getByText('/Users/me/bakery-web', { exact: true })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: '개발 서버' }));
  },
};

export const DevelopmentServer: Story = {
  name: '03 · 개발 서버와 포트 관리',
  args: { mode: 'servers' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '서버 추가' }));
    await expect(canvas.getByRole('alert')).toHaveTextContent('5173번 포트를 사용 중이에요');
    await userEvent.click(canvas.getByRole('button', { name: '기존 서버 열기' }));
    await expect(canvas.getByText('매일 아침, 갓 구운 빵.')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: '미리보기 닫기' }));
  },
};

export const ProcessCancellation: Story = {
  name: '04 · 중단 요청과 실제 종료 확인',
  args: { mode: 'stop' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '전체 중단' }));
    await expect(canvas.getByText('중단을 요청했어요')).toBeVisible();
    await expect(await canvas.findByText('아직 작업 1개가 실행 중이에요', {}, { timeout: 4000 })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: '이 작업 강제 종료' }));
    await expect(canvas.getByText('모든 작업이 종료됐어요')).toBeVisible();
    await expect(canvas.getByText('강제 종료 · 일부 파일 변경이 남아 있어요', { exact: false })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: '시나리오 다시 보기' }));
  },
};
