import type { SessionInfo } from '@alpine/protocol';
import { ContextMenu, Menu } from '@alpine/ui/primitives';
import { Link } from '@tanstack/react-router';
import clsx from 'clsx';
import { Ellipsis } from 'lucide-react';
import { useState } from 'react';

import { StatusWord } from '@/shared/components/status';
import { useFormat, useMessages } from '@/shared/i18n';

import { messages } from './messages';

/**
 * A session under its project: the title, then what state it is in. Running, waiting and failed sessions say so
 * with a dot and a word; the rest show how long ago they were last used. The ⋮ menu (and right-click) offers to
 * delete it.
 */
export function SessionRow({ session, onDelete }: { session: SessionInfo; onDelete: (session: SessionInfo) => void }) {
  const t = useMessages(messages);
  const format = useFormat();
  const [menuOpen, setMenuOpen] = useState(false);
  const title = session.title || t.untitledSession;
  const items = (
    <Menu.Item className="text-danger" onClick={() => onDelete(session)}>
      {t.deleteSession}
    </Menu.Item>
  );

  return (
    <div className={clsx('group relative flex items-center rounded-lg hover:bg-hover', menuOpen && 'bg-hover')}>
      <ContextMenu.Root>
        <ContextMenu.Trigger
          render={<Link to="/session/$sessionId" params={{ sessionId: session.id }} />}
          className="flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-lg py-1 pr-2 pl-2 text-left text-body text-fg-muted hover:bg-transparent data-[status=active]:bg-hover data-[status=active]:font-medium data-[status=active]:text-fg"
          title={title}
        >
          <span className="min-w-0 grow truncate">{title}</span>
          <span
            className={clsx('shrink-0 group-focus-within:invisible group-hover:invisible', menuOpen && 'invisible')}
          >
            {session.status === 'idle' ? (
              <span className="text-meta whitespace-nowrap text-fg-muted">
                {format.since(new Date(session.updatedAt))}
              </span>
            ) : (
              <StatusWord status={session.status} />
            )}
          </span>
        </ContextMenu.Trigger>
        <ContextMenu.Popup aria-label={t.sessionMenu(title)}>{items}</ContextMenu.Popup>
      </ContextMenu.Root>
      <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Menu.Trigger
          aria-label={t.sessionMenu(title)}
          className={clsx(
            'absolute right-1 size-6 cursor-pointer items-center justify-center rounded-sm text-fg-muted hover:bg-line hover:text-fg group-focus-within:inline-flex group-hover:inline-flex data-popup-open:bg-line data-popup-open:text-fg',
            menuOpen ? 'inline-flex' : 'hidden',
          )}
        >
          <Ellipsis size={16} strokeWidth={1.5} aria-hidden="true" />
        </Menu.Trigger>
        <Menu.Popup aria-label={t.sessionMenu(title)}>{items}</Menu.Popup>
      </Menu.Root>
    </div>
  );
}
