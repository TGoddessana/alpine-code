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
import { useCloudEnabled, useConnections } from '@/shared/server';

import { messages } from './messages';

type Method = 'alpine' | 'chatgpt' | 'copilot' | 'api-key' | 'local';
type Step = 'method' | 'alpine' | 'chatgpt' | 'api-key' | 'local';

/**
 * The one thing the first run asks: how the AI is paid for. Alpine's own credits come first (decision 23 in
 * docs/alpine-cloud.md): that row is the Alpine sign-in, so there is no separate login. ChatGPT, an API key or a local
 * server follow for people who already pay for their AI. Opens over the empty new session while nothing is
 * connected; 'Later' closes it until the first message is sent. `auto` is whether it may open by itself: only on the new
 * session, so signing out in Settings or publishing signed out does not stack it over that screen's own sheet.
 */
export function FirstRun({ auto }: { auto: boolean }) {
  const connections = useConnections();
  const { dismissed, dismiss } = useConnectPrompt();
  const [step, setStep] = useState<Step>('method');
  const needed =
    connections.isSuccess && connections.data.connections.length === 0 && connections.data.defaultModel === null;

  return (
    // A ChatGPT sign-in connects before its welcome is read, so the sheet stays until that step is done.
    <Dialog.Root
      open={((needed && auto) || step === 'chatgpt' || step === 'alpine') && !dismissed}
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
  // Alpine's own credits come first only while Alpine Cloud is on; otherwise the list starts at ChatGPT.
  const cloud = useCloudEnabled();
  const [chosen, setChosen] = useState<Method | null>(null);
  const method = chosen ?? (cloud ? 'alpine' : 'chatgpt');
  return (
    <>
      <div className="flex flex-col gap-2">
        <BrandMark size={64} />
        <Dialog.Title>{cloud ? t.title : t.connectTitle}</Dialog.Title>
        <Dialog.Description>{cloud ? t.lead : t.connectLead}</Dialog.Description>
      </div>
      <OptionList<Method>
        aria-label={cloud ? t.methods : t.connectMethods}
        value={method}
        onValueChange={setChosen}
        options={[
          ...(cloud ? [{ value: 'alpine' as const, label: t.alpine, description: t.alpineNote }] : []),
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
