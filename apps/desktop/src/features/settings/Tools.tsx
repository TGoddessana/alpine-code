import type { ProfileInfo, ToolFileInfo, ToolSummary, ToolsListResult } from '@alpine/protocol';
import { Button, Dialog, Input, LinkButton, Menu, NativeSelect } from '@alpine/ui/primitives';
import { useNavigate } from '@tanstack/react-router';
import clsx from 'clsx';
import { MoreVertical } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { useFormat, useMessages } from '@/shared/i18n';
import {
  ServerError,
  useConfirmTool,
  useConnections,
  useDeleteProfile,
  useDeleteTool,
  useModelsOf,
  useProfiles,
  useProjects,
  useSaveProfile,
  useTools,
} from '@/shared/server';

import { toolMessages } from './toolMessages';

type Messages = ReturnType<typeof useMessages<typeof toolMessages.ko>>;

type Label =
  | 'read'
  | 'readDoes'
  | 'glob'
  | 'globDoes'
  | 'grep'
  | 'grepDoes'
  | 'write'
  | 'writeDoes'
  | 'editTool'
  | 'editDoes'
  | 'bash'
  | 'bashDoes'
  | 'proposeMemory'
  | 'proposeMemoryDoes';

const BUILTIN_LABELS: Record<string, [Label, Label]> = {
  read: ['read', 'readDoes'],
  glob: ['glob', 'globDoes'],
  grep: ['grep', 'grepDoes'],
  write: ['write', 'writeDoes'],
  edit: ['editTool', 'editDoes'],
  bash: ['bash', 'bashDoes'],
  propose_memory: ['proposeMemory', 'proposeMemoryDoes'],
};

const grid = 'grid grid-cols-[24px_220px_minmax(0,1fr)_104px_176px_28px] items-center gap-3 px-2';

/** A profile's display name: the default one's is translated. */
export function profileName(profile: Pick<ProfileInfo, 'id' | 'name'>, t: Messages) {
  return profile.id === 'default' || !profile.name ? t.defaultProfile : profile.name;
}

/**
 * Board Tools: profiles on the left; the chosen one's place (project, model) and which tools it turns on. Tools are
 * made once; a profile only chooses. `saved` names a tool just saved from the editor, which a toast confirms.
 */
export function ToolsTab({
  profileId,
  saved,
  onProfileChange,
}: {
  profileId?: string;
  saved?: string;
  onProfileChange: (id: string) => void;
}) {
  const t = useMessages(toolMessages);
  const profiles = useProfiles().data?.profiles;
  const tools = useTools().data;
  const [creating, setCreating] = useState(false);
  if (!profiles || !tools) return null;
  const profile = profiles.find((p) => p.id === profileId) ?? profiles[0]!;

  return (
    <div className="flex min-h-0 grow">
      <nav aria-label={t.profiles} className="flex w-58 shrink-0 flex-col gap-0.5 border-r border-line py-4 pr-3">
        <div className="flex min-h-7 items-center px-3 text-meta text-fg-muted">{t.profiles}</div>
        {profiles.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-current={p.id === profile.id ? 'page' : undefined}
            onClick={() => onProfileChange(p.id)}
            className={clsx(
              'flex cursor-pointer flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left',
              p.id === profile.id ? 'bg-selected' : 'hover:bg-canvas-sunken',
            )}
          >
            <span className="text-body">{profileName(p, t)}</span>
            <Where profile={p} />
          </button>
        ))}
        <LinkButton className="mx-2 mt-2 self-start text-body" onClick={() => setCreating(true)}>
          {t.newProfile}
        </LinkButton>
      </nav>
      <ProfileDetail key={profile.id} profile={profile} tools={tools} />
      <NewProfileDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(id) => {
          setCreating(false);
          onProfileChange(id);
        }}
      />
      {saved && <SavedToast tool={saved} profile={profileName(profile, t)} />}
    </div>
  );
}

function Where({ profile }: { profile: ProfileInfo }) {
  const t = useMessages(toolMessages);
  if (profile.id === 'default') return <span className="text-meta text-fg-muted">{t.defaultWhere}</span>;
  const project = profile.project ? profile.project.split('/').at(-1)! : t.everyProject;
  const model = profile.model ? profile.model.slice(profile.model.indexOf('/') + 1) : t.everyModel;
  return <span className="text-meta text-fg-muted">{t.where(project, model)}</span>;
}

