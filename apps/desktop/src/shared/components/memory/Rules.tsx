import type { MemoryCheck, MemoryGuard } from '@alpine/protocol';

/**
 * A memory's check and guard as the harness reads them, in the code font: the exact forms, for whoever wants to
 * know what it will do. The plain words (`say`) are shown elsewhere.
 */
export function Rules({ check, guard }: { check?: MemoryCheck | null; guard?: MemoryGuard | null }) {
  if (!check && !guard) return null;
  return (
    <div className="flex flex-col gap-0.5 font-mono text-meta break-words">
      {check && (
        <>
          <span>when: {check.when}</span>
          <span>expect: {check.expect}</span>
        </>
      )}
      {guard && <span>before: {guard.before}</span>}
    </div>
  );
}
