import type { Check, FlowGetResult, Finding } from '@alpine/protocol';

import { messages } from './messages';

type Copy = (typeof messages)['ko'];

/** The checks the sheet knows, in the order it shows them; ids are an open enum, so others follow in their order. */
const KNOWN = ['secret', 'open-api', 'advisor'];

export function sortChecks(checks: Check[]): Check[] {
  const rank = (check: Check) => {
    const index = KNOWN.indexOf(check.id);
    return index === -1 ? KNOWN.length : index;
  };
  return [...checks].sort((a, b) => rank(a) - rank(b));
}

/** The app's own sentence for a finding by its `code`; the server's `fallback` for a code it has no sentence for. */
export function sentence(finding: Finding, t: Copy): string {
  return t.finding(finding.code, finding.params ?? {}) || finding.fallback || t.findingUnknown;
}

/** Where a finding is: `assets/index.js, line 1`, or nothing for one that is about the whole app. */
export function place(finding: Finding, t: Copy): string | null {
  return finding.file ? t.findingAt(finding.file, finding.line ?? null) : null;
}

/** What the AI is sent for findings: the app's sentence, where it is, then the server's English `fix`. */
export function fixMessage(findings: Finding[], t: Copy): string {
  const lines = findings.map((finding) => {
    const at = place(finding, t);
    return `- ${sentence(finding, t)}${at ? ` (${at})` : ''}${finding.fix ? `\n  ${finding.fix}` : ''}`;
  });
  return t.fixMessage(lines.join('\n'));
}

/** The findings of checks that need a look (`attention`) or block. */
export const troubles = (checks: Check[]) =>
  checks
    .filter((check) => check.state === 'attention' || check.state === 'blocked')
    .flatMap((check) => check.findings ?? []);

export interface Evidence {
  passed: number;
  total: number;
  /** Plain sentences of what the AI tried and saw, the signed-out look first (decision 17's fourth item). */
  notes: string[];
}

const SIGNED_OUT = /로그아웃|로그인 안|signed.?out|logged.?out|without (signing|logging) in/i;

/**
 * "AI가 확인한 것" from the product map's evidence records (decision 17): how many promises were tried, and a few
 * sentences of what was seen. Nothing here is checked again; it is what the map already holds.
 */
export function evidenceOf(map: FlowGetResult | undefined): Evidence {
  let passed = 0;
  let total = 0;
  for (const state of Object.values(map?.states ?? {})) {
    passed += state.passed ?? 0;
    total += state.total ?? 0;
  }
  const notes = (map?.document?.nodes ?? [])
    .flatMap((node) => node.checks ?? [])
    .filter((check) => check.result === 'passed')
    .map((check) => check.plain || check.summary);
  const seen = [...new Set(notes)];
  const ordered = [...seen.filter((note) => SIGNED_OUT.test(note)), ...seen.filter((note) => !SIGNED_OUT.test(note))];
  return { passed, total, notes: ordered.slice(0, 3) };
}
