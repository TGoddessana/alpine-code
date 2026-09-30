import { Menu } from '@alpine/ui/primitives';
import { Fragment } from 'react';

import { connectionLabel, connectMessages, useConnectPrompt } from '@/shared/components/connect';
import { useMessages } from '@/shared/i18n';
import { useConnections, useModelsOf, useSetDefaultModel } from '@/shared/server';

import { messages } from './messages';

const chip =
  'inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-meta whitespace-nowrap text-fg-muted hover:bg-canvas-sunken hover:text-fg data-popup-open:bg-canvas-sunken';

/**
 * The model a new session starts with, which is the default model (Settings › Model connection shows the same).
 * With nothing connected it offers to connect one.
 */
export function ModelPicker({ disabled = false }: { disabled?: boolean }) {
  const t = useMessages(messages);
  const c = useMessages(connectMessages);
  const data = useConnections().data;
  const setDefault = useSetDefaultModel();
  const ask = useConnectPrompt((state) => state.ask);
  const lists = useModelsOf(
    (data?.connections ?? []).map((connection) =>
      connection.provider ? { provider: connection.provider } : { baseUrl: connection.baseUrl ?? '' },
    ),
  );
  if (!data) return null;
  if (data.connections.length === 0)
    return (
      <button type="button" disabled={disabled} onClick={ask} className={chip}>
        {t.connectModel}
      </button>
    );

  const current = data.defaultModel;
  return (
    <Menu.Root>
      <Menu.Trigger disabled={disabled} className={chip} aria-label={t.modelLabel(current ?? t.chooseModel)}>
        <span className="text-fg">{current ? current.slice(current.indexOf('/') + 1) : t.chooseModel}</span>
        <Chevron />
      </Menu.Trigger>
      <Menu.Popup side="top" align="end" className="max-h-100 w-72 overflow-y-auto">
        <Menu.RadioGroup value={current ?? ''} onValueChange={(model: string) => setDefault.mutate(model)}>
          {data.connections.map((connection, i) => (
            <Fragment key={connection.name}>
              <div className="flex min-h-7 items-center px-2 text-meta text-fg-muted">
                {connectionLabel(connection, data.providers, c)}
              </div>
              {(lists[i]?.data?.models ?? []).map((model) => (
                <Menu.RadioItem key={model} value={`${connection.name}/${model}`}>
                  <span className="min-w-0 grow truncate">{model}</span>
                </Menu.RadioItem>
              ))}
            </Fragment>
          ))}
        </Menu.RadioGroup>
      </Menu.Popup>
    </Menu.Root>
  );
}

function Chevron() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 4l2.5 2.5L7.5 4" />
    </svg>
  );
}
