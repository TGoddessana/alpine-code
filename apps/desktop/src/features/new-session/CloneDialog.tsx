import { Button, Dialog, Input, LinkButton } from '@alpine/ui/primitives';
import { useState } from 'react';

import { common, useMessages } from '@/shared/i18n';
import { pickFolder, tildePath, useHomeDir } from '@/shared/platform';
import { ServerError, useCloneProject, useProjects } from '@/shared/server';

import { messages } from './messages';

/** Board ProjectAdd: an address and where to put it. Opening a folder never needs a sheet; cloning does. */
export function CloneDialog({
  open,
  onOpenChange,
  onCloned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloned: (path: string) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Popup size="sm">{open && <CloneForm onCloned={onCloned} />}</Dialog.Popup>
    </Dialog.Root>
  );
}

function CloneForm({ onCloned }: { onCloned: (path: string) => void }) {
  const t = useMessages(messages);
  const { chooseFolder } = useMessages(common);
  const home = useHomeDir();
  const projects = useProjects();
  const [address, setAddress] = useState('');
  const [parent, setParent] = useState<string | null>(null);
  const clone = useCloneProject();
  const where = parent ?? projects.data?.cloneParent ?? '';
  const reason = clone.error instanceof ServerError ? clone.error.data?.reason : undefined;

  const submit = () =>
    clone.mutate({ address: address.trim(), parent: where }, { onSuccess: ({ project }) => onCloned(project.path) });
  const change = async () => {
    const picked = await pickFolder(chooseFolder);
    if (picked) setParent(picked);
  };

  return (
    <>
      <Dialog.Title>{t.cloneTitle}</Dialog.Title>
      <div className="flex flex-col gap-2">
        <label htmlFor="clone-address" className="sr-only">
          {t.address}
        </label>
        <Input
          id="clone-address"
          spellCheck={false}
          placeholder={t.addressPlaceholder}
          value={address}
          onValueChange={(next) => setAddress(next)}
          onKeyDown={(event) => event.key === 'Enter' && address.trim() && !clone.isPending && submit()}
        />
        <div className="flex min-h-7 items-center gap-2">
          <span className="text-meta text-fg-muted">{t.location}</span>
          <span className="min-w-0 grow truncate font-mono text-meta">{tildePath(where, home)}</span>
          <LinkButton aria-label={t.changeLocationLabel} onClick={change}>
            {t.changeLocation}
          </LinkButton>
        </div>
      </div>
      {clone.error && (
        <p role="alert" className="text-meta text-danger">
          {reason === 'exists' ? t.exists : t.cloneFailed(clone.error.message)}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Dialog.Close render={<Button />}>{t.cancel}</Dialog.Close>
        <Button variant="primary" disabled={!address.trim() || !where || clone.isPending} onClick={submit}>
          {clone.isPending ? t.cloning : t.cloneButton}
        </Button>
      </div>
    </>
  );
}
