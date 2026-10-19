import { AutoHeight, Button, LinkButton } from '@alpine/ui/primitives';
import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useFormat, useMessages } from '@/shared/i18n';
import { openInBrowser } from '@/shared/platform';
import { useCheckout, useCloudPlans, useCloudStatus, useStartTrial } from '@/shared/server';

import { AlpineSignIn } from './AlpineSignIn';
import { messages } from './messages';

export interface UpgradeSheetProps {
  /** Why Pro is offered now, when something asked for it (a realtime web app). Replaces the usual lead. */
  reason?: string;
  onBack?: () => void;
  /** The account is on Pro (a trial counts): whatever needed it can go on. */
  onDone: () => void;
}

/**
 * Pro, offered where it is needed: choosing a realtime web app on the free plan, a custom domain, the badge, longer
 * restore points, and Settings (decisions 20, 23 in docs/alpine-cloud.md). The free week starts at once without a card
 * (`cloud/startTrial`); paying opens the payment page in the browser (`cloud/checkout`), and the plan arrives by itself as
 * `cloud/changed` when the person is back. What Pro gives is read from the plan the server lists, never written here.
 */
export function UpgradeSheet({ reason, onBack, onDone }: UpgradeSheetProps) {
  const t = useMessages(messages);
  const format = useFormat();
  const cloud = useCloudStatus().data;
  const plans = useCloudPlans().data?.plans;
  const trial = useStartTrial();
  const checkout = useCheckout();
  const [paying, setPaying] = useState<string | null>(null);

  const plan = cloud?.plan;
  const pro = plan?.id === 'pro';
  // Paying elsewhere finished: the status changed to Pro. A trial that is only running keeps the sheet (it can subscribe).
  const paid = pro && plan?.status === 'active';
  useEffect(() => {
    if (paying && paid) onDone();
  }, [paying, paid, onDone]);

  if (cloud && !cloud.signedIn)
    return <AlpineSignIn reason={t.upgradeSignInReason} onBack={onBack} onDone={() => {}} />;

  const info = plans?.find((candidate) => candidate.id === 'pro');
  const limits = info?.limits;
  const trialDays = info?.trialDays ?? 0;
  const canTry = !plan?.trialUsed && trialDays > 0 && !pro;
  const price = info?.price as { amount?: number | string; currency?: string; interval?: string } | null | undefined;

  const pay = () =>
    checkout.mutate(undefined, {
      onSuccess: ({ url }) => {
        setPaying(url);
        void openInBrowser(url);
      },
    });

  if (paying)
    return (
      <AutoHeight>
        <div className="motion-step flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-title">{t.payTitle}</h2>
            <p className="text-body text-fg-muted">{t.payLead}</p>
          </div>
          <p role="status" className="inline-flex items-center gap-2 text-meta text-fg-muted">
            <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-interactive" />
            Pro
          </p>
          <div className="flex items-center justify-between">
            <LinkButton onClick={() => setPaying(null)}>{t.payCancel}</LinkButton>
            <LinkButton onClick={() => void openInBrowser(paying)}>{t.payAgain}</LinkButton>
          </div>
        </div>
      </AutoHeight>
    );

  const perks = [
    t.perkRealtime,
    t.perkDomain,
    t.perkBadge,
    ...(limits ? [t.perkCredits(format.number(limits.monthlyCredits)), t.perkRestore(limits.restoreDays)] : []),
  ];
  return (
    <AutoHeight>
      <div className="motion-step flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-title">{t.upgradeTitle}</h2>
          <p className="text-body text-fg-muted">
            {reason ?? (plan?.trialEndsAt ? t.trialEnds(format.date(new Date(plan.trialEndsAt))) : t.upgradeLead)}
          </p>
        </div>
        <ul className="flex flex-col gap-1.5">
          {perks.map((perk) => (
            <li key={perk} className="flex items-start gap-2 text-body text-fg">
              <Check aria-hidden="true" size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-interactive" />
              {perk}
            </li>
          ))}
        </ul>
        <p className="text-meta text-fg-muted">
          {price?.amount != null ? `${price.amount} ${price.currency ?? ''}`.trim() : t.priceSoon}
        </p>
        {(trial.isError || checkout.isError) && (
          <p role="alert" className="text-meta text-danger">
            {trial.isError ? t.trialFailed : t.checkoutFailed}
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          {onBack ? <LinkButton onClick={onBack}>{t.back}</LinkButton> : <span />}
          <div className="flex items-center gap-3">
            {canTry ? (
              <>
                <LinkButton disabled={checkout.isPending} onClick={pay}>
                  {t.subscribeNow}
                </LinkButton>
                <Button
                  variant="primary"
                  autoFocus
                  disabled={trial.isPending}
                  onClick={() => trial.mutate(undefined, { onSuccess: onDone })}
                >
                  {t.startTrial(trialDays)}
                </Button>
              </>
            ) : (
              <Button variant="primary" autoFocus disabled={checkout.isPending} onClick={pay}>
                {t.subscribe}
              </Button>
            )}
          </div>
        </div>
        {canTry && <p className="-mt-2 text-right text-meta text-fg-muted">{t.trialNote}</p>}
      </div>
    </AutoHeight>
  );
}
