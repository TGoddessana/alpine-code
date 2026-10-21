import clsx from 'clsx';
import { Circle, CircleCheck, CircleHelp, CircleDashed, CircleX, RotateCcw } from 'lucide-react';

import type { Verification } from './model';

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
