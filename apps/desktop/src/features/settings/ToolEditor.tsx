import type { PackageInfo, ToolsCheckResult, ToolSummary, ToolsTestResult } from '@alpine/protocol';
import { Button, Dialog, Input } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { useState, type ReactNode } from 'react';

import { useFormat, useMessages } from '@/shared/i18n';
import {
  ServerError,
  useCheckTool,
  useConfirmTool,
  useDraftTool,
  useInstallPackages,
  useSaveTool,
  useTestTool,
  useToolSource,
  useTools,
} from '@/shared/server';

import { editorMessages } from './editorMessages';

type Messages = ReturnType<typeof useMessages<typeof editorMessages.ko>>;

const TEMPLATE = `from alpineagents import tool


@tool(read_only=True, open_world=False)
def my_tool(text: str) -> str:
    """What the tool does, in one line.

    Args:
        text: What this value is
    """
    return text
`;

const FILE_NAME = /^[a-z_][a-z0-9_]{0,63}$/;

/**
 * Board ToolCreate: write a tool as one Python function, or have the model draft it; see what the agent will see,
 * try it once, save. Checking and trying run the code; only what is saved here runs in sessions.
 *
 * `name` is `new` for a new file. `onDone` gets the new tool's name when one was added (for the toast), and is
 * also how cancelling leaves.
 */
export function ToolEditor({
  name,
  profile,
  onDone,
}: {
  name: string;
  /** The profile the tools tab showed, where a new tool is turned on. */
  profile?: string;
  onDone: (added?: string) => void;
}) {
  const isNew = name === 'new';
  const existing = useToolSource(isNew ? null : name);
  const initial = isNew ? TEMPLATE : existing.data?.source;
  if (initial === undefined) return null;
  return <Editor name={name} initial={initial} profile={profile} onDone={onDone} />;
}

