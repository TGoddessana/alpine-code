import type { StorybookConfig } from '@storybook/react-vite';

// One catalogue for the primitives (packages/ui) and the app's screens and parts.
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.tsx', '../../../packages/ui/src/**/*.stories.tsx'],
  framework: '@storybook/react-vite',
};

export default config;
