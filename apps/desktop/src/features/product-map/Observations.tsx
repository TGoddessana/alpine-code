import type { FlowCheck, Observation, ObservationProvenance } from '@alpine/protocol';
import clsx from 'clsx';
import { useState } from 'react';
import { BadgeCheck, Camera, CircleAlert, FileText, MessageSquareText } from 'lucide-react';

import { useMessages } from '@/shared/i18n';

import { messages } from './messages';

type Label = ObservationProvenance['label'];

/** An observation without a server label is only the agent's word. */
export const labelOf = (provenance?: ObservationProvenance): Label => provenance?.label ?? 'agent';

/** The check as a whole rests on nothing Alpine confirmed or captured. A label only; it never changes the result. */
export function isUnverified(check: FlowCheck, provenance?: ObservationProvenance[]) {
  return !(check.observations ?? []).some((_, index) => {
    const label = labelOf(provenance?.[index]);
    return label === 'verified' || label === 'captured';
  });
}

/** The check rests only on code the AI read: real words from the files, but nothing was run or captured. */
export function isReadOnly(check: FlowCheck, provenance?: ObservationProvenance[]) {
  const labels = (check.observations ?? []).map((_, index) => labelOf(provenance?.[index]));
  return labels.includes('read') && !labels.some((label) => label === 'verified' || label === 'captured');
}

/** How many observations the record contradicts. A count only; it never changes the result. */
export const mismatchCount = (provenance?: ObservationProvenance[]) =>
  (provenance ?? []).filter((item) => item.label === 'mismatch').length;

const badgeStyle = {
  verified: [BadgeCheck, 'text-fg border-line'],
  captured: [Camera, 'text-fg border-line'],
  read: [FileText, 'text-fg-muted border-line'],
  mismatch: [CircleAlert, 'text-attention border-attention'],
  agent: [MessageSquareText, 'text-fg-muted border-line-subtle'],
} as const;

export function ProvenanceBadge({ provenance }: { provenance?: ObservationProvenance }) {
  const t = useMessages(messages);
  const label = labelOf(provenance);
  // A record another computer left cannot be compared here, so it is shown neutrally, never as confirmed.
  if (provenance?.elsewhere)
    return (
      <span
        data-provenance="elsewhere"
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line-subtle px-1.5 text-meta text-fg-muted"
      >
        <MessageSquareText size={12} aria-hidden />
        {t.elsewhere}
      </span>
    );
  const [Icon, style] = badgeStyle[label];
  const text = {
    verified: t.provVerified,
    captured: t.provCaptured,
    read: t.provRead,
    mismatch: t.provMismatch,
    agent: t.provAgent,
  }[label];
  return (
    <span
      data-provenance={label}
      className={clsx('inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 text-meta', style)}
    >
      <Icon size={12} aria-hidden />
      {text}
    </span>
  );
}

function useReason() {
  const t = useMessages(messages);
  return (reason?: string) =>
    ({
      call_not_found: t.reasonCallNotFound,
      excerpt_missing: t.reasonExcerptMissing,
      no_excerpt: t.reasonNoExcerpt,
      session_not_found: t.reasonSessionNotFound,
      other_project: t.reasonOtherProject,
      file_missing: t.reasonFileMissing,
      file_changed: t.reasonFileChanged,
      surface_not_found: t.reasonSurfaceNotFound,
      outside_session: t.reasonOutsideSession,
      alpine_record: t.reasonAlpineRecord,
    })[reason ?? ''] ?? '';
}

function Pre({ children }: { children: string }) {
  return (
    <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-canvas-sunken p-2 font-mono text-meta whitespace-pre-wrap">
      {children}
    </pre>
  );
}

/** What Alpine checked, quoted. Long text is trimmed to a few lines. */
function Excerpt({ children }: { children: string }) {
  const t = useMessages(messages);
  const [open, setOpen] = useState(false);
  const long = children.split('\n').length > 4 || children.length > 280;
  return (
    <div className="mt-1">
      <pre
        data-testid="excerpt"
        className={clsx(
          'overflow-auto rounded-md bg-canvas-sunken p-2 font-mono text-meta whitespace-pre-wrap',
          long && !open ? 'max-h-24 overflow-hidden' : 'max-h-48',
        )}
      >
        {children}
      </pre>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-0.5 cursor-pointer text-meta text-fg-muted underline"
        >
          {open ? t.showLess : t.showMore}
        </button>
      )}
    </div>
  );
}

