module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs', 'eslint-rules', 'supabase/functions'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    // Loud-by-default: every supabase table write must go through
    // mustWrite()/tryWrite() (src/supabase/writes.ts). See eslint-rules/.
    'require-supabase-write-wrapper': 'error',
  },
}
