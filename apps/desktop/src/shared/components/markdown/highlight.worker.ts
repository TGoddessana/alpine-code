/// <reference lib="webworker" />
import { createCodePlugin, type HighlightResult } from '@streamdown/code';
import { createCssVariablesTheme, type BundledLanguage } from 'shiki';

import type { HighlightAnswer, HighlightQuestion } from './highlight';

/** Colours come from `--code-*` in the tokens, so code follows the app's palette like everything else. */
const theme = createCssVariablesTheme({ name: 'alpine', variablePrefix: '--code-' });
const themes: [typeof theme, typeof theme] = [theme, theme];
/** Shiki with its JavaScript regex engine (no WebAssembly, so the CSP stays as it is); languages load on first use. */
const highlighter = createCodePlugin({ themes });

const answer = (message: HighlightAnswer) => self.postMessage(message);

self.onmessage = ({ data: { key, code, language } }: MessageEvent<HighlightQuestion>) => {
  // Checked just below: a name Shiki does not know is left plain.
  const known = language as BundledLanguage;
  if (!highlighter.supportsLanguage(known)) return answer({ key, tokens: null });
  const send = (result: HighlightResult) => answer({ key, tokens: result.tokens });
  const ready = highlighter.highlight({ code, language: known, themes }, send);
  if (ready) send(ready);
};
