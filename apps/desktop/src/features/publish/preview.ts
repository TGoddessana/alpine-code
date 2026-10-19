/**
 * Stand-ins for the checks and the publish that Alpine Cloud will run (docs/alpine-cloud.md, decisions 14, 15 and 17),
 * so the sheet can be seen in Storybook first.
 */

export type CheckState = 'running' | 'ok' | 'attention' | 'blocked';

export interface Check {
  id: 'secret' | 'open-api' | 'logged-out' | 'phishing';
  state: CheckState;
}

/** clean: all fine. warning: one finding to look at. secret: a key in the page code blocks it. drop: a column goes. */
export type Scenario = 'clean' | 'warning' | 'secret' | 'drop';

export type PublishStep = 'restore' | 'files' | 'shape';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ORDER: Check['id'][] = ['secret', 'open-api', 'logged-out', 'phishing'];

/** Runs the checks one after another, reporting each as it settles. */
export async function runChecks(scenario: Scenario, onChange: (checks: Check[]) => void) {
  let checks: Check[] = ORDER.map((id) => ({ id, state: 'running' }));
  onChange(checks);
  for (const id of ORDER) {
    await wait(id === 'logged-out' ? 1100 : 450);
    const state: CheckState =
      id === 'secret' && scenario === 'secret'
        ? 'blocked'
        : id === 'open-api' && scenario === 'warning'
          ? 'attention'
          : 'ok';
    checks = checks.map((check) => (check.id === id ? { ...check, state } : check));
    onChange(checks);
  }
}

export async function runPublish(onStep: (step: PublishStep, progress: number) => void) {
  onStep('restore', 0.15);
  await wait(700);
  onStep('files', 0.55);
  await wait(1100);
  onStep('shape', 0.85);
  await wait(700);
  onStep('shape', 1);
  await wait(250);
}
