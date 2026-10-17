/** Safely render command logs as text. OSC links and terminal control sequences never become HTML. */
export function terminalText(text: string): string {
  // eslint-disable-next-line no-control-regex
  const plain = text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  return plain
    .split('\n')
    .map((line) => {
      let result = '';
      let cursor = 0;
      for (const character of line) {
        if (character === '\r') cursor = 0;
        else if (character === '\b') cursor = Math.max(0, cursor - 1);
        else if (character === '\t' || character >= ' ') {
          result = result.slice(0, cursor) + character + result.slice(cursor + 1);
          cursor++;
        }
      }
      return result;
    })
    .join('\n');
}
