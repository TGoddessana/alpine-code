import type { ProfileInfo } from '@alpine/protocol';
import { Menu } from '@alpine/ui/primitives';
import { ChevronDown } from 'lucide-react';
import { Link, useNavigate } from '@tanstack/react-router';

import { useMessages } from '@/shared/i18n';
import { useProfiles, useResolveProfile } from '@/shared/server';

import { messages } from './messages';

const chip =
  'inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-meta whitespace-nowrap text-fg-muted hover:bg-canvas-sunken hover:text-fg data-popup-open:bg-canvas-sunken';

type Messages = ReturnType<typeof useMessages<typeof messages.ko>>;

function nameOf(profile: Pick<ProfileInfo, 'id' | 'name'>, t: Messages) {
  return profile.id === 'default' || !profile.name ? t.defaultProfile : profile.name;
}

/**
 * 'Tools · <profile>' before the model, while a session can still be started: the profile the project and model
 * match, unless the user picks another (`chosen`). It follows the model until the first message.
 */
export function ProfileChip({
  cwd,
  model,
  chosen,
  onChoose,
}: {
  cwd: string;
  model: string | null;
  chosen: string | null;
  onChoose: (id: string | null) => void;
}) {
  const t = useMessages(messages);
  const navigate = useNavigate();
  const profiles = useProfiles().data?.profiles;
  const matched = useResolveProfile(cwd, model).data;
  const current = profiles?.find((p) => p.id === chosen) ?? matched;
  if (!profiles || !current) return null;
  return (
    <Menu.Root>
      <Menu.Trigger
        className={chip}
        title={t.profileTitle(current.tools.length)}
        aria-label={t.profileLabel(nameOf(current, t))}
      >
        {t.tools} · <span className="text-fg">{nameOf(current, t)}</span>
        <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Popup side="top" align="end" className="w-64">
        <Menu.RadioGroup value={chosen ?? ''} onValueChange={(id: string) => onChoose(id || null)}>
          <Menu.RadioItem value="">
            <span className="flex min-w-0 grow flex-col">
              <span>{t.automatic}</span>
              {matched && <span className="text-meta text-fg-muted">{nameOf(matched, t)}</span>}
            </span>
          </Menu.RadioItem>
          {profiles.map((p) => (
            <Menu.RadioItem key={p.id} value={p.id}>
              <span className="min-w-0 grow truncate">{nameOf(p, t)}</span>
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
        <Menu.Separator />
        <Menu.Item onClick={() => void navigate({ to: '/settings', search: { tab: 'tools', profile: current.id } })}>
          {t.manageProfiles}
        </Menu.Item>
      </Menu.Popup>
    </Menu.Root>
  );
}

/** The profile a running session started with: fixed, and a link to it in Settings. */
export function SessionProfile({ profileId }: { profileId: string | null }) {
  const t = useMessages(messages);
  const profile = useProfiles().data?.profiles.find((p) => p.id === profileId);
  if (!profileId || !profile) return null;
  return (
    <Link to="/settings" search={{ tab: 'tools', profile: profile.id }} title={t.lockedTitle} className={chip}>
      {t.tools} · <span className="text-fg">{nameOf(profile, t)}</span>
    </Link>
  );
}
