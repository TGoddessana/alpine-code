import { describe, expect, it } from 'vitest';

import { terminalText } from './display';

describe('terminalText', () => {
  it('removes styling and hyperlinks without interpreting output as HTML', () => {
    expect(terminalText('\x1b[32mPASS\x1b[0m <script>x</script>')).toBe('PASS <script>x</script>');
    expect(terminalText('\x1b]8;;https://example.com\x07link\x1b]8;;\x07')).toBe('link');
  });
  it('handles carriage return progress, CRLF and backspaces', () => {
    expect(terminalText('10%\r90%\r100%\r\n한글\nabc\bX')).toBe('100%\n한글\nabX');
  });
});
