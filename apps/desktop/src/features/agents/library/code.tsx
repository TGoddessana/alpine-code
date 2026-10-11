import type { PackageInfo, ToolsCheckResult, ToolSummary, ToolsTestResult } from '@alpine/protocol';
import { Button, Dialog, Input } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { useRef, useState, type ReactNode } from 'react';

import { useFormat, useMessages } from '@/shared/i18n';
import { ServerError, useCheckTool, useDraftTool, useInstallPackages, useTestTool } from '@/shared/server';

import { libraryMessages } from './messages';

export type Messages = ReturnType<typeof useMessages<typeof libraryMessages.ko>>;

export const TEMPLATE = `from alpineagents import tool


@tool(read_only=True, open_world=False)
def my_tool(text: str) -> str:
    """What the tool does, in one line.

    Args:
        text: What this value is
    """
    return text
`;

export const FILE_NAME = /^[a-z_][a-z0-9_]{0,63}$/;

/**
 * The code being edited and the steps before it is saved: check it (which runs it), approve a package Alpine has
 * not reviewed, then `commit`. A check that found an error stops the save; the check line shows why.
 */
export function useToolCode(initial: string, onEdit?: () => void) {
  const t = useMessages(libraryMessages);
  const [source, setSource] = useState(initial);
  const [checked, setChecked] = useState<{ source: string; result: ToolsCheckResult } | null>(null);
  const [approval, setApproval] = useState<{ packages: PackageInfo[]; then: 'check' | 'save' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<(() => Promise<void>) | null>(null);
  const check = useCheckTool();

  const current = checked?.source === source ? checked.result : null;
  const usable = current && current.needsApproval.length === 0 ? current : null;

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

  const runSave = async (commit: () => Promise<void>) => {
    try {
      const result = usable ?? (await runCheck());
      if (result === null) {
        pending.current = commit;
        setApproval((a) => (a ? { ...a, then: 'save' } : a));
        return;
      }
      if (result.error) return;
      await commit();
    } catch (reason) {
      setError(saveError(reason, t));
    }
  };

  return {
    source,
    setSource: (next: string) => {
      setSource(next);
      onEdit?.();
    },
    current,
    checking: check.isPending,
    check: () => void runCheck().catch((reason) => setError(saveError(reason, t))),
    runSave,
    approval,
    cancelApproval: () => setApproval(null),
    installed: () => {
      const then = approval?.then;
      setApproval(null);
      setChecked(null);
      if (then === 'save' && pending.current) void runSave(pending.current);
      else void runCheck();
    },
    error,
    setError,
  };
}

type ToolCode = ReturnType<typeof useToolCode>;

/** The check button, what it found, and the approval dialog that can follow it. */
export function CheckBar({ code }: { code: ToolCode }) {
  const t = useMessages(libraryMessages);
  const { current } = code;
  return (
    <>
      <div className="flex flex-wrap items-center gap-4 text-body">
        <Button onClick={code.check}>{code.checking ? t.checking : t.check}</Button>
        <CheckLine result={current} />
        {current && current.packages.length > 0 && (
          <span className="text-meta text-fg-muted">{t.packages(current.packages.join(', '))}</span>
        )}
      </div>
      {code.error && (
        <p role="alert" className="text-body text-danger">
          {code.error}
        </p>
      )}
      <PackageApproval approval={code.approval} onCancel={code.cancelApproval} onInstalled={code.installed} />
    </>
  );
}

function CheckLine({ result }: { result: ToolsCheckResult | null }) {
  const t = useMessages(libraryMessages);
  if (!result) return <span className="text-meta text-fg-muted">{t.unchecked}</span>;
  if (result.error) return <span className="text-danger">● {result.error}</span>;
  if (result.needsApproval.length > 0) return null;
  return <span>{t.loadable}</span>;
}

/** A plain code box with line numbers. It grows with the code, so the numbers and lines scroll together. */
export function CodeArea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
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

/** Describe the tool in words; the model writes the code. Nothing runs or is saved. */
export function Draft({ onDraft }: { onDraft: (code: string) => void }) {
  const t = useMessages(libraryMessages);
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
      <label htmlFor="tool-ask" className="text-body">
        {t.ask}
      </label>
      <Input id="tool-ask" value={text} placeholder={t.askPlaceholder} onChange={(e) => setText(e.target.value)} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={draft.isPending || !text.trim()}>
          {draft.isPending ? t.writing : t.write}
        </Button>
        <span className="text-meta text-fg-faint">{t.askNote}</span>
      </div>
      {draft.isError && (
        <p role="alert" className="text-meta text-danger">
          {t.draftFailed}
        </p>
      )}
    </form>
  );
}

/** Runs the code once with values typed here, so a tool can be tried before the agent uses it. */
export function TryIt({ tool, source }: { tool: ToolSummary; source: string }) {
  const t = useMessages(libraryMessages);
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
  const t = useMessages(libraryMessages);
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

export function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-meta text-fg-muted">{label}</h3>
      {children}
    </section>
  );
}

export function askLabel(tool: ToolSummary, t: Messages): [string, string] {
  if (tool.ask === 'never') return [t.askNever, t.askNeverWhy];
  if (tool.ask === 'edit') return [t.askEdit, t.askEditWhy];
  return [t.askAsk, t.askAskWhy];
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

export function saveError(reason: unknown, t: Messages) {
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
