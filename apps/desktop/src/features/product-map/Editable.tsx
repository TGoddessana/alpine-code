import { useState } from 'react';

/**
 * One sentence edited in place: Enter saves, Escape cancels, Shift+Enter breaks a line where several lines make sense.
 * What was typed stays until the save succeeds, so a failure loses nothing.
 */
export function Editable({
  value,
  label,
  hint,
  placeholder,
  maxLength,
  multiline = false,
  allowEmpty = false,
  disabled = false,
  onSave,
  onCancel,
}: {
  value: string;
  /** Read by screen readers; the field has no visible label. */
  label: string;
  hint: string;
  placeholder?: string;
  maxLength: number;
  multiline?: boolean;
  /** Saving an empty text is meaningful (it clears or removes). */
  allowEmpty?: boolean;
  disabled?: boolean;
  onSave: (value: string, done: () => void) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const save = () => {
    const text = draft.trim();
    if (text === value.trim()) return onCancel();
    if (!text && !allowEmpty) return;
    onSave(text, onCancel);
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    } else if (event.key === 'Enter' && !(multiline && event.shiftKey) && !event.nativeEvent.isComposing) {
      event.preventDefault();
      save();
    }
  };
  const field = 'w-full rounded-md border border-interactive bg-canvas px-2 py-1 text-body text-fg outline-none';
  return (
    <div className="flex flex-col gap-1">
      {multiline ? (
        <textarea
          autoFocus
          rows={3}
          aria-label={label}
          value={draft}
          maxLength={maxLength}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          className={`${field} resize-y`}
        />
      ) : (
        <input
          autoFocus
          type="text"
          aria-label={label}
          value={draft}
          maxLength={maxLength}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          className={field}
        />
      )}
      <p className="text-meta text-fg-faint">{hint}</p>
    </div>
  );
}