function Editor({
  name,
  initial,
  profile,
  onDone,
}: {
  name: string;
  initial: string;
  profile?: string;
  onDone: (added?: string) => void;
}) {
  const t = useMessages(editorMessages);
  const isNew = name === 'new';
  const files = useTools().data;
  const file = files?.files.find((f) => f.name === name);
  const [fileName, setFileName] = useState(isNew ? '' : name);
  const [source, setSource] = useState(initial);
  const [checked, setChecked] = useState<{ source: string; result: ToolsCheckResult } | null>(null);
  const [approval, setApproval] = useState<{ packages: PackageInfo[]; then: 'check' | 'save' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const check = useCheckTool();
  const save = useSaveTool();
  const confirm = useConfirmTool();

  const current = checked?.source === source ? checked.result : null;

  const runCheck = async (): Promise<ToolsCheckResult | null> => {
    setError(null);
    const result = await check.mutateAsync(source);
    setChecked({ source, result });
    if (result.needsApproval.length > 0) {
      setApproval({ packages: result.needsApproval, then: 'check' });
      return null;
    }
    return result;
  };

  const runSave = async () => {
    if (!FILE_NAME.test(fileName)) return setError(t.invalidName);
    try {
      const result = current ?? (await runCheck());
      if (result === null) {
        setApproval((a) => (a ? { ...a, then: 'save' } : a));
        return;
      }
      const before = new Set(file?.tools.map((tool) => tool.name));
      const saved = await save.mutateAsync({ name: fileName, source, enableIn: profile });
      onDone(saved.file.tools.find((tool) => !before.has(tool.name))?.name);
    } catch (reason) {
      setError(saveError(reason, t));
    }
  };

  return (
    <div className="flex min-h-0 grow flex-col">
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-line px-6">
        <button type="button" onClick={() => onDone()} className="text-body text-interactive hover:underline">
          {t.back}
        </button>
        <div className="flex min-w-0 grow flex-col">
          <h1 className="truncate text-title">{isNew ? t.newTitle : t.editTitle(name)}</h1>
          <span className="truncate text-meta text-fg-muted">{t.subtitle}</span>
        </div>
        <Button onClick={() => onDone()}>{t.cancel}</Button>
        <Button variant="primary" disabled={save.isPending || check.isPending} onClick={() => void runSave()}>
          {t.save}
        </Button>
      </header>
      <div className="flex min-h-0 grow">
        <div className="flex min-w-0 grow flex-col gap-4 overflow-y-auto px-6 py-5">
          {file?.status === 'unconfirmed' && (
            <div className="flex items-center gap-3 rounded-lg border border-attention bg-canvas-raised px-4 py-3 text-body">
              <span className="grow">{t.unconfirmedBanner}</span>
              <Button onClick={() => confirm.mutate(name)}>{t.confirm}</Button>
            </div>
          )}
          <Draft onDraft={(code) => setSource(code)} />
          {isNew && (
            <div className="flex items-center gap-3 whitespace-nowrap">
              <label htmlFor="tool-file" className="text-meta text-fg-muted">
                {t.fileName}
              </label>
              <div className="w-48">
                <Input
                  id="tool-file"
                  mono
                  value={fileName}
                  placeholder="fetch"
                  onChange={(event) => setFileName(event.target.value)}
                />
              </div>
              <span className="text-meta text-fg-muted">.py · {t.fileNameHint}</span>
            </div>
          )}
          <CodeArea label={t.code} value={source} onChange={setSource} />
          <div className="flex flex-wrap items-center gap-4 text-body">
            <Button onClick={() => void runCheck().catch((reason) => setError(saveError(reason, t)))}>
              {check.isPending ? t.checking : t.check}
            </Button>
            <CheckLine result={current} />
            {current && current.packages.length > 0 && (
              <span className="text-meta text-fg-muted">{t.packages(current.packages.join(', '))}</span>
            )}
            <span className="grow" />
            {files && (
              <span className="font-mono text-meta text-fg-muted">
                {t.location(`${files.folder}/${fileName || '…'}.py`)}
              </span>
            )}
          </div>
          {error && (
            <p role="alert" className="text-body text-danger">
              {error}
            </p>
          )}
        </div>
        <aside
          aria-label={t.agentView}
          className="flex w-100 shrink-0 flex-col gap-6 overflow-y-auto border-l border-line bg-canvas-sunken px-5 py-4"
        >
          <div className="flex flex-col gap-1">
            <h2 className="text-lead">{t.agentView}</h2>
            <span className="text-meta text-fg-muted">{current ? t.agentViewNote : t.agentViewEmpty}</span>
          </div>
          {current?.tools.map((tool) => (
            <AgentView key={tool.name} tool={tool} source={source} />
          ))}
        </aside>
      </div>
      <PackageApproval
        approval={approval}
        onCancel={() => setApproval(null)}
        onInstalled={() => {
          const then = approval?.then;
          setApproval(null);
          setChecked(null);
          if (then === 'save') void runSave();
          else void runCheck();
        }}
      />
    </div>
  );
}

function Draft({ onDraft }: { onDraft: (code: string) => void }) {
  const t = useMessages(editorMessages);
  const draft = useDraftTool();
  const [text, setText] = useState('');
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) draft.mutate(text.trim(), { onSuccess: (result) => onDraft(result.source) });
      }}
    >
      <label htmlFor="tool-ask" className="text-meta text-fg-muted">
        {t.ask}
      </label>
      <div className="flex gap-2">
        <Input id="tool-ask" value={text} placeholder={t.askPlaceholder} onChange={(e) => setText(e.target.value)} />
        <Button type="submit" disabled={draft.isPending || !text.trim()}>
          {draft.isPending ? t.writing : t.write}
        </Button>
      </div>
      {draft.isError && (
        <p role="alert" className="text-meta text-danger">
          {t.draftFailed}
        </p>
      )}
    </form>
  );
}

