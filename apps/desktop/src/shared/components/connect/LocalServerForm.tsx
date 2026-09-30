import { Dialog, Input, LinkButton } from '@alpine/ui/primitives';
import { useState } from 'react';

import { useMessages } from '@/shared/i18n';
import { useAddConnection } from '@/shared/server';

import { Footer, type ConnectFormProps } from './ApiKeyForm';
import { CheckResult, Form, ModelField, useModelCheck } from './check';
import { messages } from './messages';

/** Ollama's address to start with: the most common local server. */
const DEFAULT_ADDRESS = 'http://localhost:11434/v1';

/** Address, an optional key, model. The address is asked for its models as soon as typing stops. */
export function LocalServerForm({
  initialAddress,
  onBack,
  onDone,
  makeDefault,
}: ConnectFormProps & { initialAddress?: string }) {
  const t = useMessages(messages);
  const [address, setAddress] = useState(initialAddress ?? DEFAULT_ADDRESS);
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const add = useAddConnection();
  const baseUrl = address.trim();
  const apiKey = key.trim() || undefined;
  const check = useModelCheck(baseUrl ? { baseUrl, apiKey } : null);

  const submit = () => add.mutate({ baseUrl, apiKey, model: model.trim(), makeDefault }, { onSuccess: onDone });

  return (
    <>
      <div className="flex flex-col items-start gap-2">
        {onBack && (
          <LinkButton className="-ml-1" onClick={onBack}>
            {t.backToMethods}
          </LinkButton>
        )}
        <Dialog.Title>{t.localTitle}</Dialog.Title>
        <Dialog.Description>{t.localLead}</Dialog.Description>
      </div>
      <Form>
        <label htmlFor="connect-address">{t.address}</label>
        <Input
          id="connect-address"
          mono
          spellCheck={false}
          value={address}
          onValueChange={(next) => setAddress(next)}
          aria-describedby="connect-address-check"
        />
        <CheckResult id="connect-address-check" check={check} found={t.serverAnswered} />
        <label htmlFor="connect-local-key">{t.localKey}</label>
        <Input
          id="connect-local-key"
          type="password"
          autoComplete="off"
          placeholder={t.localKeyPlaceholder}
          value={key}
          onValueChange={(next) => setKey(next)}
        />
        <label htmlFor="connect-local-model">{t.model}</label>
        <ModelField
          id="connect-local-model"
          check={check}
          value={model}
          onChange={setModel}
          waitingText={t.modelAfterAddress}
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
