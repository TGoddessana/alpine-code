export type LibraryTab = 'skill' | 'mcp' | 'sub';

export type LibraryView = { kind: 'list'; tab: LibraryTab } | { kind: 'skill'; name: string } | { kind: 'new-skill' };

/** What the library reports about skills; the screen saves the agent and tells about it. */
export interface SkillActions {
  /** Turns a skill on or off in the agent being edited. `label` is how the skill is called on screen. */
  onToggle: (name: string, on: boolean, label: string) => void;
  /** Skills were installed; `fresh` were not there before (the others were fetched again). */
  onInstalled: (names: string[], fresh: string[], label: string) => void;
}
