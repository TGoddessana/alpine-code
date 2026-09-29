import { Link } from '@tanstack/react-router';

import { useMessages } from '@/shared/i18n';

import { messages } from './messages';

const item = 'flex min-h-8 items-center rounded-md px-2 text-body text-fg hover:bg-hover';
const active = { className: 'bg-canvas-raised font-medium' };

/** Where you are: my turn, projects and their sessions. Holds no session content. */
export function Rail() {
  const t = useMessages(messages);
  return (
    <nav aria-label={t.label} className="flex w-65 shrink-0 flex-col gap-3 border-r border-line px-3 py-4">
      <span className="px-2 font-display text-title">Alpine</span>
      <Link to="/" className={item} activeProps={active} activeOptions={{ exact: true }}>
        {t.newSession}
      </Link>
      <div className="grow" />
      <Link to="/settings" className={item} activeProps={active}>
        {t.settings}
      </Link>
    </nav>
  );
}
