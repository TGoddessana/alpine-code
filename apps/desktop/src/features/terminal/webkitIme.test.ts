import type { Terminal } from '@xterm/xterm';
import { afterEach, expect, it, vi } from 'vitest';

import { installWebKitIme } from './webkitIme';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.unstubAllGlobals();
});

function setup(webkit = true) {
  vi.stubGlobal('navigator', {
    userAgent: webkit ? 'AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15' : 'AppleWebKit/537.36 Chrome/131',
  });
  const parent = document.createElement('div');
  const textarea = document.createElement('textarea');
  parent.append(textarea);
  document.body.append(parent);
  const sent: string[] = [];
  const nativeInputs: string[] = [];
  const keys: string[] = [];
  const keypresses: string[] = [];
  const terminal = {
    element: parent,
    textarea,
    options: { fontSize: 13, disableStdin: false },
    onRender: () => ({ dispose() {} }),
  } as unknown as Terminal;
  const dispose = installWebKitIme(terminal, (data) => sent.push(data));
  // Represent xterm's own listeners, registered on the textarea.
  textarea.addEventListener('keypress', (event) => keypresses.push(event.key), true);
  textarea.addEventListener('input', (event) => nativeInputs.push((event as InputEvent).data ?? ''), true);
  textarea.addEventListener(
    'keydown',
    (event) => {
      keys.push(event.key);
      if (event.key === 'Enter') sent.push('\r');
    },
    true,
  );
  const key = (key: string, keyCode = 229) =>
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true }));
  const edit = (data: string, value: string, inputType = 'insertReplacementText', isComposing = false) => {
    textarea.dispatchEvent(
      new InputEvent('beforeinput', { data, inputType, isComposing, bubbles: true, composed: true }),
    );
    textarea.value = value;
    textarea.dispatchEvent(new InputEvent('input', { data, inputType, isComposing, bubbles: true, composed: true }));
  };
  cleanups.push(() => {
    dispose();
    parent.remove();
  });
  return { sent, nativeInputs, keys, keypresses, key, edit, textarea, dispose };
}

it('commits complete Hangul syllables before Enter rather than emitting the initial jamo', () => {
  const app = setup();
  app.key('Process');
  app.textarea.dispatchEvent(new KeyboardEvent('keypress', { key: 'ㅎ', bubbles: true }));
  app.edit('ㅎ', 'ㅎ', 'insertText');
  app.edit('하', '하');
  app.edit('한', '한');
  expect(app.sent).toEqual([]);
  app.edit('ㄱ', '한ㄱ', 'insertText');
  app.edit('그', '한그');
  app.edit('글', '한글');
  app.key('Enter', 13);
  expect(app.sent.join('')).toBe('한글\r');
  expect(app.nativeInputs).toEqual([]);
  expect(app.keys).toEqual(['Enter']);
  expect(app.keypresses).toEqual([]);
});

it('keeps Shift and Backspace within the preedit, then commits the edited syllable', () => {
  const app = setup();
  app.edit('ㅅ', 'ㅅ', 'insertText');
  app.key('Shift', 16);
  app.edit('ㅆ', 'ㅆ');
  app.edit('싸', '싸');
  app.key('Backspace', 8);
  app.edit('', 'ㅆ', 'deleteContentBackward');
  expect(app.sent).toEqual([]);
  expect(app.keys).toEqual(['Shift']);
  app.key('Enter', 13);
  expect(app.sent.join('')).toBe('ㅆ\r');
});

it('returns Backspace to xterm when the entire preedit has been deleted', () => {
  const app = setup();
  app.edit('ㅎ', 'ㅎ', 'insertText');
  app.edit('', '', 'deleteContentBackward');
  app.key('Backspace', 8);
  expect(app.keys).toEqual(['Backspace']);
  expect(app.sent).toEqual([]);
});

it('preserves standard composition and Chromium input paths', () => {
  const app = setup();
  app.textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  app.edit('한', '한', 'insertCompositionText', true);
  app.textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  expect(app.sent).toEqual([]);
  expect(app.nativeInputs).toEqual(['한']);
  const chrome = setup(false);
  chrome.edit('한', '한', 'insertText');
  expect(chrome.nativeInputs).toEqual(['한']);
  expect(chrome.sent).toEqual([]);
});

it('commits once before paste and detaches its listeners on disposal', () => {
  const app = setup();
  app.edit('ㅎ', 'ㅎ', 'insertText');
  app.edit('한', '한');
  app.textarea.dispatchEvent(new Event('paste', { bubbles: true }));
  expect(app.sent).toEqual(['한']);
  app.dispose();
  app.edit('글', '글', 'insertText');
  expect(app.sent).toEqual(['한']);
  expect(app.nativeInputs).toEqual(['글']);
});
