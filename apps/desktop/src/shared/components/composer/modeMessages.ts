import { defineMessages } from '@/shared/i18n';

import type { Mode } from './ModeChip';

/** The permission modes in words: the composer's chip and Settings › General say them the same way. */
export const modeMessages = defineMessages({
  ko: {
    name: (mode: Mode) =>
      ({
        default: '물어보고 하기',
        accept_edits: '파일 수정은 바로',
        yolo: '묻지 않고 다 하기',
      })[mode],
    description: (mode: Mode) =>
      ({
        default: '파일을 고치거나 명령을 실행하기 전에 물어봐요',
        accept_edits: '파일은 바로 고치고, 명령은 실행하기 전에 물어봐요',
        yolo: '폴더 밖 파일이나 위험한 명령도 묻지 않고 실행해요',
      })[mode],
    chipTitle: '안전 · Shift+Tab으로 바꾸기',
    chipLabel: (name: string) => `안전: ${name}`,
    changeDefault: '새 세션 기본값 바꾸기',
  },
  en: {
    name: (mode: Mode) =>
      ({
        default: 'Ask first',
        accept_edits: 'Edit files freely',
        yolo: 'Never ask',
      })[mode],
    description: (mode: Mode) =>
      ({
        default: 'Asks before changing files or running commands',
        accept_edits: 'Changes files right away, asks before running commands',
        yolo: 'Runs anything without asking, even outside the folder',
      })[mode],
    chipTitle: 'Safety · Shift+Tab to change',
    chipLabel: (name: string) => `Safety: ${name}`,
    changeDefault: 'Change the default for new sessions',
  },
});
