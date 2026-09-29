import { PROTOCOL_VERSION } from '@alpine/protocol';
import { useQuery } from '@tanstack/react-query';

import { useServer } from './context';

/** The handshake: which server answered and which protocol version it speaks. */
export function useServerInfo() {
  const server = useServer();
  return useQuery({
    queryKey: ['server', 'initialize'],
    queryFn: () => server.request('initialize', { protocolVersion: PROTOCOL_VERSION, clientName: 'desktop' }),
    staleTime: Infinity,
    retry: false, // A local server that refused the handshake will refuse it again.
  });
}