/** A plain code box with line numbers. It grows with the code, so the numbers and lines scroll together. */
function CodeArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const lines = value.split('\n').length;
  return (
    <div className="flex overflow-hidden rounded-lg border border-line bg-canvas-raised font-mono text-meta">
      <div
        aria-hidden="true"
        className="shrink-0 border-r border-line-subtle bg-canvas-sunken py-3 pr-2 pl-3 text-right whitespace-pre text-fg-faint select-none"
      >
        {Array.from({ length: lines }, (_, i) => i + 1).join('\n')}
      </div>
      <textarea
        aria-label={label}
        value={value}
        rows={lines}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Tab' || event.shiftKey) return;
          event.preventDefault();
          const box = event.currentTarget;
          const { selectionStart: start, selectionEnd: end } = box;
          onChange(value.slice(0, start) + '    ' + value.slice(end));
          requestAnimationFrame(() => box.setSelectionRange(start + 4, start + 4));
        }}
        className="min-w-0 grow resize-none overflow-hidden bg-transparent px-4 py-3 whitespace-pre text-fg outline-none"
      />
    </div>
  );
}

function CheckLine({ result }: { result: ToolsCheckResult | null }) {
  const t = useMessages(editorMessages);
  if (!result) return <span className="text-meta text-fg-muted">{t.unchecked}</span>;
  if (result.error) return <span className="text-danger">● {result.error}</span>;
  if (result.needsApproval.length > 0) return null;
  return <span>{t.loadable}</span>;
}

function AgentView({ tool, source }: { tool: ToolSummary; source: string }) {
  const t = useMessages(editorMessages);
  return (
    <>
      <Group label={t.nameAndDescription}>
        <p className="text-body">
          <span className="font-mono text-meta">{tool.name}</span> · {tool.description}
        </p>
      </Group>
      <Group label={t.params}>
        {tool.params.length === 0 && <span className="text-body text-fg-muted">{t.noParams}</span>}
        {tool.params.map((param) => (
          <div key={param.name} className="grid grid-cols-[96px_56px_minmax(0,1fr)] items-baseline gap-2 text-body">
            <span className="truncate font-mono text-meta">{param.name}</span>
            <span className="text-meta text-fg-muted">{typeLabel(param.type, t)}</span>
            <span>
              {param.description}{' '}
              <span className="text-meta text-fg-muted">
                · {param.required ? t.required : t.defaultValue(JSON.stringify(param.default))}
              </span>
            </span>
          </div>
        ))}
      </Group>
      <Group label={t.whenRun}>
        <span className="text-body">{askLabel(tool, t)[0]}</span>
        <span className="text-meta text-fg-muted">{askLabel(tool, t)[1]}</span>
      </Group>
      <TryIt tool={tool} source={source} />
    </>
  );
}

function TryIt({ tool, source }: { tool: ToolSummary; source: string }) {
  const t = useMessages(editorMessages);
  const test = useTestTool();
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ToolsTestResult | null>(null);
  return (
    <Group label={t.tryIt}>
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          test.mutate({ source, tool: tool.name, args: toArgs(tool, values) }, { onSuccess: setResult });
        }}
      >
        {tool.params.map((param) => (
          <Input
            key={param.name}
            mono
            aria-label={param.name}
            placeholder={param.name}
            value={values[param.name] ?? ''}
            onChange={(event) => setValues({ ...values, [param.name]: event.target.value })}
          />
        ))}
        <Button type="submit" className="self-start" disabled={test.isPending}>
          {test.isPending ? t.running : t.run}
        </Button>
      </form>
      {result && (
        <>
          <span className={clsx('text-body', !result.ok && 'text-danger')}>
            {(result.ok ? t.ok : t.failed)(result.seconds)}
          </span>
          <pre className="max-h-60 overflow-auto rounded-md border border-line bg-canvas-raised px-3 py-2 font-mono text-meta whitespace-pre-wrap text-fg-muted">
            {result.output}
          </pre>
        </>
      )}
    </Group>
  );
}

