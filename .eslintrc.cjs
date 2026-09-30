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
    // WARN, not error, on purpose: this lands across six agents' in-flight work
    // and most hits are judgement calls. It flags a read whose `error` nobody
    // looked at being coalesced into an empty value — the shape behind six
    // "the UI accused a merchant of something the read never proved" incidents.
    // Promote the critical surfaces to 'error' once they're converted.
    'no-absence-from-failed-read': 'warn',
    // ERROR, not warn — and it can afford to be, because it only fires in files
    // that already import src/lib/maskedDeal.ts. Migrating a file opts it in, so
    // there is no day-one flood to downgrade away, and the protected set grows
    // one file at a time. A withheld money column read bare is a wrong NUMBER
    // shown to a human, not a missing one, so where it does fire it is not a
    // judgement call.
    'no-bare-masked-deal-field': 'error',
  },
}
