import { Combobox, LinkButton } from '@alpine/ui/primitives';
import { useNavigate } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { shortModel } from '@/shared/components/agent';
import { connectionLabel, connectMessages, PlanLine, useConnectPrompt } from '@/shared/components/connect';
import { useMessages } from '@/shared/i18n';
import { shownModels, useConnections, useModelsOf } from '@/shared/server';

import { messages } from './messages';
import { modelGroups, readRecent, RECENT_GROUP, rememberRecent, type ModelGroup } from './modelGroups';

const chip =
  'inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-meta font-medium whitespace-nowrap text-fg-muted hover:bg-canvas-sunken hover:text-fg data-popup-open:bg-canvas-sunken';

/** Stands for "the default model" in the list; the picker's `value` and `onChange` use null for it. */
const DEFAULT_ITEM = '#default';
const DEFAULT_GROUP = '#default-group';

/**
 * A model to choose, controlled: `value` is `<connection>/<model>`, and `onChange` gets the pick (the caller saves
 * it: an agent's model, a new agent's). With `allowDefault` the first item is the default model (null: whatever
 * Settings › Model connection has set), shown with its name. `label` replaces the text on the trigger. A search box
 * on top; a connection with many models (a router) stays folded until opened or searched, and the models chosen
 * lately come first. With nothing connected it offers to connect one.
 */
export function ModelPicker({
  value,
  onChange,
  disabled = false,
  allowDefault = false,
  label,
}: {
  value: string | null;
  onChange: (model: string | null) => void;
  disabled?: boolean;
  allowDefault?: boolean;
  label?: string;
}) {
  const t = useMessages(messages);
  const c = useMessages(connectMessages);
  const data = useConnections().data;
  const ask = useConnectPrompt((state) => state.ask);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [recent, setRecent] = useState(readRecent);
  const navigate = useNavigate();
  const lists = useModelsOf((data?.connections ?? []).map((connection) => ({ connection: connection.name })));

  const defaultModel = data?.defaultModel ?? null;
  const defaultText = defaultModel ? t.defaultModel(shortModel(defaultModel)) : t.defaultModelPlain;
  const sources = (data?.connections ?? []).map((connection, i) => ({
    name: connection.name,
    label: connectionLabel(connection, data?.providers ?? [], c),
    models: shownModels(lists[i]?.data, [
      value?.startsWith(`${connection.name}/`) ? value.slice(connection.name.length + 1) : null,
    ]),
  }));
  const found = modelGroups({ sources, current: value, recent, query, expanded, recentLabel: t.recent });
  const groups: ModelGroup[] =
    allowDefault && !query.trim()
      ? [{ id: DEFAULT_GROUP, label: '', items: [DEFAULT_ITEM], folded: null }, ...found]
      : found;
  const all = groups.flatMap((g) => g.items);
  const selected = value ?? (allowDefault ? DEFAULT_ITEM : null);
  const text = (item: string) => (item === DEFAULT_ITEM ? defaultText : shortModel(item));

  if (!data) return null;
  if (data.connections.length === 0)
    return (
      <button type="button" disabled={disabled} onClick={ask} className={chip}>
        {t.connectModel}
      </button>
    );

  const choose = (item: string | null) => {
    if (!item || item === selected) return;
    if (item === DEFAULT_ITEM) return onChange(null);
    onChange(item);
    setRecent(rememberRecent(item));
  };

  return (
    <Combobox.Root
      items={all}
      filteredItems={groups}
      value={selected}
      onValueChange={(model: string | null) => choose(model)}
      inputValue={query}
      onInputValueChange={setQuery}
      onOpenChange={(open) => {
        if (!open) setQuery('');
      }}
      itemToStringLabel={text}
      disabled={disabled}
    >
      <Combobox.Trigger
        className={chip}
        aria-label={t.modelLabel(label ?? (selected ? text(selected) : t.chooseModel))}
      >
        <span className="text-fg">{label ?? (selected ? text(selected) : t.chooseModel)}</span>
        <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
      </Combobox.Trigger>
      <Combobox.Popup side="top" align="end" className="max-h-[min(28rem,var(--available-height))] w-80">
        <Combobox.Input placeholder={t.findModel} aria-label={t.findModel} />
        <Combobox.Empty>{query.trim() ? <p className="py-2">{t.noModel}</p> : null}</Combobox.Empty>
        <Combobox.List>
          {(group: ModelGroup) => (
            <Combobox.Group key={group.id} items={group.items} className="pb-1 last:pb-0">
              {group.label && (
                <Combobox.GroupLabel>
                  <span className="min-w-0 grow truncate">{group.label}</span>
                  {group.folded !== null && group.id !== RECENT_GROUP && (
                    <button
                      type="button"
                      className="shrink-0 cursor-pointer rounded-sm px-1 text-interactive hover:underline"
                      aria-label={t.showAll(group.folded)}
                      onClick={() => setExpanded((open) => new Set(open).add(group.id))}
                    >
                      {t.modelCount(group.folded)} ›
                    </button>
                  )}
                </Combobox.GroupLabel>
              )}
              <Combobox.Collection>
                {(model: string) => (
                  <Combobox.Item key={`${group.id}:${model}`} value={model}>
                    <span className="min-w-0 grow truncate">{text(model)}</span>
                  </Combobox.Item>
                )}
              </Combobox.Collection>
            </Combobox.Group>
          )}
        </Combobox.List>
        <div className="mt-1 flex items-center gap-2 border-t border-line-subtle px-2 pt-1">
          <span className="min-w-0 grow">
            <PlanLine model={value ?? defaultModel} />
          </span>
          <LinkButton
            className="shrink-0"
            onClick={() => void navigate({ to: '/settings', search: { tab: 'connection' } })}
          >
            {t.manageModels} ›
          </LinkButton>
        </div>
      </Combobox.Popup>
    </Combobox.Root>
  );
}
