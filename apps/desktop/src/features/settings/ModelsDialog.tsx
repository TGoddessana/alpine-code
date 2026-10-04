import type { ConnectionInfo, ConnectionsListResult } from '@alpine/protocol';
import { Dialog, Input } from '@alpine/ui/primitives';
import { useState } from 'react';

import { connectionLabel, connectMessages } from '@/shared/components/connect';
import { useMessages } from '@/shared/i18n';
import { useConnectionModels, useShowModel } from '@/shared/server';

import { messages } from './messages';

/**
 * Which of a connection's models the picker shows. A router lists hundreds, so by default only each family's newest
 * is on (the server decides with the models.dev catalog); every switch here is kept for good.
 */
export function ModelsDialog({
  connection,
  data,
  onClose,
}: {
  connection: ConnectionInfo | null;
  data: ConnectionsListResult;
  onClose: () => void;
}) {
  const t = useMessages(messages);
  const c = useMessages(connectMessages);
  const [query, setQuery] = useState('');
  const [onlyShown, setOnlyShown] = useState(false);
  /** Switches made here, shown at once instead of after the server lists the models again. */
  const [switched, setSwitched] = useState<ReadonlyMap<string, boolean>>(new Map());
  const list = useConnectionModels(connection ? { connection: connection.name } : null);
  const show = useShowModel();
  const models = list.data?.models ?? [];
  const serverHidden = new Set(list.data?.hidden ?? []);
  const hidden = new Set(models.filter((m) => !(switched.get(m) ?? !serverHidden.has(m))));
  const needle = query.trim().toLowerCase();
  const rows = models.filter((m) => m.toLowerCase().includes(needle) && (!onlyShown || !hidden.has(m)));
  const close = () => {
    setQuery('');
    setOnlyShown(false);
    setSwitched(new Map());
    onClose();
  };

  return (
    <Dialog.Root open={connection !== null} onOpenChange={(open) => !open && close()}>
      <Dialog.Popup>
        {connection && (
          <>
            <div className="flex flex-col gap-2">
              <Dialog.Title>{t.modelsTitle(connectionLabel(connection, data.providers, c))}</Dialog.Title>
              <Dialog.Description>{t.modelsLead}</Dialog.Description>
            </div>
            <div className="flex items-center gap-3">
              <Input
                className="grow"
                placeholder={t.findModel}
                aria-label={t.findModel}
                value={query}
                onValueChange={(next) => setQuery(next)}
              />
              <label className="flex shrink-0 items-center gap-1.5 text-meta text-fg-muted">
                <input
                  type="checkbox"
                  className="accent-interactive"
                  checked={onlyShown}
                  onChange={(event) => setOnlyShown(event.target.checked)}
                />
                {t.onlyShown}
              </label>
            </div>
            <p className="text-meta text-fg-muted" role="status">
              {list.isPending ? c.checking : t.shownCount(models.length - hidden.size, models.length)}
            </p>
            <ul className="-mx-2 flex h-80 flex-col overflow-y-auto" aria-label={t.models}>
              {rows.map((model) => (
                <li key={model}>
                  <label className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-body hover:bg-canvas-sunken">
                    <input
                      type="checkbox"
                      className="accent-interactive"
                      checked={!hidden.has(model)}
                      onChange={(event) => {
                        const shown = event.target.checked;
                        setSwitched((before) => new Map(before).set(model, shown));
                        show.mutate({ connection: connection.name, model, shown });
                      }}
                    />
                    <span className="min-w-0 truncate">{model}</span>
                  </label>
                </li>
              ))}
              {!list.isPending && rows.length === 0 && (
                <li className="flex min-h-8 items-center px-2 text-fg-muted">{t.noModel}</li>
              )}
            </ul>
            {(list.error || show.error) && (
              <p role="alert" className="text-meta text-danger">
                {(list.error ?? show.error)?.message}
              </p>
            )}
          </>
        )}
      </Dialog.Popup>
    </Dialog.Root>
  );
}
