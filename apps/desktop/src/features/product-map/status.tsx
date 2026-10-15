import type { FlowNode } from '@alpine/protocol';
import clsx from 'clsx';
import {
  AppWindow,
  Circle,
  CircleCheck,
  CircleHelp,
  CircleDashed,
  CircleX,
  Cog,
  Database,
  Loader,
  Package,
  Plug,
  RotateCcw,
  Webhook,
  Workflow,
} from 'lucide-react';

import { useMessages } from '@/shared/i18n';

import { messages } from './messages';
import type { Verification } from './model';

export const kindIcons = { screen: AppWindow, api: Webhook, sdk: Package, process: Workflow, data: Database };

/** The plain grouping a non-developer reads: what the user sees, or what the system does on its own. */
export type KindGroup = 'screen' | 'external' | 'auto';
export function kindGroup(kind: FlowNode['kind']): KindGroup {
  if (kind === 'screen') return 'screen';
  if (kind === 'sdk') return 'external';
  return 'auto';
}
export const kindGroupIcons = { screen: AppWindow, external: Plug, auto: Cog } as const;

const verificationIcons = {
  failed: [CircleX, 'text-danger'],
  question: [CircleHelp, 'text-attention'],
  recheck: [RotateCcw, 'text-attention'],
  unconfirmed: [CircleDashed, 'text-fg-muted'],
  passed: [CircleCheck, 'text-fg'],
  none: [Circle, 'text-fg-faint'],
} as const;

/** The one status a feature shows everywhere: whether its promises are known to hold. */
export function VerificationIcon({ status, size = 14 }: { status: Verification; size?: number }) {
  const [Icon, color] = verificationIcons[status];
  return <Icon size={size} className={clsx('shrink-0', color)} aria-hidden />;
}

export function VerificationLabel({ status, className }: { status: Verification; className?: string }) {
  const t = useMessages(messages);
  return (
    <span className={clsx('inline-flex items-center gap-1.5', className)}>
      <VerificationIcon status={status} />
      <span
        className={
          status === 'failed'
            ? 'text-danger'
            : status === 'recheck' || status === 'question'
              ? 'text-attention'
              : undefined
        }
      >
        {t[status]}
      </span>
    </span>
  );
}

/** Implementation phase is shown only when it is not the ordinary "implemented". */
export function PhaseTag({ node, working }: { node: FlowNode; working: boolean }) {
  const t = useMessages(messages);
  if (working)
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-meta text-interactive">
        <Loader size={12} aria-hidden />
        {t.working}
      </span>
    );
  if (node.phase === 'planned')
    return (
      <span className="shrink-0 rounded-md border border-dashed border-line px-1.5 text-meta text-fg-muted">
        {t.planned}
      </span>
    );
  return null;
}
