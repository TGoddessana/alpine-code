import { defineMessages } from '@/shared/i18n';

export const messages = defineMessages({
  ko: {
    title: '실행 중단 관리',
    stopAll: '전체 중단',
    stop: '중단',
    force: '강제 종료',
    output: '출력 보기',
    empty: '실행한 프로세스가 없습니다.',
    preserved: '중단 전 출력은 터미널에 보존됩니다.',
    remaining: '종료되지 않은 작업이 있습니다. 상태를 확인하고 필요한 프로세스를 강제 종료하세요.',
    worker:
      '이 사용자 도구는 앱 안에서 실행 중입니다. 중단을 요청했지만 실제 함수가 끝날 때까지 계속 실행될 수 있습니다.',
    waiting: '중단 요청 처리 중…',
    userTool: '사용자 도구',
    running: '실행 중',
    stopping: '종료 대기 · 아직 실행 중',
    exited: '완료',
    failed: '실패',
    cancelled: '중단됨',
    finished: '완료',
  },
  en: {
    title: 'Process control',
    stopAll: 'Stop all',
    stop: 'Stop',
    force: 'Force stop',
    output: 'View output',
    empty: 'No processes have been started.',
    preserved: 'Output captured before cancellation stays in the terminal.',
    remaining: 'Some work has not stopped. Check its status and force stop remaining processes if needed.',
    worker:
      'This user tool runs inside the app. Cancellation was requested, but it may continue until the function actually returns.',
    waiting: 'Requesting cancellation…',
    userTool: 'User tool',
    running: 'Running',
    stopping: 'Waiting for exit · still running',
    exited: 'Finished',
    failed: 'Failed',
    cancelled: 'Stopped',
    finished: 'Finished',
  },
});
