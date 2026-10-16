import { Menu } from '@alpine/ui/primitives';

import { useMessages } from '@/shared/i18n';

import { messages } from './messages';

/**
 * The two ways a project comes in, the same words in the same order wherever a menu offers them (the rail's +, the
 * project menu over the input): from a repository, or a folder already on this computer.
 */
export function ProjectAddItems({ onGet, onOpen }: { onGet: () => void; onOpen: () => void }) {
  const t = useMessages(messages);
  return (
    <>
      <Menu.Item onClick={onGet}>{t.getProject}</Menu.Item>
      <Menu.Item onClick={onOpen}>
        <span className="grow">{t.openProject}</span>
        <span className="text-meta text-fg-muted">⌘O</span>
      </Menu.Item>
    </>
  );
}
