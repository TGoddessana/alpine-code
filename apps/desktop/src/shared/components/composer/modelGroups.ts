/** One connection's models, as the picker lists them. */
export interface ModelSource {
  name: string;
  label: string;
  models: string[];
}

export interface ModelGroup {
  id: string;
  label: string;
  /** Values `<connection>/<model>` shown now. */
  items: string[];
  /** How many models the connection has; set when the group is folded, so its label can say so. */
  folded: number | null;
}

/** A connection with more models than this shows folded until it is opened or searched. */
export const FOLD_AT = 8;
export const RECENT_GROUP = '#recent';

/**
 * What the model picker shows. With no `query`: the recently used models first, then each connection, big ones
 * folded to just the current model unless `expanded`. With a `query`: every connection's matches, nothing folded.
 */
export function modelGroups({
  sources,
  current,
  recent,
  query,
  expanded,
  recentLabel,
}: {
  sources: ModelSource[];
  current: string | null;
  recent: string[];
  query: string;
  expanded: ReadonlySet<string>;
  recentLabel: string;
}): ModelGroup[] {
  const needle = query.trim().toLowerCase();
  if (needle)
    return sources
      .map((source) => ({
        id: source.name,
        label: source.label,
        items: source.models.filter((m) => m.toLowerCase().includes(needle)).map((m) => `${source.name}/${m}`),
        folded: null,
      }))
      .filter((group) => group.items.length > 0);

  const known = new Set(sources.flatMap((s) => s.models.map((m) => `${s.name}/${m}`)));
  const recentItems = recent.filter((value) => known.has(value)).slice(0, 3);
  const groups: ModelGroup[] = recentItems.length
    ? [{ id: RECENT_GROUP, label: recentLabel, items: recentItems, folded: null }]
    : [];
  for (const source of sources) {
    const all = source.models.map((m) => `${source.name}/${m}`);
    const fold = all.length > FOLD_AT && !expanded.has(source.name);
    groups.push({
      id: source.name,
      label: source.label,
      items: fold ? all.filter((value) => value === current) : all,
      folded: fold ? all.length : null,
    });
  }
  return groups;
}

const RECENT_KEY = 'alpine.recentModels';

/** The models chosen lately on this computer, newest first. Empty when storage is unavailable. */
export function readRecent(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(saved) ? saved.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberRecent(model: string): string[] {
  const next = [model, ...readRecent().filter((v) => v !== model)].slice(0, 5);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // A convenience only: the picker works without it.
  }
  return next;
}
