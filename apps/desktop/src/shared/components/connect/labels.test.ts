import { describe, expect, it } from 'vitest';

import { isLocal } from './labels';

describe('isLocal', () => {
  it('tells a server on this computer or network from a hosted one', () => {
    for (const url of [
      'http://localhost:11434/v1',
      'http://127.0.0.1:1234',
      'http://[::1]:8000/v1',
      'http://192.168.0.7/v1',
      'http://studio.local:1234',
    ])
      expect(isLocal(url)).toBe(true);
    for (const url of ['https://llm.onerouter.pro/v1', 'https://172.32.0.1/v1', 'not a url', null])
      expect(isLocal(url)).toBe(false);
  });
});