function ProfileDetail({ profile, tools }: { profile: ProfileInfo; tools: ToolsListResult }) {
  const t = useMessages(toolMessages);
  const save = useSaveProfile();
  const on = new Set(profile.tools);
  const toggle = (name: string, checked: boolean) =>
    save.mutate({ ...profile, tools: checked ? [...profile.tools, name] : profile.tools.filter((n) => n !== name) });
  const count = tools.tools.filter((o) => !o.optional || on.has(o.tool.name)).length;

  return (
    <div className="flex min-w-0 grow flex-col gap-7 overflow-y-auto px-6 py-5">
      <ProfileHeader profile={profile} />
      <section aria-labelledby="tools-title" className="flex flex-col gap-1">
        <div className="flex min-h-8 items-center gap-3">
          <div className="flex grow items-baseline gap-2">
            <h2 id="tools-title" className="text-lead">
              {t.tools}
            </h2>
            <span className="text-meta text-fg-muted">{t.toolsOn(count)}</span>
          </div>
          <AddToolMenu profileId={profile.id} />
        </div>
        <div className={clsx(grid, 'min-h-8 border-b border-line-subtle text-meta text-fg-muted')}>
          <span />
          <span>{t.colName}</span>
          <span>{t.colDoes}</span>
          <span>{t.colSource}</span>
          <span>{t.colAsk}</span>
          <span />
        </div>
        {tools.tools
          .filter((o) => o.origin !== 'user')
          .map(({ tool, origin, optional }) => {
            const [label, does] = BUILTIN_LABELS[tool.name] ?? [null, null];
            return (
              <ToolRow
                key={tool.name}
                name={tool.name}
                label={label ? t[label] : tool.name}
                does={does ? t[does] : firstLine(tool.description)}
                source={origin === 'memory' ? t.fromMemory : t.builtin}
                ask={tool.name === 'bash' ? t.askBash : askLabel(tool, t)}
                checked={!optional || on.has(tool.name)}
                locked={!optional}
                onChange={(checked) => toggle(tool.name, checked)}
              />
            );
          })}
        {tools.files.map((file) =>
          file.status === 'ready' ? (
            file.tools.map((tool) => (
              <ToolRow
                key={tool.name}
                name={tool.name}
                label={tool.name}
                does={firstLine(tool.description)}
                source={t.mine}
                ask={askLabel(tool, t)}
                checked={on.has(tool.name)}
                onChange={(checked) => toggle(tool.name, checked)}
                menu={<FileMenu file={file} profileId={profile.id} />}
              />
            ))
          ) : (
            <BlockedFile key={file.name} file={file} profileId={profile.id} />
          ),
        )}
      </section>
    </div>
  );
}

