import { expect, it } from 'vitest';

import { editDemoShell } from './demoTerminal';

it('erases a Hangul syllable across both terminal cells without leaving a visual fragment', () => {
  const typed = editDemoShell({ text: '$ ', line: '', exitCode: null }, '한글', '$ ');
  const erased = editDemoShell(typed, '\x7f', '$ ');
  expect(erased.line).toBe('한');
  expect(erased.text).toBe('$ 한글\b\b\x1b[K');
  const cleared = editDemoShell(erased, '\x7f\x7f', '$ ');
  expect(cleared.line).toBe('');
  expect(cleared.text).toBe(erased.text + '\b\b\x1b[K');
});

it('erases an emoji grapheme once and keeps subsequent command input intact', () => {
  const typed = editDemoShell({ text: '$ ', line: '', exitCode: null }, '👩‍💻', '$ ');
  const erased = editDemoShell(typed, '\x7fpwd\r', '$ ', '/sdk');
  expect(erased.line).toBe('');
  expect(erased.text).toContain('👩‍💻\b\b\x1b[Kpwd\r\n/sdk\r\n$ ');
  expect(editDemoShell(erased, 'exit\r', '$ ').exitCode).toBe(0);
});
