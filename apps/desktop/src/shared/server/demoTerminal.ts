/** Line editing for Storybook's simulated PTY. Production uses the shell's own editor. */
export interface DemoShellState {
  text: string;
  line: string;
  exitCode: number | null;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const wide =
  /[\u1100-\u115f\u2329-\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff01-\uff60\uffe0-\uffe6]|\p{Extended_Pictographic}/u;

export function editDemoShell(
  previous: DemoShellState,
  data: string,
  prompt: string,
  cwd = '/project',
): DemoShellState {
  const state = { ...previous };
  for (const char of data) {
    if (char === '\x7f' || char === '\b') {
      const last = [...graphemes.segment(state.line)].at(-1)?.segment;
      if (last) {
        state.line = state.line.slice(0, -last.length);
        state.text += '\b'.repeat(wide.test(last) ? 2 : 1) + '\x1b[K';
      }
    } else if (char === '\r' || char === '\n') {
      const exit = /^exit(?:\s+(-?\d+))?$/.exec(state.line.trim());
      state.text += '\r\n';
      if (exit) {
        state.exitCode = Number(exit[1] ?? 0);
        state.line = '';
        break;
      }
      if (state.line === 'pwd') state.text += cwd + '\r\n';
      state.text += prompt;
      state.line = '';
    } else if (char === '\x03') {
      state.text += '^C\r\n' + prompt;
      state.line = '';
    } else {
      state.line += char;
      state.text += char;
    }
  }
  return state;
}
