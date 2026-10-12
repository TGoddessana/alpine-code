import clsx from 'clsx';

import { useMessages } from '@/shared/i18n';

import { CHARACTER_CLASS, FALLBACK_COLOR, LOOKS, type Look } from './looks';
import { agentMessages } from './messages';

/**
 * One white snow hare for every agent. The approved PNG supplies the face, asymmetric
 * ears and right-facing wrench; pixel accessories and a coloured backing distinguish agents.
 * Keep the persisted `antenna` ID as the plain hare so existing agents need no migration.
 */
export function Character({
  look,
  color,
  size,
  label,
  className,
}: {
  look: string;
  color: number;
  size: number;
  label?: string;
  className?: string;
}) {
  const t = useMessages(agentMessages);
  const kind: Look = (LOOKS as readonly string[]).includes(look) ? (look as Look) : 'antenna';
  const paint = CHARACTER_CLASS[color] ?? CHARACTER_CLASS[FALLBACK_COLOR]!;
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      {...(label === ''
        ? { 'aria-hidden': true as const }
        : { role: 'img', 'aria-label': label ?? t.characterLabel(t[`look_${kind}`]) })}
      className={clsx('shrink-0', paint.ink, className)}
    >
      <rect x="3" y="3" width="94" height="94" rx="18" className={paint.face} />
      <image href="/brand/hare.png" x="0" y="0" width="100" height="100" style={{ imageRendering: 'pixelated' }} />
      <g shapeRendering="crispEdges" fill="currentColor" stroke="currentColor" strokeWidth="1">
        <Accessory look={kind} />
      </g>
    </svg>
  );
}

/** Accessories sit below the ear tips and above the collar; the brand stays visible. */
function Accessory({ look }: { look: Look }) {
  switch (look) {
    case 'antenna':
      return null;
    case 'hardhat':
      return (
        <>
          <path d="M34 44V41H37V38H43V36H55V38H62V41H65V44Z" />
          <path d="M31 44H68V47H31Z" />
          <path d="M47 38H51V44H47Z" className="fill-brand-snow" stroke="none" />
        </>
      );
    case 'glasses':
      return (
        <>
          <path d="M32 48H45V57H32ZM52 48H65V57H52ZM45 51H52M29 50H32M65 50H68" fill="none" strokeWidth="2" />
        </>
      );
    case 'beret':
      return (
        <>
          <path d="M32 43V40H37V38H51V36H62V38H67V42H62V45H36V43Z" />
          <path d="M51 34H54V38H51Z" />
        </>
      );
    case 'headphones':
      return (
        <>
          <path d="M29 54V43H32V40H67V43H70V54" fill="none" strokeWidth="3" />
          <path d="M27 51H32V62H27ZM67 51H72V62H67Z" />
        </>
      );
    case 'cap':
      return (
        <>
          <path d="M34 43V39H39V37H57V39H63V43H72V46H33V43Z" />
          <path d="M47 39H51V43H47Z" className="fill-brand-snow" stroke="none" />
        </>
      );
    case 'chef':
      return (
        <>
          <path d="M35 44V37H32V32H38V29H46V27H53V29H60V32H66V37H62V44Z" className="fill-brand-snow" strokeWidth="2" />
          <path d="M35 41H62V45H35Z" />
        </>
      );
    case 'sprout':
      return (
        <>
          <path d="M49 42V34M49 37L41 32M49 35L57 30" fill="none" strokeWidth="2" />
          <path d="M36 29H43V32H46V35H40V33H36ZM52 29H56V26H63V31H58V33H52Z" />
        </>
      );
    case 'ribbon':
      return (
        <>
          <path d="M60 34L52 29V39ZM60 34L68 29V39Z" />
          <rect x="58" y="32" width="4" height="4" />
        </>
      );
    case 'beanie':
      return (
        <>
          <path d="M34 42V38H38V35H44V33H55V35H61V38H65V42Z" />
          <path d="M32 42H67V46H32Z" />
          <path d="M46 28H53V33H46Z" />
          <path d="M40 43V45M49 43V45M59 43V45" className="stroke-brand-snow" />
        </>
      );
    // At the ear base rather than the neck so the signature wrench is never covered.
    case 'bowtie':
      return (
        <>
          <path d="M42 42L34 37V47ZM42 42L50 37V47Z" />
          <rect x="40" y="40" width="4" height="4" />
        </>
      );
    case 'grad':
      return (
        <>
          <path d="M31 38L49 32L68 38L49 44Z" />
          <path d="M38 41V46H60V41M66 39V49" fill="none" strokeWidth="2" />
          <rect x="64" y="48" width="4" height="4" />
        </>
      );
  }
}
