import type { Terminal } from '@xterm/xterm';

const hangul = /[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7af\ud7b0-\ud7ff]/u;
const modifiers = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);

/**
 * Safari/WKWebView can edit Hangul through insertReplacementText instead of
 * composition events (xtermjs/xterm.js#5704). Keep that preedit local until a
 * syllable boundary or commit. Standard composition, paste and other engines
 * retain xterm's input path. No xterm private APIs or process-output rewriting.
 */
export function installWebKitIme(terminal: Terminal, send: (data: string) => void): () => void {
  const webkit = /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|OPR/.test(navigator.userAgent);
  const parent = terminal.element;
  const textarea = terminal.textarea;
  if (!webkit || !parent || !textarea) return () => {};

  let nativeComposition = false;
  let active = false;
  let start = 0;
  const preview = document.createElement('span');
  preview.className = 'pointer-events-none absolute z-10 hidden bg-canvas font-terminal whitespace-pre text-fg';
  preview.style.fontSize = `${terminal.options.fontSize ?? 13}px`;
  parent.append(preview);

  const position = () => {
    if (!active) return;
    const screen = parent.querySelector<HTMLElement>('.xterm-screen');
    if (!screen) return;
    const buffer = terminal.buffer.active;
    const row = buffer.baseY + buffer.cursorY - buffer.viewportY;
    if (row < 0 || row >= terminal.rows) {
      preview.classList.add('hidden');
      return;
    }
    preview.classList.remove('hidden');
    preview.style.left = `${screen.offsetLeft + (buffer.cursorX * screen.clientWidth) / terminal.cols}px`;
    preview.style.top = `${screen.offsetTop + (row * screen.clientHeight) / terminal.rows}px`;
    preview.style.lineHeight = `${screen.clientHeight / terminal.rows}px`;
  };
  const flush = (clear: boolean) => {
    if (!active) return;
    const text = textarea.value.slice(start).replace(/\u00a0/g, ' ');
    active = false;
    preview.textContent = '';
    preview.classList.add('hidden');
    if (text && !terminal.options.disableStdin) send(text);
    if (clear) textarea.value = '';
  };
  const beforeInput = (event: Event) => {
    const ev = event as InputEvent;
    if (nativeComposition || ev.isComposing || terminal.options.disableStdin) return;
    if ((ev.inputType === 'insertText' || ev.inputType === 'insertReplacementText') && hangul.test(ev.data ?? '')) {
      // A fresh insert starts the next syllable; replacements may change its
      // final consonant or several characters, so read the complete textarea tail.
      if (active && ev.inputType === 'insertText') flush(false);
      if (!active) {
        active = true;
        start = textarea.value.length;
      }
    } else if (active && !ev.inputType.startsWith('delete')) {
      flush(false);
    }
  };
  const input = (event: Event) => {
    const ev = event as InputEvent;
    if (!active || nativeComposition || ev.isComposing) return;
    // Prevent xterm from emitting the first jamo or replaying the textarea.
    // Do not preventDefault: WebKit must finish editing its native preedit.
    ev.stopImmediatePropagation();
    preview.textContent = textarea.value.slice(start);
    if (!preview.textContent) {
      active = false;
      textarea.value = '';
      preview.classList.add('hidden');
    } else {
      position();
    }
  };
  const keyDown = (event: Event) => {
    const ev = event as KeyboardEvent;
    if (nativeComposition || ev.isComposing || terminal.options.disableStdin) return;
    if (ev.keyCode === 229) {
      ev.stopImmediatePropagation();
      return;
    }
    if (!active || modifiers.has(ev.key)) return;
    if (ev.key === 'Backspace') {
      // Let the IME delete from the textarea before considering a PTY Backspace.
      ev.stopImmediatePropagation();
      return;
    }
    flush(true); // Queue the committed text before Enter, arrows, Ctrl+C, etc.
  };
  const keyPress = (event: Event) => {
    if (!nativeComposition && (active || hangul.test((event as KeyboardEvent).key))) {
      event.stopImmediatePropagation();
    }
  };
  const compositionStart = () => {
    // Browsers with normal composition events are handled entirely by xterm.
    flush(true);
    nativeComposition = true;
  };
  const compositionEnd = () => {
    nativeComposition = false;
  };
  const commit = () => flush(true);
  const bindings: [string, EventListener][] = [
    ['beforeinput', beforeInput],
    ['input', input],
    ['keydown', keyDown],
    ['keypress', keyPress],
    ['compositionstart', compositionStart],
    ['compositionend', compositionEnd],
    ['blur', commit],
    ['paste', commit],
  ];
  for (const [name, listener] of bindings) parent.addEventListener(name, listener, true);
  const render = terminal.onRender(position);
  return () => {
    for (const [name, listener] of bindings) parent.removeEventListener(name, listener, true);
    render.dispose();
    preview.remove();
  };
}
