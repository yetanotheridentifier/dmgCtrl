#!/usr/bin/env bash
# Writes the preview comment on a pull request: one comment per pull request, found by a marker on
# its first line and edited in place, so each push or the close replaces it rather than adding
# another. Used by the preview job in deploy.yml and by preview-teardown.yml.
#
#   REPO=owner/name PR_NUMBER=841 GH_TOKEN=... scripts/pr-preview-comment.sh "<body>"
#
# With EDIT_ONLY=1 it edits an existing comment and adds none, so a pull request that never had a
# preview gets no comment about one closing.
set -euo pipefail

marker='<!-- pr-preview -->'
body="$marker
$1"

id=$(gh api "repos/$REPO/issues/$PR_NUMBER/comments" --paginate \
  --jq ".[] | select(.body | startswith(\"$marker\")) | .id" | head -n 1)
if [ -n "$id" ]; then
  gh api --method PATCH "repos/$REPO/issues/comments/$id" -f body="$body" > /dev/null
elif [ "${EDIT_ONLY:-}" != 1 ]; then
  gh api --method POST "repos/$REPO/issues/$PR_NUMBER/comments" -f body="$body" > /dev/null
fi
