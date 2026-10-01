#!/usr/bin/env bash
# ── Deploy a Supabase edge function, or REFUSE and explain why ────────────────
#
# `supabase functions deploy` bundles from the FILESYSTEM and does NOT typecheck.
# Nothing in the function registry can tell you what went into a bundle:
# `updated_at` says when someone deployed, `entrypoint_path` says which directory
# they stood in — and for a correctly-pinned worktree that is a temporary path
# which no longer exists by the time anyone looks. On 2026-10-01 `underwrite-deal`
# v98 was found bundled from `scratchpad/wt5/...`, so every "deployed after commit
# X, therefore current" comparison had been made against the wrong tree.
#
# The invariant this script exists to enforce:
#
#     THE DEPLOYED BUNDLE EQUALS A COMMIT THAT IS AN ANCESTOR OF origin/main.
#
# The marker in _shared/buildInfo.ts records the claim. THE REFUSALS BELOW ARE
# WHAT MAKE IT WORTH ANYTHING: a marker you can write while the tree is dirty is
# a decoration. So every gate here exits non-zero. None of them warn. A warning
# can be scrolled past, and then the marker asserts something false with total
# confidence — which is the exact failure shape this codebase keeps paying for.
#
# Usage:  scripts/deploy-edge-function.sh <function-slug> [more-slugs...]
#         SKIP_DENO_CHECK=1  only if deno is genuinely unavailable (it is noisy)
set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-ehibjeonqpqskhcvizow}"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
GEN="supabase/functions/_shared/buildInfo.ts"

die() { printf '\n\033[31mREFUSING TO DEPLOY\033[0m — %s\n\n' "$1" >&2; exit 1; }

[ "$#" -ge 1 ] || die "no function slug given. Usage: $0 <slug> [slug...]"

# ── GATE 1: every named function must exist ───────────────────────────────────
for slug in "$@"; do
  [ -f "supabase/functions/$slug/index.ts" ] \
    || die "supabase/functions/$slug/index.ts does not exist. Nothing was deployed."
done

# ── GATE 2: the bundling tree must be clean ───────────────────────────────────
# Deploy reads the filesystem, so an uncommitted edit ships silently and the
# marker would name a commit that does not contain it. The generated marker file
# is excluded because this script rewrites it moments from now; nothing else is.
DIRTY="$(git status --porcelain -- supabase/functions/ | grep -v " $GEN\$" || true)"
if [ -n "$DIRTY" ]; then
  printf 'Uncommitted under supabase/functions/:\n%s\n' "$DIRTY" >&2
  die "the bundling tree is dirty. Commit first — deploy bundles from disk, not from git, so these edits would ship while the marker named a commit without them."
fi

# ── GATE 3: HEAD must be an ancestor of origin/main ────────────────────────────
# A local-only commit can be deployed and then lost to a reset, leaving
# production running code that exists on no branch. Refuse rather than record a
# provenance nobody can look up.
git fetch -q origin main || die "could not fetch origin/main, so HEAD's ancestry cannot be established."
HEAD_SHA="$(git rev-parse HEAD)"
git merge-base --is-ancestor "$HEAD_SHA" origin/main \
  || die "HEAD ($(git rev-parse --short HEAD)) is NOT an ancestor of origin/main. Push it first — otherwise the marker would point at a commit that exists only on this machine."

# ── Generate the marker. Never hand-written; always from the tree being bundled ──
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
python3 - "$GEN" "$HEAD_SHA" "$NOW" <<'PYGEN'
import sys, re
path, sha, now = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(path).read()
src = re.sub(r'export const BUILD_COMMIT = "[^"]*";', f'export const BUILD_COMMIT = "{sha}";', src, count=1)
src = re.sub(r'export const BUILD_AT = "[^"]*";', f'export const BUILD_AT = "{now}";', src, count=1)
open(path, "w").write(src)
PYGEN
grep -q "BUILD_COMMIT = \"$HEAD_SHA\"" "$GEN" \
  || die "the marker generator did not write $HEAD_SHA into $GEN. Refusing rather than deploying an unmarked bundle."
printf 'marker: %s @ %s\n' "${HEAD_SHA:0:12}" "$NOW"

restore_marker() { git checkout -- "$GEN" 2>/dev/null || true; }
trap restore_marker EXIT

for slug in "$@"; do
  printf '\n── %s ──\n' "$slug"

  # ── GATE 4: it must typecheck. `supabase functions deploy` will not do this. ──
  if [ -z "${SKIP_DENO_CHECK:-}" ]; then
    NO_COLOR=1 deno check --node-modules-dir=auto "supabase/functions/$slug/index.ts" >/tmp/dc_"$slug".log 2>&1 \
      || { sed -n '1,25p' /tmp/dc_"$slug".log >&2; die "$slug does not typecheck. Nothing was deployed."; }
    echo "typecheck: ok"
  fi

  supabase functions deploy "$slug" --project-ref "$PROJECT_REF" >/tmp/dep_"$slug".log 2>&1 \
    || { tail -15 /tmp/dep_"$slug".log >&2; die "$slug failed to deploy."; }
  echo "deployed"

  # ── GATE 5: the RUNNING bundle must carry this exact sha ───────────────────
  # "Deployed Functions." only means the upload returned. The sentinel in
  # buildInfo.ts is deliberately not a valid sha, so if the generator had been
  # skipped this would catch it instead of passing on a plausible-looking value.
  if [ -n "${SUPABASE_ACCESS_TOKEN:-}" ]; then
    BODY="$(mktemp)"
    curl -fsS -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -A "curl/8" \
      "https://api.supabase.com/v1/projects/$PROJECT_REF/functions/$slug/body" -o "$BODY" \
      || die "$slug deployed, but its body could not be fetched to verify. Treat its provenance as unverified."
    if grep -aq "UNGENERATED-SENTINEL-NOT-A-COMMIT" "$BODY"; then
      rm -f "$BODY"; die "$slug's running bundle contains the UNGENERATED SENTINEL. The marker did not reach it."
    fi
    grep -aq "$HEAD_SHA" "$BODY" \
      || { rm -f "$BODY"; die "$slug's running bundle does NOT contain $HEAD_SHA. It may not import _shared/ghl.ts (4 of 100 do not) — verify that function by content instead."; }
    rm -f "$BODY"
    echo "verified: running bundle carries ${HEAD_SHA:0:12}"
  else
    echo "WARNING: SUPABASE_ACCESS_TOKEN unset — deployed but NOT content-verified." >&2
  fi
done

printf '\nAll requested functions deployed from %s\n' "${HEAD_SHA:0:12}"