/** Board ToolPackage: a package Alpine has not reviewed is a risky approval, with what PyPI says about it. */
function PackageApproval({
  approval,
  onCancel,
  onInstalled,
}: {
  approval: { packages: PackageInfo[] } | null;
  onCancel: () => void;
  onInstalled: () => void;
}) {
  const t = useMessages(editorMessages);
  const f = useFormat();
  const install = useInstallPackages();
  const packages = approval?.packages ?? [];
  const names = packages.map((p) => p.name);
  return (
    <Dialog.Root open={approval !== null} onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Popup className="border-danger!" role="alertdialog">
        <div className="flex items-center gap-2 text-meta text-fg-muted">
          <span aria-hidden="true" className="size-2 rounded-full bg-danger" />
          <span className="text-fg">{t.riskyApproval}</span>
          <span>· {t.installPackage}</span>
        </div>
        <Dialog.Title>{t.installTitle(names.join(', '))}</Dialog.Title>
        <Dialog.Description>{t.installBody}</Dialog.Description>
        {packages.map((p) => (
          <dl key={p.name} className="grid grid-cols-[140px_minmax(0,1fr)] gap-y-2 text-body">
            {packages.length > 1 && <dt className="col-span-2 font-mono text-meta">{p.name}</dt>}
            <dt className="text-fg-muted">{t.firstRelease}</dt>
            <dd>{p.firstRelease ?? t.unknown}</dd>
            <dt className="text-fg-muted">{t.downloads}</dt>
            <dd>{p.lastMonthDownloads === null ? t.unknown : f.number(p.lastMonthDownloads)}</dd>
            <dt className="text-fg-muted">{t.similar}</dt>
            <dd className={clsx(p.similar.length > 0 && 'text-danger')}>{p.similar.join(', ') || t.none}</dd>
            <dt className="text-fg-muted">{t.installWay}</dt>
            <dd>{t.installWayValue}</dd>
          </dl>
        ))}
        {install.isError && (
          <p role="alert" className="text-body text-danger">
            {install.error.message || t.installFailed}
          </p>
        )}
        <div
          className="flex justify-end gap-2 pt-2"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.metaKey) install.mutate(names, { onSuccess: onInstalled });
          }}
        >
          <Button onClick={onCancel}>{t.cancel}</Button>
          <Button
            variant="danger"
            disabled={install.isPending}
            onClick={() => install.mutate(names, { onSuccess: onInstalled })}
          >
            {t.install} <span className="rounded-sm border border-on-fill/50 px-1 text-meta">⌘Enter</span>
          </Button>
        </div>
      </Dialog.Popup>
    </Dialog.Root>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-meta text-fg-muted">{label}</h3>
      {children}
    </section>
  );
}

function askLabel(tool: ToolSummary, t: Messages): [string, string] {
  if (tool.ask === 'never') return [t.askNever, t.askNeverWhy];
  if (tool.ask === 'edit') return [t.askEdit, t.askEditWhy];
  return [t.askAsk, t.askAskWhy];
}

function typeLabel(type: string, t: Messages) {
  const labels: Record<string, string> = {
    string: t.typeString,
    integer: t.typeInteger,
    number: t.typeNumber,
    boolean: t.typeBoolean,
    array: t.typeArray,
    object: t.typeObject,
  };
  return labels[type] ?? type;
}

/** Typed arguments from the text boxes: numbers, yes/no and JSON for lists and objects; blanks are left out. */
function toArgs(tool: ToolSummary, values: Record<string, string>) {
  const args: Record<string, unknown> = {};
  for (const param of tool.params) {
    const text = values[param.name]?.trim() ?? '';
    if (!text) continue;
    if (param.type === 'integer' || param.type === 'number') args[param.name] = Number(text);
    else if (param.type === 'boolean') args[param.name] = ['true', 'yes', '1', '예'].includes(text.toLowerCase());
    else if (param.type === 'array' || param.type === 'object') {
      try {
        args[param.name] = JSON.parse(text);
      } catch {
        args[param.name] = text;
      }
    } else args[param.name] = text;
  }
  return args;
}

function saveError(reason: unknown, t: Messages) {
  if (!(reason instanceof ServerError)) return t.saveFailed;
  switch (reason.data?.reason) {
    case 'invalid_name':
      return t.invalidName;
    case 'name_taken':
      return `${t.nameTaken} · ${reason.message}`;
    case 'install_failed':
      return `${t.installFailed} · ${reason.message}`;
    default:
      return `${t.saveFailed} · ${reason.message}`;
  }
}
