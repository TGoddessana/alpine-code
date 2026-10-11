import type { AgentInfo } from '@alpine/protocol';
import { Button, Dialog } from '@alpine/ui/primitives';
import { useState } from 'react';

import { agentMessages, agentName, Character } from '@/shared/components/agent';
import { useFormat, useMessages } from '@/shared/i18n';
import { useConfirmTool, useDeleteTool, useSaveTool, useToolSource, useTools } from '@/shared/server';

import { cards } from './cards';
import { askLabel, CheckBar, CodeArea, TryIt, useToolCode } from './code';
import { libraryMessages } from './messages';
import { statusLine } from './status';
import type { LibraryView } from './types';

/**
 * Board 에이전트 화면, a tool opened in the library: who has it, what it does when it runs, and its code, which is
 * edited and saved here. Saving checks the code first, so what the badge says is what runs from the next run on.
 */
export function ToolDetail({
  agent,
  agents,
  file,
  tool,
  onViewChange,
  onAdd,
  onRemove,
}: {
  agent: AgentInfo;
  agents: AgentInfo[];
  file: string;
  tool: string;
  onViewChange: (view: LibraryView) => void;
  onAdd: (tools: string[], label: string) => void;
  onRemove: (tools: string[], label: string) => void;
}) {
  const source = useToolSource(file).data?.source;
  // Saving drops the cached source, which would unmount the editor and its '저장했어요'; keep what first arrived.
  const [initial, setInitial] = useState<string>();
  if (source !== undefined && initial === undefined) setInitial(source);
  if (initial === undefined) return null;
  return (
    <Detail
      agent={agent}
      agents={agents}
      file={file}
      tool={tool}
      initial={initial}
      onViewChange={onViewChange}
      onAdd={onAdd}
      onRemove={onRemove}
    />
  );
}

function Detail({
  agent,
  agents,
  file,
  tool,
  initial,
  onViewChange,
  onAdd,
  onRemove,
}: {
  agent: AgentInfo;
  agents: AgentInfo[];
  file: string;
  tool: string;
  initial: string;
  onViewChange: (view: LibraryView) => void;
  onAdd: (tools: string[], label: string) => void;
  onRemove: (tools: string[], label: string) => void;
}) {
  const t = useMessages(libraryMessages);
  const a = useMessages(agentMessages);
  const f = useFormat();
  const tools = useTools().data;
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const code = useToolCode(initial, () => setSaved(false));
  const save = useSaveTool();
  const confirm = useConfirmTool();
  const remove = useDeleteTool();

  const info = tools?.files.find((x) => x.name === file);
  const card = tools ? cards(tools, agent, agents, (x) => agentName(x, a)).find((c) => c.tool === tool) : undefined;
  const summary = info?.tools.find((x) => x.name === tool);
  const tried = code.current?.tools.find((x) => x.name === tool) ?? summary;
  const back = () => onViewChange({ kind: 'list', tab: 'all' });
  const [when, why] = summary ? askLabel(summary, t) : [null, null];
  const name = agentName(agent, a);

  const commit = async () => {
    await save.mutateAsync({ name: file, source: code.source });
    setSaved(true);
  };

  return (
    <div className="flex flex-col gap-4 px-5 pt-4 pb-6">
      <button
        type="button"
        onClick={back}
        className="-ml-2 cursor-pointer self-start rounded-md px-2 py-1 text-body text-fg-muted hover:bg-canvas-sunken"
      >
        {t.back}
      </button>
      <div className="flex flex-col gap-1">
        <span className="text-meta text-fg-faint">{t.detailKicker}</span>
        <h2 className="text-display">{tool}</h2>
        <p className="text-body text-fg-muted">
          {card && card.status !== 'ready' ? statusLine(card, t, f.since) : card?.does}
        </p>
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-line bg-canvas-raised p-3">
        <Character look={agent.look} color={agent.color} size={32} />
        <div className="flex min-w-0 grow flex-col">
          <span className="text-body">{card?.added ? t.inAgent(name) : t.notInAgent(name)}</span>
          <span className="text-meta text-fg-faint">
            {card && card.usedBy.length > 0 ? t.others(card.usedBy.join(', ')) : t.noOthers}
          </span>
        </div>
        {card?.status === 'ready' &&
          (card.added ? (
            <Button onClick={() => onRemove([tool], tool)}>{t.remove}</Button>
          ) : (
            <Button variant="primary" onClick={() => onAdd([tool], tool)}>
              {t.addShort}
            </Button>
          ))}
      </div>

      {when && (
        <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-body">
          <dt className="text-fg-faint">{t.whenRun}</dt>
          <dd>
            {when}
            <span className="block text-meta text-fg-muted">{why}</span>
          </dd>
          <dt className="text-fg-faint">{t.file}</dt>
          <dd className="font-mono text-meta">{file}.py</dd>
        </dl>
      )}

      {info?.status === 'unconfirmed' && (
        <div className="flex items-center gap-3 rounded-lg border border-attention bg-canvas-raised px-4 py-3 text-body">
          <span className="grow">{t.unconfirmedBanner}</span>
          <Button onClick={() => confirm.mutate(file)}>{t.confirm}</Button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-line">
        <div className="flex min-h-10 items-center gap-2 border-b border-line bg-canvas-sunken py-1.5 pr-2 pl-3">
          <span className="grow text-meta text-fg-muted">{t.codeHeading}</span>
          <Button disabled={save.isPending || code.checking} onClick={() => void code.runSave(commit)}>
            {save.isPending ? t.saving : t.save}
          </Button>
        </div>
        {saved && (
          <div
            role="status"
            className="border-b border-line-subtle bg-canvas-raised px-3 py-1.5 text-meta text-interactive"
          >
            {t.savedStatus}
          </div>
        )}
        <CodeArea label={t.code} value={code.source} onChange={code.setSource} />
      </div>
      <CheckBar code={code} />

      {tried && <TryIt key={tried.name} tool={tried} source={code.source} />}

      <div className="pt-1">
        <Button className="border-transparent bg-transparent text-danger" onClick={() => setDeleting(true)}>
          {t.deleteFromLibrary}
        </Button>
      </div>
      <Dialog.Root open={deleting} onOpenChange={setDeleting}>
        <Dialog.Popup size="sm">
          <Dialog.Title>{t.deleteTitle(`${file}.py`)}</Dialog.Title>
          <Dialog.Description>{t.deleteBody}</Dialog.Description>
          <div className="flex justify-end gap-2 pt-2">
            <Dialog.Close render={<Button />}>{t.cancel}</Dialog.Close>
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate(file, { onSuccess: () => (setDeleting(false), back()) })}
            >
              {t.delete}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Root>
    </div>
  );
}
