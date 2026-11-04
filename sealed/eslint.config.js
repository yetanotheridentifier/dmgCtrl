import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  {
    // Only the UI may use the PWA's shared UI. The engine, AI and bench run under Node in the
    // bench and are to run in a Web Worker, so they import nothing from the PWA.
    files: ['src/engine/**', 'src/ai/**', 'src/bench/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{ group: ['@pwa-shared', '@pwa-shared/*'], message: 'The engine, AI and bench import nothing from the PWA.' }],
      }],
    },
  },
)
