import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { LocaleProvider, type Locale } from '@/shared/i18n';
import { ServerProvider, type ServerConnection } from '@/shared/server';

/** Everything a screen needs around it. The app and Storybook both use this. */
export function Providers({
  connection,
  locale,
  children,
}: {
  connection: ServerConnection;
  locale?: Locale;
  children: ReactNode;
}) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <ServerProvider connection={connection}>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </ServerProvider>
    </QueryClientProvider>
  );
}
