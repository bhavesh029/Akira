#!/usr/bin/env bash
# PreToolUse hook for the Bash tool: blocks unscoped lint/format invocations.
#
# This repo's `npm run lint` script runs `eslint --fix` across the entire
# `src/` tree. The codebase does not currently conform to its own prettier
# config, so an unscoped `--fix` run silently reformats dozens of unrelated
# files into a huge, unreviewable diff — this already happened once mid-build
# and had to be manually untangled file by file. This hook blocks that class
# of command; scoped invocations naming specific files are always allowed.
set -euo pipefail

input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty')"

[ -z "$cmd" ] && exit 0

deny() {
  local reason="$1"
  jq -n --arg reason "$reason" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

# Block the `npm run lint` script itself (bakes in unscoped `eslint --fix`).
if printf '%s' "$cmd" | grep -Eq '\bnpm\b[^;&|]*\brun[[:space:]]+lint\b'; then
  deny "npm run lint runs eslint --fix across the entire src/ tree (unscoped). This repo's code doesn't conform to its own prettier config, so this reformats dozens of unrelated files into a huge diff — it already happened once and had to be manually untangled. Instead: run 'npx eslint <the exact files you touched>' without --fix to check, or --fix scoped to those exact files only."
fi

# Block a bare/glob `eslint --fix` invocation with no specific file path named.
if printf '%s' "$cmd" | grep -Eq '\beslint\b' && printf '%s' "$cmd" | grep -Eq -- '--fix\b'; then
  if printf '%s' "$cmd" | grep -Eq -- '\*\*' \
     || printf '%s' "$cmd" | grep -Eq -- '\beslint[[:space:]]+\.([[:space:]]|$)' \
     || ! printf '%s' "$cmd" | grep -Eiq '\.(ts|tsx|js|jsx)\b'; then
    deny "This eslint --fix invocation looks unscoped (a glob or whole-tree target, no specific file path named). Unscoped --fix can reformat unrelated files into a huge diff. Instead: run 'npx eslint <specific files>' without --fix to check, or --fix scoped to the exact file(s) you're editing."
  fi
fi

exit 0
