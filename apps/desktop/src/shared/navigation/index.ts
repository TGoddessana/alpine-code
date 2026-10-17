import type { SessionInfo } from '@alpine/protocol';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type RailView = 'all' | 'attention' | 'running' | 'unread' | 'archived';

interface NavigationState {
  expanded: Record<string, boolean>;
  lastSessions: Record<string, string>;
  lastProject: string | null;
  seen: Record<string, string>;
  since: string;
  pinnedProjects: string[];
  sort: 'recent' | 'name';
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  toggleProject: (path: string, currentlyOpen: boolean) => void;
  pinProject: (path: string) => void;
  setSort: (sort: 'recent' | 'name') => void;
  visit: (session: SessionInfo) => void;
  rememberProject: (path: string) => void;
}

/** Local navigation preferences; conversation names, pins and archives belong to the server. */
export const useNavigation = create<NavigationState>()(
  persist(
    (set) => ({
      expanded: {},
      lastSessions: {},
      lastProject: null,
      seen: {},
      since: new Date().toISOString(),
      pinnedProjects: [],
      sort: 'recent',
      searchOpen: false,
      setSearchOpen: (searchOpen) => set({ searchOpen }),
      toggleProject: (path, currentlyOpen) =>
        set((state) => ({ expanded: { ...state.expanded, [path]: !currentlyOpen } })),
      pinProject: (path) =>
        set((state) => ({
          pinnedProjects: state.pinnedProjects.includes(path)
            ? state.pinnedProjects.filter((p) => p !== path)
            : [...state.pinnedProjects, path],
        })),
      setSort: (sort) => set({ sort }),
      visit: (session) =>
        set((state) => ({
          lastProject: session.cwd,
          lastSessions: { ...state.lastSessions, [session.cwd]: session.id },
          seen: { ...state.seen, [session.id]: session.updatedAt },
        })),
      rememberProject: (lastProject) => set({ lastProject }),
    }),
    {
      name: 'alpine.navigation.v1',
      partialize: ({ expanded, lastSessions, lastProject, seen, since, pinnedProjects, sort }) => ({
        expanded,
        lastSessions,
        lastProject,
        seen,
        since,
        pinnedProjects,
        sort,
      }),
    },
  ),
);

export function isUnread(session: SessionInfo, seen: Record<string, string>, since: string) {
  return session.status === 'idle' && !!session.summary && session.updatedAt > (seen[session.id] ?? since);
}

/** Keep important work visible even when the recent list is shortened. */
export function visibleSessions(
  sessions: SessionInfo[],
  currentId: string | undefined,
  all: boolean,
  keep: string[] = [],
) {
  if (all) return sessions;
  const recent = new Set(sessions.slice(0, 5).map((s) => s.id));
  return sessions.filter(
    (s) => recent.has(s.id) || s.id === currentId || s.pinned || s.status !== 'idle' || keep.includes(s.id),
  );
}
