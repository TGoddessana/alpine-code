import { defineMessages } from './define';

/** Words that mean the same everywhere. Anything tied to one screen stays in that feature, even if it reads the same. */
export const common = defineMessages({
  ko: {
    confirm: '확정',
    cancel: '취소',
    chooseFolder: '작업할 폴더 고르기',
  },
  en: {
    confirm: 'Confirm',
    cancel: 'Cancel',
    chooseFolder: 'Choose a folder to work in',
  },
});
