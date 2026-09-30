import { describe, expect, it } from 'vitest';

import { ServerError } from './connection';
import { jsonRpcConnection } from './jsonrpc';

function fakeTransport() {
  const sent: string[] = [];
  let deliver: (line: string) => void = () => {};
  return {
    sent,
    receive: (message: object) => deliver(JSON.stringify(message)),
    transport: {
      send: async (line: string) => void sent.push(line),
      onLine: (listener: (line: string) => void) => void (deliver = listener),
    },
  };
}

describe('jsonRpcConnection', () => {
  it('matches a response to its request', async () => {
    const fake = fakeTransport();
    const connection = jsonRpcConnection(fake.transport);
    const reply = connection.request('initialize', { protocolVersion: 1, clientName: 'test' });
    const { id } = JSON.parse(fake.sent[0]!);
    fake.receive({ jsonrpc: '2.0', id, result: { protocolVersion: 1, server: { name: 's', version: '1' } } });
    await expect(reply).resolves.toEqual({ protocolVersion: 1, server: { name: 's', version: '1' } });
  });

  it('rejects with the server error', async () => {
    const fake = fakeTransport();
    const connection = jsonRpcConnection(fake.transport);
    const reply = connection.request('initialize', { protocolVersion: 1, clientName: 'test' });
    const { id } = JSON.parse(fake.sent[0]!);
    fake.receive({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Unknown method' } });
    await expect(reply).rejects.toEqual(new ServerError(-32601, 'Unknown method'));
  });

  it('ignores responses meant for another window', async () => {
    const mine = fakeTransport();
    const other = fakeTransport();
    const a = jsonRpcConnection(mine.transport, 'a');
    const b = jsonRpcConnection(other.transport, 'b');
    const params = { protocolVersion: 1, clientName: 'test' };
    const first = a.request('initialize', params);
    const second = b.request('initialize', params);
    const idA = JSON.parse(mine.sent[0]!).id;
    const idB = JSON.parse(other.sent[0]!).id;
    expect(idA).not.toEqual(idB);
    // The shell hands both windows every response.
    const answer = (id: string, name: string) => ({
      jsonrpc: '2.0',
      id,
      result: { protocolVersion: 1, server: { name, version: '1' } },
    });
    for (const fake of [mine, other]) {
      fake.receive(answer(idA, 'for-a'));
      fake.receive(answer(idB, 'for-b'));
    }
    await expect(first).resolves.toMatchObject({ server: { name: 'for-a' } });
    await expect(second).resolves.toMatchObject({ server: { name: 'for-b' } });
  });

  it('passes notifications to subscribers', () => {
    const fake = fakeTransport();
    const connection = jsonRpcConnection(fake.transport);
    const seen: string[] = [];
    connection.subscribe((notification) => seen.push(notification.method));
    fake.receive({ jsonrpc: '2.0', method: 'session/event', params: { seq: 1 } });
    expect(seen).toEqual(['session/event']);
  });
});
