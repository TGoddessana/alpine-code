import { cloudScript, type CloudScriptOptions } from './cloudScript';
import { EXAMPLE_MAP, flowScript } from './flowScript';
import { mergeScripts, type Script } from './scripted';

/**
 * Alpine Cloud for the 올리기 sheet in stories and tests: signed in, the product map's evidence for "AI가 확인한 것",
 * and a session that takes the messages "AI에게 고쳐 달라고 하기" sends. Options are `cloudScript`'s.
 */
export const publishServer = (options: CloudScriptOptions = {}): Script =>
  mergeScripts(flowScript(EXAMPLE_MAP), cloudScript({ signedIn: true, publishMs: 250, ...options }), {
    results: { 'session/send': {} },
  });
