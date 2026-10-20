import { Button, Dialog, LinkButton } from '@alpine/ui/primitives';
import { useState } from 'react';

import { AlpineSignIn, UpgradeSheet } from '@/shared/components/cloud';
import { useFormat, useMessages } from '@/shared/i18n';
import { openInBrowser } from '@/shared/platform';
import { useCloudSignOut, useCloudStatus, usePortal } from '@/shared/server';

import { messages } from './messages';

/**
 * The Alpine account in Settings › General: who is signed in, the plan, the credits left and when they fill up
 * again. Signed out it is a way in. Nothing shows until the server has answered `cloud/status`.
 */
export function AlpineAccount() {
  const t = useMessages(messages);
  const format = useFormat();
  const status = useCloudStatus().data;
  const signOut = useCloudSignOut();
  const portal = usePortal();
  const [sheet, setSheet] = useState<'sign-in' | 'sign-out' | 'upgrade' | null>(null);
  if (!status) return null;

  const { account, plan, credits } = status;
  const planName =
    plan?.status === 'trialing' && plan.trialEndsAt
      ? t.planTrial(format.date(new Date(plan.trialEndsAt)))
      : plan?.id === 'pro'
        ? t.planPro
        : t.planFree;

  return (
    <>
      <dt className="self-start pt-1.5 text-fg-muted">{t.alpineAccount}</dt>
      <dd className="flex flex-col items-start gap-1">
        {status.signedIn && account ? (
          <>
            <span className="flex items-center gap-2">
              {account.name ? `${account.name} · ${account.email}` : account.email}
              <LinkButton onClick={() => setSheet('sign-out')}>{t.alpineSignOut}</LinkButton>
            </span>
            <span className="flex items-center gap-2 text-meta text-fg-muted">
              {planName}
              {plan?.id === 'pro' && plan.status === 'active' ? (
                <LinkButton
                  disabled={portal.isPending}
                  onClick={() => portal.mutate(undefined, { onSuccess: ({ url }) => void openInBrowser(url) })}
                >
                  {t.planManage}
                </LinkButton>
              ) : (
                <LinkButton onClick={() => setSheet('upgrade')}>
                  {plan?.status === 'trialing' ? t.planSubscribe : t.planUpgrade}
                </LinkButton>
              )}
            </span>
            {portal.isError && (
              <span role="alert" className="text-meta text-danger">
                {t.portalFailed}
              </span>
            )}
            {credits && (
              <span className="text-meta text-fg-muted">
                {t.credits(format.number(credits.balance))}
                {credits.refillsAt && ` · ${t.refills(format.date(new Date(credits.refillsAt)))}`}
              </span>
            )}
            {!status.reachable && (
              <span role="status" className="text-meta text-fg-muted">
                {t.alpineOffline}
              </span>
            )}
          </>
        ) : (
          <span className="flex items-center gap-2 pt-1.5 text-fg-muted">
            {t.alpineSignedOut}
            <LinkButton onClick={() => setSheet('sign-in')}>{t.alpineSignIn}</LinkButton>
          </span>
        )}
      </dd>
      <Dialog.Root open={sheet === 'sign-in'} onOpenChange={(open) => !open && setSheet(null)}>
        <Dialog.Popup>
          <AlpineSignIn onClose={() => setSheet(null)} onDone={() => setSheet(null)} />
        </Dialog.Popup>
      </Dialog.Root>
      <Dialog.Root open={sheet === 'upgrade'} onOpenChange={(open) => !open && setSheet(null)}>
        <Dialog.Popup>
          <UpgradeSheet onClose={() => setSheet(null)} onDone={() => setSheet(null)} />
        </Dialog.Popup>
      </Dialog.Root>
      <Dialog.Root open={sheet === 'sign-out'} onOpenChange={(open) => !open && setSheet(null)}>
        <Dialog.Popup size="sm" role="alertdialog">
          <div className="flex flex-col gap-2">
            <Dialog.Title>{t.signOutTitle}</Dialog.Title>
            <Dialog.Description>{t.signOutLead}</Dialog.Description>
          </div>
          {signOut.error && (
            <p role="alert" className="text-meta text-danger">
              {signOut.error.message}
            </p>
          )}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Dialog.Close render={<Button />}>{t.cancel}</Dialog.Close>
            <Button
              variant="danger"
              disabled={signOut.isPending}
              onClick={() => signOut.mutate(undefined, { onSuccess: () => setSheet(null) })}
            >
              {t.alpineSignOut}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Root>
    </>
  );
}
