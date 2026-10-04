import { Combobox } from '@alpine/ui/primitives';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { connectionLabel, connectMessages, PlanLine, useConnectPrompt } from '@/shared/components/connect';
import { useMessages } from '@/shared/i18n';
import { useConnections, useModelsOf, useSetDefaultModel, useSetSessionModel } from '@/shared/server';

import { messages } from './messages';
import { modelGroups, readRecent, RECENT_GROUP, rememberRecent, type ModelGroup } from './modelGroups';

const chip =
  'inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-meta font-medium whitespace-nowrap text-fg-muted hover:bg-canvas-sunken hover:text-fg data-popup-open:bg-canvas-sunken';

/**
 * The model the next message goes to. Without `session` that is the model a new session starts with, which is the
 * default model (Settings › Model connection shows the same); with it, that session's model, and choosing switches
 * only that session, whose conversation goes on. A search box on top; a connection with many models (a router) stays
 * folded until opened or searched, and the models chosen lately come first. With nothing connected it offers to
 * connect one.
 */
export function ModelPicker({
  disabled = false,
  session,
}: {
  disabled?: boolean;
  session?: { id: string; model: string };
}) {
  const t = useMessages(messages);
  const c = useMessages(connectMessages);
  const data = useConnections().data;
  const setDefault = useSetDefaultModel();
  const setSessionModel = useSetSessionModel();
  const ask = useConnectPrompt((state) => state.ask);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [recent, setRecent] = useState(readRecent);
  const lists = useModelsOf((data?.connections ?? []).map((connection) => ({ connection: connection.name })));

  const sources = (data?.connections ?? []).map((connection, i) => ({
    name: connection.name,
    label: connectionLabel(connection, data?.providers ?? [], c),
    models: lists[i]?.data?.models ?? [],
  }));
  const current = session ? session.model : (data?.defaultModel ?? null);
  const groups = modelGroups({ sources, current, recent, query, expanded, recentLabel: t.recent });
  const all = groups.flatMap((g) => g.items);

  if (!data) return null;
  if (data.connections.length === 0)
    return (
      <button type="button" disabled={disabled} onClick={ask} className={chip}>
        {t.connectModel}
      </button>
    );

  const choose = (model: string | null) => {
    if (!model || model === current) return;
    if (session) setSessionModel.mutate({ sessionId: session.id, model });
    else setDefault.mutate(model);
    setRecent(rememberRecent(model));
  };

  return (
    <Combobox.Root
      items={all}
      filteredItems={groups}
      value={current}
      onValueChange={(model: string | null) => choose(model)}
      inputValue={query}
      onInputValueChange={setQuery}
      onOpenChange={(open) => {
        if (!open) setQuery('');
      }}
      itemToStringLabel={(model: string) => model.slice(model.indexOf('/') + 1)}
      disabled={disabled}
    >
      <Combobox.Trigger
        className={chip}
        aria-label={(session ? t.sessionModelLabel : t.modelLabel)(current ?? t.chooseModel)}
      >
        <span className="text-fg">{current ? current.slice(current.indexOf('/') + 1) : t.chooseModel}</span>
        <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
      </Combobox.Trigger>
      <Combobox.Popup side="top" align="end" className="max-h-[min(28rem,var(--available-height))] w-80">
        <Combobox.Input placeholder={t.findModel} aria-label={t.findModel} />
        <Combobox.Empty>{query.trim() ? <p className="py-2">{t.noModel}</p> : null}</Combobox.Empty>
        <Combobox.List>
          {(group: ModelGroup) => (
            <Combobox.Group key={group.id} items={group.items} className="pb-1 last:pb-0">
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
              <Combobox.Collection>
                {(model: string) => (
                  <Combobox.Item key={`${group.id}:${model}`} value={model}>
                    <span className="min-w-0 grow truncate">{model.slice(model.indexOf('/') + 1)}</span>
                  </Combobox.Item>
                )}
              </Combobox.Collection>
            </Combobox.Group>
          )}
        </Combobox.List>
        <div className="mt-1 border-t border-line-subtle px-2 pt-1 empty:hidden">
          <PlanLine model={current} />
        </div>
      </Combobox.Popup>
    </Combobox.Root>
  );
}
