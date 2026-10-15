import { expect, it } from 'vitest';

import { productMapMessage } from './productMapMessage';

it('retains the complete task context separately from the user request', () => {
  expect(
    productMapMessage(
      'Add guest orders\n\n<alpine-product-map-context>\nNode: cart\nSchema: map.json\n</alpine-product-map-context>',
    ),
  ).toEqual({ request: 'Add guest orders', context: 'Node: cart\nSchema: map.json' });
  expect(productMapMessage('ordinary message')).toBeNull();
  expect(productMapMessage('Text\n\n<alpine-product-map-context>\nunfinished')).toBeNull();
});
