import { useMessages } from '@/shared/i18n';

import { messages } from './messages';

/**
 * Three things to ask on an empty session, one line each. Picking one only fills the input (the caller does that);
 * nothing is sent until the person sends it.
 */
export function Suggestions({ onPick }: { onPick: (text: string) => void }) {
  const t = useMessages(messages);
  return (
    <ul className="flex w-full flex-col divide-y divide-line-subtle border-y border-line-subtle">
      {[t.suggestion1, t.suggestion2, t.suggestion3].map((text) => (
        <li key={text}>
          <button
            type="button"
            onClick={() => onPick(text)}
            className="flex min-h-10 w-full cursor-pointer items-center px-2 text-left text-body text-fg hover:bg-hover"
          >
            {text}
          </button>
        </li>
      ))}
    </ul>
  );
}
