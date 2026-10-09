import type { AgentInfo } from '@alpine/protocol';
import { Button, Input } from '@alpine/ui/primitives';
import { useState } from 'react';

import { useMessages } from '@/shared/i18n';
import { useSaveTool, useTools } from '@/shared/server';

import { CheckBar, CodeArea, Draft, FILE_NAME, TEMPLATE, useToolCode } from './code';
import { libraryMessages } from './messages';
import type { LibraryView } from './types';

/**
 * Board 에이전트 화면, 새 사용자 정의 도구: describe the tool or write it, check it, and save it onto the agent
 * being edited. The server turns the new tools on (`enableIn`); the screen is told through `onCreated`.
 */
export function NewTool({
  agent,
  onViewChange,
  onCreated,
}: {
  agent: AgentInfo;
  onViewChange: (view: LibraryView) => void;
  onCreated: (tools: string[], label: string) => void;
}) {
  const t = useMessages(libraryMessages);
  const files = useTools().data?.files;
  const [fileName, setFileName] = useState('');
  const code = useToolCode(TEMPLATE);
  const save = useSaveTool();
  const back = () => onViewChange({ kind: 'list', tab: 'all' });

  const commit = async () => {
    const before = new Set(files?.find((f) => f.name === fileName)?.tools.map((tool) => tool.name));
    const saved = await save.mutateAsync({ name: fileName, source: code.source, enableIn: agent.id });
    const added = saved.file.tools.map((tool) => tool.name).filter((name) => !before.has(name));
    if (added.length === 0) return back();
    onCreated(added, added[0]!);
    onViewChange({ kind: 'tool', file: fileName, tool: added[0]! });
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
        <h2 className="text-display">{t.newTitle}</h2>
        <p className="text-body text-fg-muted">{t.newLead}</p>
      </div>
      <Draft onDraft={code.setSource} />
      <div className="flex items-center gap-3 whitespace-nowrap">
        <label htmlFor="tool-file" className="text-meta text-fg-muted">
          {t.fileName}
        </label>
        <div className="w-48">
          <Input
            id="tool-file"
            mono
            value={fileName}
            placeholder="resize_image"
            onChange={(event) => setFileName(event.target.value)}
          />
        </div>
        <span className="text-meta text-fg-faint">.py · {t.fileNameHint}</span>
      </div>
      <CodeArea label={t.code} value={code.source} onChange={code.setSource} />
      <CheckBar code={code} />
      <div className="flex justify-end gap-2 pt-1">
        <Button onClick={back}>{t.cancel}</Button>
        <Button
          variant="primary"
          disabled={save.isPending || code.checking}
          onClick={() => {
            if (!FILE_NAME.test(fileName)) return code.setError(t.invalidName);
            void code.runSave(commit);
          }}
        >
          {t.saveAndAdd}
        </Button>
      </div>
    </div>
  );
}
