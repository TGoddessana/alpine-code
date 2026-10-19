import { AutoHeight, Button, Dialog, OptionList } from '@alpine/ui/primitives';
import { useState } from 'react';

import { BrandMark } from '@/shared/components/brand';
import { AlpineSignIn } from '@/shared/components/cloud';

import {
  ApiKeyForm,
  ChatGPTSignIn,
  connectMessages,
  LocalServerForm,
  useConnectPrompt,
} from '@/shared/components/connect';
import { useMessages } from '@/shared/i18n';
import { useConnections } from '@/shared/server';

import { messages } from './messages';

type Method = 'alpine' | 'chatgpt' | 'copilot' | 'api-key' | 'local';
type Step = 'method' | 'alpine' | 'chatgpt' | 'api-key' | 'local';

/**
 * The one thing the first run asks: how the AI is paid for. Alpine's own credits come first (decision 23 in
 * docs/alpine-cloud.md): that row is the Alpine sign-in, so there is no separate login. ChatGPT, an API key or a local
 * server follow for people who already pay for their AI. Opens over the empty new session while nothing is
 * connected; 'Later' closes it until the first message is sent.
 */
export function FirstRun() {
  const connections = useConnections();
  const { dismissed, dismiss } = useConnectPrompt();
  const [step, setStep] = useState<Step>('method');
  const needed =
    connections.isSuccess && connections.data.connections.length === 0 && connections.data.defaultModel === null;

  return (
    // A ChatGPT sign-in connects before its welcome is read, so the sheet stays until that step is done.
    <Dialog.Root
      open={(needed || step === 'chatgpt' || step === 'alpine') && !dismissed}
      onOpenChange={(open) => !open && dismiss()}
      disablePointerDismissal
    >
      <Dialog.Popup>
        <AutoHeight>
          <div key={step} className="motion-step flex flex-col gap-4">
            {step === 'method' && <MethodStep onNext={setStep} />}
            {step === 'alpine' && <AlpineSignIn welcome onBack={() => setStep('method')} onDone={() => dismiss()} />}
            {step === 'chatgpt' && (
              <ChatGPTSignIn
                onBack={() => setStep('method')}
                onApiKey={() => setStep('api-key')}
                onDone={() => setStep('method')}
                makeDefault
              />
            )}
            {step === 'api-key' && (
              <ApiKeyForm providers={connections.data?.providers ?? []} onBack={() => setStep('method')} makeDefault />
            )}
            {step === 'local' && <LocalServerForm onBack={() => setStep('method')} makeDefault />}
          </div>
        </AutoHeight>
      </Dialog.Popup>
    </Dialog.Root>
  );
}

function MethodStep({ onNext }: { onNext: (step: Step) => void }) {
  const t = useMessages(messages);
  const c = useMessages(connectMessages);
  // Copilot sign-in comes with its own work; until then its row shows what is coming.
  const [method, setMethod] = useState<Method>('alpine');
  return (
    <>
      <div className="flex flex-col gap-2">
        <BrandMark size={64} />
        <Dialog.Title>{t.title}</Dialog.Title>
        <Dialog.Description>{t.lead}</Dialog.Description>
      </div>
      <OptionList<Method>
        aria-label={t.methods}
        value={method}
        onValueChange={setMethod}
        options={[
          { value: 'alpine', label: t.alpine, description: t.alpineNote },
          { value: 'chatgpt', label: c.chatgpt, description: c.chatgptNote },
          { value: 'copilot', label: c.copilot, description: c.soon, disabled: true },
          { value: 'api-key', label: c.apiKey, description: c.apiKeyNote },
          { value: 'local', label: c.local, description: c.localNote },
        ]}
      />
      <p className="text-meta text-fg-muted">{c.claudeNote}</p>
      <div className="flex justify-end gap-2 pt-2">
        <Dialog.Close render={<Button />}>{t.later}</Dialog.Close>
        <Button variant="primary" onClick={() => onNext(method === 'copilot' ? 'api-key' : method)}>
          {method === 'alpine' ? t.continueWithAlpine : method === 'chatgpt' ? c.continueWithChatGPT : t.next}
        </Button>
      </div>
    </>
  );
}
