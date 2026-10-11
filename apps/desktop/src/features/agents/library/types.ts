export type LibraryTab = 'all' | 'tool' | 'skill' | 'mcp' | 'sub';

export type LibraryView =
  { kind: 'list'; tab: LibraryTab } | { kind: 'tool'; file: string; tool: string } | { kind: 'new-tool' };

/** The card being dragged, so the agent's side can say what dropping it does. */
export type DraggedTool = { tool: string; label: string };
