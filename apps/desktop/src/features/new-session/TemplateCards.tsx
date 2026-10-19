import type { JudgedNew } from '@alpine/protocol';
import { Collapse } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { Feather, Layers, Smartphone, SquareDashed, type LucideIcon } from 'lucide-react';

import { useMessages } from '@/shared/i18n';
import type { TemplateId } from '@/shared/server';

import { messages } from './messages';

export interface Template {
  id: TemplateId;
  icon: LucideIcon;
  /** The tile behind the icon: a soft fill with the ink of the same hue, from the avatar palette. */
  tile: string;
  name: string;
  short: string;
  points: string[];
  stack?: string;
  badge?: string;
  soon?: boolean;
}

export function useTemplates(proReady: boolean): Template[] {
  const t = useMessages(messages);
  return [
    {
      id: 'blank',
      icon: SquareDashed,
      tile: 'bg-avatar-7 text-avatar-7-ink',
      name: t.blank,
      short: t.blankShort,
      points: [t.blankPoint1, t.blankPoint2],
    },
    {
      id: 'web-lite',
      icon: Feather,
      tile: 'bg-avatar-1 text-avatar-1-ink',
      name: t.lite,
      short: t.liteShort,
      points: [t.litePoint1, t.litePoint2, t.litePoint3],
      stack: 'React · Hono · Cloudflare D1',
    },
    {
      id: 'web-pro',
      icon: Layers,
      tile: 'bg-avatar-2 text-avatar-2-ink',
      name: t.pro,
      short: t.proShort,
      points: [t.proPoint1, t.proPoint2, t.proPoint3, t.proPoint4, t.proPoint5],
      stack: 'React · Supabase',
      badge: proReady ? t.proBadge : undefined,
      soon: !proReady,
    },
    {
      id: 'mobile',
      icon: Smartphone,
      tile: 'bg-avatar-3 text-avatar-3-ink',
      name: t.mobile,
      short: t.mobileShort,
      points: [],
      stack: 'Expo',
      soon: true,
    },
  ];
}

/**
 * The four setups side by side (decisions 5, 6 and 13 in docs/alpine-cloud.md), shown once the agent has judged that
 * what I wrote is a new app. Its pick comes chosen with a 추천 mark and its reason; I can choose another. What each
 * means is on its card, and the chosen one opens its details under the row.
 */
export function TemplateCards({
  templates,
  value,
  onChange,
  recommendation,
}: {
  templates: Template[];
  value: TemplateId;
  onChange: (value: TemplateId) => void;
  recommendation: Pick<JudgedNew, 'template' | 'reason'>;
}) {
  const t = useMessages(messages);
  const chosen = templates.find((template) => template.id === value);
  return (
    <div className="flex w-full flex-col gap-2">
      <div role="radiogroup" aria-label={t.setups} className="grid grid-cols-4 gap-2">
        {templates.map((template, index) => {
          const selected = template.id === value;
          const picked = recommendation.template === template.id;
          const Icon = template.icon;
          return (
            <button
              key={template.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={template.soon}
              onClick={() => onChange(template.id)}
              style={{ animationDelay: `${index * 50}ms` }}
              className={clsx(
                'motion-step group flex min-h-36 cursor-pointer flex-col items-start gap-2 rounded-xl border p-3 text-left transition-[border-color,background-color,box-shadow,translate] disabled:cursor-default',
                selected
                  ? 'border-interactive bg-selected'
                  : 'border-line bg-canvas-raised hover:-translate-y-0.5 hover:shadow-overlay disabled:hover:translate-y-0 disabled:hover:shadow-none',
              )}
            >
              <span
                aria-hidden="true"
                className={clsx(
                  'flex size-9 items-center justify-center rounded-lg transition-transform duration-(--motion-normal) group-disabled:opacity-50',
                  template.tile,
                  !template.soon && 'group-hover:scale-105',
                )}
              >
                <Icon size={18} strokeWidth={1.75} />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-body font-medium text-fg group-disabled:text-fg-muted">{template.name}</span>
                <span className="line-clamp-2 text-meta text-fg-muted">{template.short}</span>
              </span>
              <span className="mt-auto flex flex-wrap gap-1">
                {picked && (
                  <span className="motion-step rounded-full bg-interactive px-2 text-meta text-on-fill">
                    {t.recommended}
                  </span>
                )}
                {template.badge && <Pill>{template.badge}</Pill>}
                {template.soon && <Pill>{t.soon}</Pill>}
              </span>
            </button>
          );
        })}
      </div>
      <p className="motion-step px-1 text-meta text-interactive">{recommendation.reason}</p>
      <Collapse open={!!chosen && chosen.points.length > 0}>
        {chosen && (
          <div className="flex flex-col gap-1.5 rounded-xl border border-line-subtle bg-canvas-raised px-4 py-3">
            <ul className="flex flex-col gap-1">
              {chosen.points.map((point) => (
                <li key={point} className="flex gap-2 text-meta text-fg">
                  <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-fg-faint" />
                  {point}
                </li>
              ))}
            </ul>
            {chosen.stack && <p className="font-mono text-meta text-fg-faint">{chosen.stack}</p>}
          </div>
        )}
      </Collapse>
    </div>
  );
}

function Pill({ children }: { children: string }) {
  return (
    <span className="rounded-full border border-line bg-canvas-raised px-2 text-meta whitespace-nowrap text-fg-muted">
      {children}
    </span>
  );
}
