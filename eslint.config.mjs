// Lint configuration for all workspaces. Run: npm run lint
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'tools/**', 'backups/**', '.data/**', 'server/.test-storage/**', 'server/storage/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['shared/src/**/*.ts', 'server/src/**/*.ts', 'server/tests/**/*.ts', 'server/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['client/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    // Test fixtures read loosely typed API JSON; `any` is accepted there.
    files: ['server/tests/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    // Remaining `any` in app code (mostly Mongoose query typing) is tracked debt: reported, not hidden.
    files: ['shared/src/**/*.ts', 'server/src/**/*.ts', 'client/src/**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/no-explicit-any': 'warn' },
  },
  {
    rules: {
      // `_`-prefixed names are intentionally unused (Express signatures, destructuring).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
);