function ProfileHeader({ profile }: { profile: ProfileInfo }) {
  const t = useMessages(toolMessages);
  const save = useSaveProfile();
  const remove = useDeleteProfile();
  const projects = useProjects().data?.projects ?? [];
  const models = useAllModels();
  const [name, setName] = useState(profile.name);
  const conflict = save.error instanceof ServerError && save.error.data?.reason === 'profile_conflict';
  const isDefault = profile.id === 'default';

  const change = (patch: Partial<ProfileInfo>) => {
    const next = { ...profile, ...patch };
    if (!isDefault && next.project === null && next.model === null) return;
    save.mutate(next);
  };

  return (
    <section aria-label={profileName(profile, t)} className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        {isDefault ? (
          <h2 className="grow text-title">{t.defaultProfile}</h2>
        ) : (
          <Input
            aria-label={t.name}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => name.trim() && name !== profile.name && change({ name: name.trim() })}
            className="max-w-80 border-transparent bg-transparent text-title hover:border-line"
          />
        )}
        {!isDefault && (
          <Menu.Root>
            <Menu.Trigger
              aria-label={t.profileMenu(profile.name)}
              className="ml-auto inline-flex size-7 cursor-pointer items-center justify-center rounded-sm text-fg-muted hover:bg-line"
            >
              <Dots />
            </Menu.Trigger>
            <Menu.Popup align="end">
              <Menu.Item className="text-danger" onClick={() => remove.mutate(profile.id)}>
                {t.deleteProfile}
              </Menu.Item>
            </Menu.Popup>
          </Menu.Root>
        )}
      </div>
      {isDefault ? (
        <p className="text-meta text-fg-muted">{t.defaultNote}</p>
      ) : (
        <div className="flex items-center gap-3 text-body">
          <span className="text-fg-muted">{t.usedWhere}</span>
          <label className="text-meta text-fg-muted" htmlFor="profile-project">
            {t.project}
          </label>
          <NativeSelect
            id="profile-project"
            className="max-w-56"
            value={profile.project ?? ''}
            onChange={(event) => change({ project: event.target.value || null })}
          >
            <option value="">{t.everyProject}</option>
            {projects.map((p) => (
              <option key={p.path} value={p.path}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
          <label className="text-meta text-fg-muted" htmlFor="profile-model">
            {t.model}
          </label>
          <NativeSelect
            id="profile-model"
            className="max-w-56"
            value={profile.model ?? ''}
            onChange={(event) => change({ model: event.target.value || null })}
          >
            <option value="">{t.everyModel}</option>
            {withCurrent(models, profile.model).map((model) => (
              <option key={model} value={model}>
                {model.slice(model.indexOf('/') + 1)}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
      <p
        role={conflict ? 'alert' : undefined}
        className={clsx('text-meta', conflict ? 'text-danger' : 'text-fg-muted')}
      >
        {conflict ? t.conflict : t.precedence}
      </p>
    </section>
  );
}

function ToolRow({
  name,
  label,
  does,
  source,
  ask,
  checked,
  locked = false,
  onChange,
  menu,
}: {
  name: string;
  label: string;
  does: string;
  source: string;
  ask: string;
  checked: boolean;
  /** On in every profile: the checkbox cannot turn it off. */
  locked?: boolean;
  onChange: (checked: boolean) => void;
  menu?: ReactNode;
}) {
  return (
    <div className={clsx(grid, 'group min-h-9 rounded-md text-body not-last:border-b not-last:border-line-subtle')}>
      <input
        id={`tool-${name}`}
        type="checkbox"
        checked={checked}
        disabled={locked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-interactive"
      />
      <label htmlFor={`tool-${name}`} className="flex min-w-0 items-baseline gap-2 whitespace-nowrap">
        <span className={clsx('truncate', !checked && 'text-fg-muted')}>{label}</span>
        {label !== name && <span className="truncate font-mono text-meta text-fg-muted">{name}</span>}
      </label>
      <span className={clsx('truncate', !checked && 'text-fg-muted')}>{does}</span>
      <span className="text-fg-muted">{source}</span>
      <span className={clsx(!checked && 'text-fg-muted')}>{ask}</span>
      <span>{menu}</span>
    </div>
  );
}

/** A file that cannot load: changed outside the app, or broken. Its tools stay off until it loads. */
function BlockedFile({ file, profileId }: { file: ToolFileInfo; profileId: string }) {
  const t = useMessages(toolMessages);
  const f = useFormat();
  const navigate = useNavigate();
  const confirm = useConfirmTool();
  const open = () =>
    void navigate({ to: '/settings/tools/$name', params: { name: file.name }, search: { profile: profileId } });
  return (
    <div className={clsx(grid, 'min-h-9 text-body not-last:border-b not-last:border-line-subtle')}>
      <input type="checkbox" disabled aria-label={file.name} className="size-4" />
      <span className="truncate font-mono text-meta text-fg-muted">{file.name}.py</span>
      {file.status === 'unconfirmed' ? (
        <span className="truncate">{t.unconfirmed(file.changedAt ? f.since(new Date(file.changedAt)) : '')}</span>
      ) : (
        <span className="truncate text-danger" title={file.error ?? undefined}>
          {t.loadError(file.error ?? '')}
        </span>
      )}
      <span className="text-fg-muted">{t.mine}</span>
      <span className="flex gap-1">
        {file.status === 'unconfirmed' ? (
          <>
            <LinkButton onClick={open}>{t.review}</LinkButton>
            <LinkButton onClick={() => confirm.mutate(file.name)}>{t.turnOn}</LinkButton>
          </>
        ) : (
          <LinkButton onClick={open}>{t.fix}</LinkButton>
        )}
      </span>
      <FileMenu file={file} profileId={profileId} />
    </div>
  );
}

function FileMenu({ file, profileId }: { file: ToolFileInfo; profileId: string }) {
  const t = useMessages(toolMessages);
  const navigate = useNavigate();
  const remove = useDeleteTool();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          aria-label={t.toolMenu(file.name)}
          className="inline-flex size-7 cursor-pointer items-center justify-center rounded-sm text-fg-muted hover:bg-line data-popup-open:bg-line"
        >
          <Dots />
        </Menu.Trigger>
        <Menu.Popup align="end">
          <Menu.Item
            onClick={() =>
              void navigate({
                to: '/settings/tools/$name',
                params: { name: file.name },
                search: { profile: profileId },
              })
            }
          >
            {t.edit}
          </Menu.Item>
          <Menu.Separator />
          <Menu.Item className="text-danger" onClick={() => setConfirming(true)}>
            {t.deleteTool}
          </Menu.Item>
        </Menu.Popup>
      </Menu.Root>
      <Dialog.Root open={confirming} onOpenChange={setConfirming}>
        <Dialog.Popup size="sm">
          <Dialog.Title>{t.deleteToolTitle(`${file.name}.py`)}</Dialog.Title>
          <Dialog.Description>{t.deleteToolBody}</Dialog.Description>
          <div className="flex justify-end gap-2 pt-2">
            <Dialog.Close render={<Button />}>{t.cancel}</Dialog.Close>
            <Button
              variant="danger"
              onClick={() => remove.mutate(file.name, { onSuccess: () => setConfirming(false) })}
            >
              {t.delete}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Root>
    </>
  );
}

function AddToolMenu({ profileId }: { profileId: string }) {
  const t = useMessages(toolMessages);
  const navigate = useNavigate();
  return (
    <Menu.Root>
      <Menu.Trigger render={<Button />}>{t.addTool}</Menu.Trigger>
      <Menu.Popup align="end" className="w-72">
        <Menu.Item
          onClick={() =>
            void navigate({ to: '/settings/tools/$name', params: { name: 'new' }, search: { profile: profileId } })
          }
        >
          <span className="flex flex-col">
            <span>{t.createTool}</span>
            <span className="text-meta text-fg-muted">{t.createToolNote}</span>
          </span>
        </Menu.Item>
        <Menu.Item disabled>
          <span className="flex flex-col">
            <span className="text-fg-muted">{t.connectService}</span>
            <span className="text-meta text-fg-muted">{t.connectServiceNote}</span>
          </span>
        </Menu.Item>
      </Menu.Popup>
    </Menu.Root>
  );
}

function NewProfileDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const t = useMessages(toolMessages);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Popup size="sm">
        <Dialog.Title>{t.newProfile}</Dialog.Title>
        {open && <NewProfileForm onCreated={onCreated} />}
      </Dialog.Popup>
    </Dialog.Root>
  );
}

/** Mounted while the dialog is open, so it starts empty every time. */
function NewProfileForm({ onCreated }: { onCreated: (id: string) => void }) {
  const t = useMessages(toolMessages);
  const save = useSaveProfile();
  const projects = useProjects().data?.projects ?? [];
  const models = useAllModels();
  const [name, setName] = useState('');
  const [project, setProject] = useState('');
  const [model, setModel] = useState('');
  const conflict = save.error instanceof ServerError && save.error.data?.reason === 'profile_conflict';
  const ready = name.trim() !== '' && (project !== '' || model !== '');

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        save.mutate(
          { id: '', name: name.trim(), project: project || null, model: model || null, tools: [...BUILTIN] },
          { onSuccess: (profile) => onCreated(profile.id) },
        );
      }}
    >
      <Field label={t.name} id="new-profile-name">
        <Input id="new-profile-name" value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label={t.project} id="new-profile-project">
        <NativeSelect id="new-profile-project" value={project} onChange={(event) => setProject(event.target.value)}>
          <option value="">{t.everyProject}</option>
          {projects.map((p) => (
            <option key={p.path} value={p.path}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label={t.model} id="new-profile-model">
        <NativeSelect id="new-profile-model" value={model} onChange={(event) => setModel(event.target.value)}>
          <option value="">{t.everyModel}</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m.slice(m.indexOf('/') + 1)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <p
        className={clsx('text-meta', conflict ? 'text-danger' : 'text-fg-muted')}
        role={conflict ? 'alert' : undefined}
      >
        {conflict ? t.conflict : t.needsPlace}
      </p>
      <div className="flex justify-end gap-2">
        <Dialog.Close render={<Button />}>{t.cancel}</Dialog.Close>
        <Button type="submit" variant="primary" disabled={!ready || save.isPending}>
          {t.create}
        </Button>
      </div>
    </form>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-meta text-fg-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

function SavedToast({ tool, profile }: { tool: string; profile: string }) {
  const t = useMessages(toolMessages);
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setShown(false), 5000);
    return () => clearTimeout(timer);
  }, []);
  if (!shown) return null;
  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 flex min-h-10 -translate-x-1/2 items-center rounded-lg bg-fg px-4 text-body whitespace-nowrap text-on-fill"
    >
      {t.savedToast(tool, profile)}
    </div>
  );
}

const BUILTIN = ['read', 'glob', 'grep', 'write', 'edit', 'bash'];

/** Every model of every connection, as `<connection>/<model>`. */
function useAllModels(): string[] {
  const data = useConnections().data;
  const lists = useModelsOf(
    (data?.connections ?? []).map((c) => (c.provider ? { provider: c.provider } : { baseUrl: c.baseUrl ?? '' })),
  );
  return (data?.connections ?? []).flatMap((c, i) => (lists[i]?.data?.models ?? []).map((m) => `${c.name}/${m}`));
}

function withCurrent(models: string[], current: string | null) {
  return current && !models.includes(current) ? [current, ...models] : models;
}

function askLabel(tool: ToolSummary, t: Messages) {
  return tool.ask === 'never' ? t.askNever : tool.ask === 'edit' ? t.askEdit : t.askAsk;
}

function firstLine(text: string) {
  return text.split('\n')[0] ?? '';
}

function Dots() {
  return <MoreVertical size={16} strokeWidth={1.5} aria-hidden="true" />;
}
