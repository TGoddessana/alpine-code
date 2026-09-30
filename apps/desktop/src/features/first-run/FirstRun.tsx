import { Button, Dialog, OptionList } from '@alpine/ui/primitives';
import { useState } from 'react';

import { ApiKeyForm, connectMessages, LocalServerForm, useConnectPrompt } from '@/shared/components/connect';
import { useMessages } from '@/shared/i18n';
import { useConnections } from '@/shared/server';

import { messages } from './messages';

type Method = 'chatgpt' | 'copilot' | 'api-key' | 'local';
type Step = 'method' | 'api-key' | 'local';

/**
 * The one thing the first run asks: connect a model. Opens over the empty new session while nothing is connected;
 * 'Later' closes it until the first message is sent.
 */
export function FirstRun() {
  const connections = useConnections();
  const { dismissed, dismiss } = useConnectPrompt();
  const [step, setStep] = useState<Step>('method');
  const needed =
    connections.isSuccess && connections.data.connections.length === 0 && connections.data.defaultModel === null;

  return (
    <Dialog.Root open={needed && !dismissed} onOpenChange={(open) => !open && dismiss()} disablePointerDismissal>
      <Dialog.Popup>
        {step === 'method' && <MethodStep onNext={setStep} />}
        {step === 'api-key' && (
          <ApiKeyForm providers={connections.data?.providers ?? []} onBack={() => setStep('method')} makeDefault />
        )}
        {step === 'local' && <LocalServerForm onBack={() => setStep('method')} makeDefault />}
      </Dialog.Popup>
    </Dialog.Root>
  );
}

function MethodStep({ onNext }: { onNext: (step: Step) => void }) {
  const t = useMessages(messages);
  const c = useMessages(connectMessages);
  // Subscription sign-in comes with its own work; until then those rows show what is coming.
  const [method, setMethod] = useState<Method>('api-key');
  return (
    <>
      <div className="flex flex-col gap-2">
        <Dialog.Title>{t.title}</Dialog.Title>
        <Dialog.Description>{t.lead}</Dialog.Description>
      </div>
      <OptionList<Method>
        aria-label={t.methods}
        value={method}
        onValueChange={setMethod}
        options={[
          { value: 'chatgpt', label: c.chatgpt, description: c.soon, disabled: true },
          { value: 'copilot', label: c.copilot, description: c.soon, disabled: true },
          { value: 'api-key', label: c.apiKey, description: c.apiKeyNote },
          { value: 'local', label: c.local, description: c.localNote },
        ]}
      />
      <p className="text-meta text-fg-muted">{c.claudeNote}</p>
      <div className="flex justify-end gap-2 pt-2">
        <Dialog.Close render={<Button />}>{t.later}</Dialog.Close>
        <Button variant="primary" onClick={() => onNext(method === 'local' ? 'local' : 'api-key')}>
          {t.next}
        </Button>
      </div>
    </>
  );
}
