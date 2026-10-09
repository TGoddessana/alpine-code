import type { Card } from './cards';
import type { Messages } from './code';

/** Why a file's card cannot be added yet: changed outside the app, or broken. */
export function statusLine(card: Card, t: Messages, since: (date: Date) => string) {
  if (card.status === 'unconfirmed') return t.unconfirmed(card.changedAt ? since(new Date(card.changedAt)) : '');
  return t.loadError(card.error ?? '');
}