/** Compact kinds show their excerpt in place; a confirmed excerpt is always shown, since the badge sits on it. */
const showsExcerpt = (o: Observation, label: Label) =>
  !!o.excerpt &&
  o.show !== 'image' &&
  o.show !== 'video' &&
  (label === 'verified' ||
    label === 'read' ||
    (!o.expected && !o.actual && ['table', 'request', 'diff', 'link'].includes(o.show ?? 'text')));

function Media({ observation, image }: { observation: Observation; image?: string }) {
  const t = useMessages(messages);
  const { show } = observation;
  if (image) {
    return show === 'image' ? (
      <img src={image} alt={observation.label} className="mt-1 w-full rounded-lg border border-line" />
    ) : (
      <video src={image} controls className="mt-1 w-full rounded-lg border border-line" />
    );
  }
  const text =
    show === 'video'
      ? t.videoMissing
      : observation.source?.kind === 'surface_capture'
        ? t.imageOtherMachine
        : t.imageMissing;
  return <p className="mt-1 rounded-md border border-dashed border-line p-2 text-meta text-fg-muted">{text}</p>;
}

/** The AI's own words about an observation: its caption and the values it says it expected and saw. */
function AiWords({ observation, plain }: { observation: Observation; plain?: boolean }) {
  const t = useMessages(messages);
  const { expected, actual } = observation;
  return (
    <div data-ai-words className="flex flex-col gap-1 text-fg-muted">
      <p className="text-body italic">
        {!plain && <span className="mr-1 not-italic">{t.aiSays}</span>}
        {observation.label}
      </p>
      {(expected || actual) && (
        <dl className="grid grid-cols-2 gap-2 text-meta">
          <div className="rounded-md border border-dashed border-line-subtle p-2">
            <dt>{t.expectedLabel}</dt>
            <dd className="break-words whitespace-pre-wrap">{expected}</dd>
          </div>
          <div className="rounded-md border border-dashed border-line-subtle p-2">
            <dt>{t.actualLabel}</dt>
            <dd className="break-words whitespace-pre-wrap">{actual}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

/**
 * The observations of one check, in the order the agent wrote them. `images` is keyed by observation index.
 * The badge sits on what Alpine checked (the quoted excerpt or the captured picture); the label, expected and actual
 * are the AI's words and are styled as such.
 */
export function ObservationList({
  observations,
  provenance,
  images,
}: {
  observations: Observation[];
  provenance?: ObservationProvenance[];
  images?: Record<number, string | undefined>;
}) {
  const reasonText = useReason();
  return (
    <ol className="flex flex-col gap-3">
      {observations.map((observation, index) => {
        const prov = provenance?.[index];
        const label = labelOf(prov);
        const reason = label === 'mismatch' ? reasonText(prov?.reason) : '';
        const media = observation.show === 'image' || observation.show === 'video';
        const checked = label === 'verified' || label === 'captured';
        return (
          <li key={index} className="flex flex-col gap-1">
            {label === 'agent' ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <ProvenanceBadge provenance={prov} />
                <AiWords observation={observation} plain />
              </div>
            ) : (
              <>
                <AiWords observation={observation} />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <ProvenanceBadge provenance={prov} />
                  {reason && <span className="text-meta text-attention">{reason}</span>}
                </div>
                {media && (checked || label === 'mismatch') && (
                  <Media observation={observation} image={images?.[index]} />
                )}
                {showsExcerpt(observation, label) && <Excerpt>{observation.excerpt!}</Excerpt>}
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Where each observation came from, for the folded technical record. */
export function SourceDetails({
  observations,
  provenance,
}: {
  observations: Observation[];
  provenance?: ObservationProvenance[];
}) {
  const t = useMessages(messages);
  return (
    <ol className="flex flex-col gap-2">
      {observations.map((observation, index) => {
        const { source } = observation;
        const matched = provenance?.[index]?.matched;
        return (
          <li key={index} className="text-meta">
            <p className="text-fg-muted">
              {index + 1}. {observation.label}
            </p>
            {source ? (
              <p className="font-mono break-all text-fg-muted">
                {t.sourceKind(source.kind)} · {source.ref}
                {source.sessionId ? ` · ${t.sourceSession} ${source.sessionId}` : ''}
                {matched ? ` · ${t.matchedCall} ${matched}` : ''}
              </p>
            ) : null}
            {observation.excerpt && !showsExcerpt(observation, labelOf(provenance?.[index])) && (
              <Pre>{observation.excerpt}</Pre>
            )}
          </li>
        );
      })}
    </ol>
  );
}
