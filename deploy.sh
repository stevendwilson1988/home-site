#!/usr/bin/env bash
# Deploy the committed site files to the live web root.
#
#   ./deploy.sh        deploy
#   ./deploy.sh -n     dry run: show what would change, touch nothing
#
# Only files that differ from the live copy are replaced. Each replaced live
# file is first backed up next to itself as <name>.bak-YYYYMMDD-HHMMSS.
set -euo pipefail

DEST=/var/www/html
DRY=0
[[ "${1:-}" == "-n" ]] && DRY=1

cd "$(dirname "$0")"

# Repo files that are not part of the site.
EXCLUDE='^(README\.md|deploy\.sh|\.gitignore)$'

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Uncommitted changes. Commit or stash them first so the live site matches a commit:" >&2
  git status --short >&2
  exit 1
fi

stamp=$(date +%Y%m%d-%H%M%S)
changed=0

while IFS= read -r f; do
  [[ "$f" =~ $EXCLUDE ]] && continue
  live="$DEST/$f"
  if [[ -f "$live" ]] && cmp -s "$f" "$live"; then
    continue
  fi
  changed=$((changed + 1))
  if [[ -f "$live" ]]; then
    echo "update  $f  (backup: $(basename "$live").bak-$stamp)"
  else
    echo "add     $f"
  fi
  (( DRY )) && continue
  [[ -f "$live" ]] && sudo cp -p "$live" "$live.bak-$stamp"
  sudo install -D -m 644 -o root -g root "$f" "$live"
done < <(git ls-files)

if (( changed == 0 )); then
  echo "Live site already matches $(git rev-parse --short HEAD). Nothing to deploy."
elif (( DRY )); then
  echo "Dry run: $changed file(s) would be deployed from $(git rev-parse --short HEAD)."
else
  echo "Deployed $changed file(s) from $(git rev-parse --short HEAD) to $DEST."
fi
