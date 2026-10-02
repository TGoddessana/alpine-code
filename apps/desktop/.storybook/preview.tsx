import type { Preview } from '@storybook/react-vite';

import { Providers } from '../src/app/providers';
import type { Locale } from '../src/shared/i18n';
import { usePanelTab } from '../src/shared/panel';
import { scriptedConnection, type Script } from '../src/shared/server';
import '../src/app/styles.css';

/**
 * Every story runs against a scripted server: set `parameters.server` to a `Script` to put a screen in the state
 * a design canvas board shows. The toolbar switches the language.
 */
const preview: Preview = {
  globalTypes: {
    locale: {
      description: 'Language',
      toolbar: {
        title: 'Language',
        icon: 'globe',
        items: [
          { value: 'ko', title: '한국어' },
          { value: 'en', title: 'English' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { locale: 'ko' },
  // The right panel's tab is shared screen state; every story starts on 'all'.
  beforeEach: () => {
    usePanelTab.setState({ tab: 'all' });
  },
  decorators: [
    (Story, { globals, parameters }) => (
      <Providers connection={scriptedConnection(parameters.server as Script)} locale={globals.locale as Locale}>
        <Story />
      </Providers>
    ),
  ],
};

export default preview;
