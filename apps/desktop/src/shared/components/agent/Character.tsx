import clsx from 'clsx';

import { useMessages } from '@/shared/i18n';

import { CHARACTER_CLASS, FALLBACK_COLOR, LOOKS, type Look } from './looks';
import { agentMessages } from './messages';

const round = { strokeLinecap: 'round' } as const;

/**
 * An agent's drawn character: a rounded face, two eyes and a smile, wearing one of twelve looks (boards 캐릭터 그림
 * and 캐릭터 모음). The ink is `currentColor`, so the colour class on the svg sets every line; an unknown look draws
 * as the antenna and an unknown colour as blue.
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
  const { face, faceStroke } = paint;
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      // A character with an empty `label` is decoration: the words next to it already say who it is.
      {...(label === ''
        ? { 'aria-hidden': true }
        : { role: 'img', 'aria-label': label ?? t.characterLabel(t[`look_${kind}`]) })}
      className={clsx('shrink-0', paint.ink, className)}
    >
      <ellipse cx="60" cy="111" rx="32" ry="4" fill="currentColor" opacity="0.14" />
      {(kind === 'antenna' || kind === 'glasses' || kind === 'bowtie') && (
        <g>
          <line x1="60" y1="36" x2="60" y2="20" stroke="currentColor" strokeWidth="3" {...round} />
          <circle cx="60" cy="16" r="5.5" fill="currentColor" />
        </g>
      )}
      {kind === 'sprout' && (
        <g>
          <line x1="60" y1="36" x2="60" y2="21" stroke="currentColor" strokeWidth="3" {...round} />
          <path d="M60 24 C50 13 39 17 41 24 C47 29 55 28 60 24 Z" fill="currentColor" />
          <path d="M60 22 C68 9 81 11 79 19 C73 26 65 25 60 22 Z" fill="currentColor" />
        </g>
      )}
      {kind === 'headphones' && (
        <path d="M22 62 C20 18, 100 18, 98 62" fill="none" stroke="currentColor" strokeWidth="4" {...round} />
      )}
      <rect x="22" y="34" width="76" height="70" rx="32" className={face} stroke="currentColor" strokeWidth="3" />
      {kind === 'headphones' && (
        <g>
          <rect x="14" y="52" width="13" height="24" rx="6" fill="currentColor" />
          <rect x="93" y="52" width="13" height="24" rx="6" fill="currentColor" />
        </g>
      )}
      <circle cx="46" cy="64" r="5" fill="currentColor" />
      <circle cx="74" cy="64" r="5" fill="currentColor" />
      <path d="M51 79 Q60 86 69 79" fill="none" stroke="currentColor" strokeWidth="3" {...round} />
      {kind !== 'bowtie' && (
        <path
          d="M48 97 L55 89 L60 94 L64 90 L72 97"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity="0.7"
        />
      )}
      {kind === 'bowtie' && (
        <g>
          <path d="M60 93 L47 86 L47 100 Z" fill="currentColor" />
          <path d="M60 93 L73 86 L73 100 Z" fill="currentColor" />
          <circle cx="60" cy="93" r="3.5" fill="currentColor" />
        </g>
      )}
      {kind === 'hardhat' && (
        <g>
          <path d="M26 44 C 28 18, 92 18, 94 44 Z" fill="currentColor" />
          <rect x="18" y="41" width="84" height="7" rx="3.5" fill="currentColor" />
          <line x1="60" y1="22" x2="60" y2="41" className={faceStroke} strokeWidth="3" {...round} />
        </g>
      )}
      {kind === 'glasses' && (
        <g>
          <circle cx="46" cy="64" r="11" fill="none" stroke="currentColor" strokeWidth="3" />
          <circle cx="74" cy="64" r="11" fill="none" stroke="currentColor" strokeWidth="3" />
          <line x1="57" y1="64" x2="63" y2="64" stroke="currentColor" strokeWidth="3" />
        </g>
      )}
      {kind === 'beret' && (
        <g>
          <path d="M24 42 C 26 24, 82 20, 92 36 C 96 44, 40 48, 24 42 Z" fill="currentColor" />
          <circle cx="60" cy="25" r="3.5" fill="currentColor" />
        </g>
      )}
      {kind === 'cap' && (
        <g>
          <path d="M27 46 C 29 22, 91 22, 93 46 Z" fill="currentColor" />
          <path d="M88 42 L110 45 L108 50 L88 49 Z" fill="currentColor" />
          <circle cx="60" cy="25" r="3" className={face} />
        </g>
      )}
      {kind === 'chef' && (
        <g>
          <path
            d="M36 42 L36 26 C26 22 29 7 42 11 C46 1 74 1 78 11 C91 7 94 22 84 26 L84 42 Z"
            className="fill-canvas-raised"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <rect
            x="36"
            y="36"
            width="48"
            height="8"
            className="fill-canvas-raised"
            stroke="currentColor"
            strokeWidth="2.5"
          />
        </g>
      )}
      {kind === 'ribbon' && (
        <g>
          <path d="M80 36 L67 27 L67 45 Z" fill="currentColor" />
          <path d="M80 36 L93 27 L93 45 Z" fill="currentColor" />
          <circle cx="80" cy="36" r="4" fill="currentColor" />
        </g>
      )}
      {kind === 'beanie' && (
        <g>
          <path d="M26 46 C 26 15, 94 15, 94 46 Z" fill="currentColor" />
          <rect x="22" y="41" width="76" height="10" rx="4" fill="currentColor" />
          <line x1="40" y1="43" x2="40" y2="49" className={faceStroke} strokeWidth="2" />
          <line x1="60" y1="43" x2="60" y2="49" className={faceStroke} strokeWidth="2" />
          <line x1="80" y1="43" x2="80" y2="49" className={faceStroke} strokeWidth="2" />
          <circle cx="60" cy="14" r="6" fill="currentColor" />
        </g>
      )}
      {kind === 'grad' && (
        <g>
          <rect x="40" y="28" width="40" height="13" fill="currentColor" />
          <path d="M60 12 L101 26 L60 40 L19 26 Z" fill="currentColor" />
          <line x1="97" y1="27" x2="97" y2="44" stroke="currentColor" strokeWidth="2" />
          <circle cx="97" cy="46" r="3" fill="currentColor" />
        </g>
      )}
    </svg>
  );
}
