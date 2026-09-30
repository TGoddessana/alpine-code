import type { ProviderInfo } from '@alpine/protocol';
import { Button, Dialog, Input, LinkButton, NativeSelect } from '@alpine/ui/primitives';
import { useState } from 'react';

import { useMessages } from '@/shared/i18n';
import { useAddConnection } from '@/shared/server';

import { CheckResult, Form, Hint, ModelField, useModelCheck } from './check';
import { messages } from './messages';

export interface ConnectFormProps {
  /** Shows '‹ How to connect' and 'Back'; without it the sheet has 'Cancel', which closes it. */
  onBack?: () => void;
  onDone?: () => void;
  /** Start new sessions with the chosen model. */
  makeDefault: boolean;
}

/** Provider, key, model. The key is checked as soon as typing stops, which fills the model list. */
export function ApiKeyForm({
  providers,
  initialProvider,
  onBack,
  onDone,
  makeDefault,
}: ConnectFormProps & { providers: ProviderInfo[]; initialProvider?: string }) {
  const t = useMessages(messages);
  const [providerId, setProviderId] = useState(initialProvider ?? providers[0]?.id ?? '');
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const add = useAddConnection();
  const check = useModelCheck(key.trim() ? { provider: providerId, apiKey: key.trim() } : null);
  const provider = providers.find((p) => p.id === providerId);

  const submit = () =>
    add.mutate({ provider: providerId, apiKey: key.trim(), model: model.trim(), makeDefault }, { onSuccess: onDone });

  return (
    <>
      <div className="flex flex-col items-start gap-2">
        {onBack && (
          <LinkButton className="-ml-1" onClick={onBack}>
            {t.backToMethods}
          </LinkButton>
        )}
        <Dialog.Title>{t.apiKeyTitle}</Dialog.Title>
        <Dialog.Description>{t.apiKeyLead}</Dialog.Description>
      </div>
      <Form>
        <label htmlFor="connect-provider">{t.provider}</label>
        <NativeSelect id="connect-provider" value={providerId} onChange={(event) => setProviderId(event.target.value)}>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
        {provider && <Hint>{provider.billing === 'subscription' ? t.subscription : t.usage}</Hint>}
        <label htmlFor="connect-key">{t.key}</label>
        <Input
          id="connect-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onValueChange={(next) => setKey(next)}
          aria-describedby="connect-key-check"
          aria-invalid={check.error && check.error.data?.reason !== 'unsupported' ? true : undefined}
        />
        <CheckResult id="connect-key-check" check={check} found={t.keyChecked} />
        <label htmlFor="connect-model">{t.model}</label>
        <ModelField
          id="connect-model"
          check={check}
          value={model}
          onChange={setModel}
          waitingText={t.modelAfterCheck}
        />
      </Form>
      <Footer
        onBack={onBack}
        error={add.error ? t.connectFailed(add.error.message) : undefined}
        disabled={!model.trim() || add.isPending}
        onSubmit={submit}
      />
    </>
  );
}

export function Footer({
  onBack,
  error,
  disabled,
  onSubmit,
}: {
  onBack?: () => void;
  error?: string;
  disabled: boolean;
  onSubmit: () => void;
}) {
  const t = useMessages(messages);
  return (
    <>
      {error && <p className="text-meta text-danger">{error}</p>}
      <div className="flex justify-end gap-2 pt-2">
        {onBack ? (
          <Button onClick={onBack}>{t.back}</Button>
        ) : (
          <Dialog.Close render={<Button />}>{t.cancel}</Dialog.Close>
        )}
        <Button variant="primary" disabled={disabled} onClick={onSubmit}>
          {t.connect}
        </Button>
      </div>
    </>
  );
}
