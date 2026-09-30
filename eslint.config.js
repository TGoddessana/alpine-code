// @ts-check
import js from '@eslint/js';
import betterTailwind from 'eslint-plugin-better-tailwindcss';
import boundaries from 'eslint-plugin-boundaries';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/storybook-static/**',
      '**/src-tauri/**',
      '**/routeTree.gen.ts',
      'packages/protocol/typescript/src/generated.ts',
      '.venv/**',
      'bench/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },

  // Desktop app layers: app assembles features; features never import each other; shared imports neither.
  {
    files: ['apps/desktop/src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'import/resolver': { typescript: { project: 'apps/desktop/tsconfig.json' } },
      'boundaries/root-path': 'apps/desktop',
      'boundaries/elements': [
        { type: 'app', pattern: 'src/app' },
        { type: 'feature', pattern: 'src/features/*', capture: ['name'] },
        { type: 'shared', pattern: 'src/shared' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            {
              from: { element: { type: 'app' } },
              allow: { to: { element: { types: { anyOf: ['app', 'feature', 'shared'] } } } },
            },
            {
              from: { element: { type: 'feature' } },
              allow: { to: { element: { type: 'shared' } } },
            },
            { from: { element: { type: 'shared' } }, allow: { to: { element: { type: 'shared' } } } },
            // Packages (@alpine/ui, @alpine/protocol, react...) are open to every layer.
            { allow: { to: { module: { origin: 'external' } } } },
          ],
        },
      ],
    },
  },

  // Product components use tokens only: Tailwind's default palette is off, and raw values in brackets are refused.
  {
    files: ['apps/desktop/src/**/*.tsx', 'packages/ui/src/**/*.tsx'],
    plugins: { 'better-tailwindcss': betterTailwind },
    settings: { 'better-tailwindcss': { entryPoint: 'apps/desktop/src/app/styles.css' } },
    rules: {
      'better-tailwindcss/no-unknown-classes': 'error',
      'better-tailwindcss/no-conflicting-classes': 'error',
      'better-tailwindcss/no-duplicate-classes': 'error',
      'better-tailwindcss/no-restricted-classes': [
        'error',
        {
          restrict: [
            {
              pattern:
                '^(.*:)?(text|bg|border|outline|ring|fill|stroke|shadow|rounded|font|leading|tracking)-\\[.*\\]$',
              message: 'Use a token from packages/ui/src/tokens.css instead of a raw value.',
            },
          ],
        },
      ],
    },
  },
);
