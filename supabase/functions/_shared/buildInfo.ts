// ─────────────── buildInfo: which commit produced the running bundle ───────────
//
// GENERATED AT DEPLOY TIME by scripts/deploy-edge-function.sh. Do not edit by hand.
//
// WHY THIS FILE EXISTS. `supabase functions deploy` bundles from the FILESYSTEM, so
// a function's registry metadata cannot tell you what went into it. `updated_at`
// says when someone deployed; `entrypoint_path` says which directory they were in,
// which for a correctly-pinned worktree is a temporary path that no longer exists
// by the time you look. On 2026-10-01 `underwrite-deal` v98 was found to have been
// bundled from `scratchpad/wt5/...` — a checkout nobody could inspect — so every
// "deployed after commit X, therefore current" comparison had been made against
// the wrong tree. Neither field can establish the invariant that matters:
//
//     THE DEPLOYED BUNDLE EQUALS A COMMIT THAT IS AN ANCESTOR OF origin/main.
//
// ⚠ WHAT THIS PROVES, AND WHAT IT DOES NOT. It records what the deploy script
// BELIEVED about its own tree at bundle time. It does not prove the bytes in the
// bundle match that commit — nothing short of rebuilding and comparing could. Its
// value comes entirely from the script REFUSING to deploy when the claim would be
// false: a dirty tree, or a HEAD that is not an ancestor of origin/main. Content
// verification by grep remains the stronger check; this tells you WHICH content to
// expect.
//
// The sentinel below is deliberately not a valid sha and never will be. If you see
// it in a deployed bundle, the generator did not run and the deploy gate was
// bypassed — treat the bundle's provenance as unknown, not as "probably fine".
export const BUILD_COMMIT = "UNGENERATED-SENTINEL-NOT-A-COMMIT";
export const BUILD_AT = "UNGENERATED-SENTINEL-NOT-A-TIMESTAMP";
