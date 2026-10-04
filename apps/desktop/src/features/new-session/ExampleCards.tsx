import { Lightbulb, type LucideIcon, PlayCircle, Smartphone, Map } from 'lucide-react';

import { useMessages } from '@/shared/i18n';

import { messages } from './messages';

const ICONS: LucideIcon[] = [Lightbulb, Smartphone, PlayCircle, Map];

/**
 * Four things to try on an empty session. Picking one only fills the input (the caller does that);
 * nothing is sent until the person sends it.
 */
export function ExampleCards({ onPick }: { onPick: (text: string) => void }) {
  const t = useMessages(messages);
  const examples = [
    { title: t.example1Title, hint: t.example1Hint },
    { title: t.example2Title, hint: t.example2Hint },
    { title: t.example3Title, hint: t.example3Hint },
    { title: t.example4Title, hint: t.example4Hint },
  ];
  return (
    <ul className="grid w-full grid-cols-2 gap-3">
      {examples.map((example, index) => {
        const Icon = ICONS[index] ?? Lightbulb;
        return (
          <li key={example.title} className="flex">
            <button
              type="button"
              onClick={() => onPick(example.title)}
              className="flex w-full cursor-pointer flex-col items-start gap-3 rounded-xl border border-line bg-canvas-raised p-4 text-left hover:bg-hover"
            >
              <span className="inline-flex size-8 items-center justify-center rounded-lg bg-hover text-interactive">
                <Icon size={18} strokeWidth={1.5} aria-hidden="true" />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-body font-medium">{example.title}</span>
                <span className="text-meta text-fg-muted">{example.hint}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
