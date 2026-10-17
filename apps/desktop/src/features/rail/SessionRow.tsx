import type { SessionInfo } from '@alpine/protocol';
import { Button, ContextMenu, Dialog, Input, Menu } from '@alpine/ui/primitives';
import { Link } from '@tanstack/react-router';
import clsx from 'clsx';
import { Archive, Ellipsis, Pin, RotateCcw } from 'lucide-react';
import { useState } from 'react';

import { StatusWord } from '@/shared/components/status';
import { useFormat, useMessages } from '@/shared/i18n';
import { isUnread, useNavigation } from '@/shared/navigation';
import { useSetSessionDetails } from '@/shared/server';

import { messages } from './messages';

export function SessionRow({
  session,
  onDelete,
  onArchive,
}: {
  session: SessionInfo;
  onDelete: (session: SessionInfo) => void;
  onArchive: (session: SessionInfo) => void;
}) {
  const t = useMessages(messages);
  const format = useFormat();
  const seen = useNavigation((s) => s.seen);
  const since = useNavigation((s) => s.since);
  const unread = isUnread(session, seen, since);
  const update = useSetSessionDetails();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const title = session.title || t.untitledSession;
  const busy = session.status === 'running' || session.status === 'waiting';
  const activity = session.activity;
  const detail =
    activity?.kind === 'running_tool'
      ? t.toolActivity(activity.toolName ?? '')
      : activity?.kind === 'thinking'
        ? t.thinking
        : activity?.kind === 'writing'
          ? t.writing
          : activity?.kind === 'reviewing'
            ? t.reviewing
            : activity?.kind === 'compacting'
              ? t.compacting
              : session.summary;
  const items = (
    <>
      <Menu.Item
        disabled={update.isPending}
        onClick={() => update.mutate({ sessionId: session.id, pinned: !session.pinned })}
      >
        <Pin size={14} aria-hidden="true" />
        {session.pinned ? t.unpin : t.pin}
      </Menu.Item>
      <Menu.Item
        onClick={() => {
          setName(title);
          setRenaming(true);
        }}
      >
        {t.rename}
      </Menu.Item>
      <Menu.Item
        disabled={busy || update.isPending}
        title={busy ? t.busyArchive : undefined}
        onClick={() => onArchive(session)}
      >
        {session.archived ? <RotateCcw size={14} aria-hidden="true" /> : <Archive size={14} aria-hidden="true" />}
        {session.archived ? t.restore : t.archive}
      </Menu.Item>
      <Menu.Separator />
      <Menu.Item className="text-danger" onClick={() => onDelete(session)}>
        {t.deleteSession}
      </Menu.Item>
    </>
  );

  return (
    <>
      <div className={clsx('group relative rounded-lg hover:bg-hover', menuOpen && 'bg-hover')}>
        <ContextMenu.Root>
          <ContextMenu.Trigger
            render={<Link to="/session/$sessionId" params={{ sessionId: session.id }} />}
            className="flex min-h-10 w-full cursor-pointer flex-col gap-0.5 rounded-lg py-1.5 pr-8 pl-2 text-left text-body text-fg-muted outline-none hover:bg-transparent focus-visible:ring-2 focus-visible:ring-interactive data-[status=active]:bg-selected data-[status=active]:text-fg"
            title={[title, detail].filter(Boolean).join('\n')}
          >
            <span className="flex w-full min-w-0 items-center gap-1.5">
              {unread && <span aria-label={t.unreadLabel} className="size-1.5 shrink-0 rounded-full bg-interactive" />}
              <span className={clsx('min-w-0 grow truncate', unread && 'font-semibold text-fg')}>{title}</span>
              {session.pinned && <Pin size={12} aria-label={t.pinned} className="shrink-0 text-interactive" />}
            </span>
            <span className="flex w-full min-w-0 items-center gap-2 text-meta">
              {session.status !== 'idle' ? (
                <StatusWord status={session.status} />
              ) : session.archived ? (
                <span className="shrink-0">{t.archived}</span>
              ) : unread ? (
                <span className="shrink-0 text-interactive">{t.unread}</span>
              ) : (
                <span className="shrink-0 text-fg-faint">{format.since(new Date(session.updatedAt))}</span>
              )}
              {detail && <span className="min-w-0 truncate text-fg-faint">{detail}</span>}
            </span>
          </ContextMenu.Trigger>
          <ContextMenu.Popup aria-label={t.sessionMenu(title)}>{items}</ContextMenu.Popup>
        </ContextMenu.Root>
        <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <Menu.Trigger
            aria-label={t.sessionMenu(title)}
            className="absolute top-1.5 right-1 inline-flex size-6 cursor-pointer items-center justify-center rounded-sm text-fg-muted opacity-0 hover:bg-line hover:text-fg focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 data-popup-open:bg-line data-popup-open:opacity-100"
          >
            <Ellipsis size={16} aria-hidden="true" />
          </Menu.Trigger>
          <Menu.Popup align="end">{items}</Menu.Popup>
        </Menu.Root>
        {update.error && !renaming && (
          <p role="alert" className="px-2 text-meta text-danger">
            {update.error.message}
          </p>
        )}
      </div>
      <Dialog.Root open={renaming} onOpenChange={setRenaming}>
        <Dialog.Popup size="sm">
          <Dialog.Title>{t.renameTitle}</Dialog.Title>
          <Dialog.Description>{t.renameHint}</Dialog.Description>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim() && !update.isPending)
                update.mutate({ sessionId: session.id, title: name.trim() }, { onSuccess: () => setRenaming(false) });
            }}
          >
            <label className="flex flex-col gap-1 text-body">
              {t.sessionTitle}
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus required />
            </label>
            {update.error && (
              <p role="alert" className="text-meta text-danger">
                {update.error.message}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Dialog.Close render={<Button />}>{t.cancel}</Dialog.Close>
              <Button type="submit" variant="primary" disabled={!name.trim() || update.isPending}>
                {t.save}
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Root>
    </>
  );
}
