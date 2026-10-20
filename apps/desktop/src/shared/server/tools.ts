import { useQuery } from '@tanstack/react-query';

import { useServer } from './context';

/** Every tool a session can get, and where each comes from. */
export function useTools() {
  const server = useServer();
  return useQuery({ queryKey: ['tools'], queryFn: () => server.request('tools/list', {}), retry: false });
}
