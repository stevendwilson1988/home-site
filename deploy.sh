#!/usr/bin/env bash
# Deploy the committed site/ folder to the live web root.
# Run ./deploy.sh --help for usage.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./deploy.sh [-n|--dry-run] [-h|--help]

Deploys site/ as committed in HEAD (on branch main) to /var/www/html.

  -n, --dry-run   show what would change; touch nothing, no sudo needed
  -h, --help      show this help

Only files that differ from the live copy are replaced. Files deployed before
but no longer in site/ are removed. Every replaced or removed live file is
backed up to /var/backups/home-site/<stamp>/ first, and if anything fails
partway, the files already changed are restored from that backup.
EOF
}

DRY=0
for arg in "$@"; do
  case "$arg" in
    -n|--dry-run) DRY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "deploy.sh: unknown option: $arg" >&2; echo >&2; usage >&2; exit 2 ;;
  esac
done

# DEST and BACKUP_ROOT can be overridden from the environment for testing.
DEST=${DEST:-/var/www/html}
BACKUP_ROOT=${BACKUP_ROOT:-/var/backups/home-site}
MANIFEST=$BACKUP_ROOT/manifest   # NUL-separated list of paths this repo deployed last time
BRANCH=main

# Work from the repo, even when run through a symlink or from another folder.
cd "$(dirname "$(readlink -f "$0")")"
cd "$(git rev-parse --show-toplevel)"

commit=$(git rev-parse --short HEAD)
branch=$(git symbolic-ref --quiet --short HEAD || echo "detached HEAD")
dirty=$(git status --porcelain --untracked-files=no)

problems=()
[[ "$branch" == "$BRANCH" ]] || problems+=("$branch is checked out, not $BRANCH")
[[ -z "$dirty" ]] || problems+=("uncommitted changes, which are not included:"$'\n'"$dirty")
if (( ${#problems[@]} )); then
  if (( DRY )); then
    for p in "${problems[@]}"; do echo "note: $p"; done
    echo "note: previewing what commit $commit would deploy"
    echo
  else
    echo "Refusing to deploy:" >&2
    for p in "${problems[@]}"; do echo "  - $p" >&2; done
    exit 1
  fi
fi

# ---------------------------------------------------------------- stage HEAD
stage=$(mktemp -d)
applying=0
bdir=
tmp=
done_files=()   # live paths already replaced, added or removed, in order, as "op<TAB>path"

rollback() {
  set +e
  echo >&2
  echo "Deploy failed. Rolling back ${#done_files[@]} change(s)..." >&2
  [[ -n "$tmp" ]] && sudo rm -f "$tmp"
  local i op f
  for (( i = ${#done_files[@]} - 1; i >= 0; i-- )); do
    op=${done_files[i]%%$'\t'*}
    f=${done_files[i]#*$'\t'}
    case "$op" in
      add) sudo rm -f "$DEST/$f" && echo "  removed  $f" >&2 ;;
      update|remove)
        sudo mkdir -p "$(dirname "$DEST/$f")"
        sudo cp -p "$bdir/$f" "$DEST/$f" && echo "  restored $f" >&2 ;;
    esac
  done
  echo "Rollback finished. The live site is as it was before this deploy." >&2
  echo "Backups of the original files are in $bdir" >&2
}

on_exit() {
  local rc=$?
  (( applying && rc != 0 )) && rollback
  rm -rf "$stage"
}
trap on_exit EXIT
trap 'exit 130' INT TERM

# Export exactly what HEAD contains (not the working tree).
mkdir "$stage/files"
git archive --format=tar "HEAD:site" | tar -x -C "$stage/files"
(cd "$stage/files" && find . -type f -printf '%P\0' | sort -z) > "$stage/new.list"
[[ -s "$stage/new.list" ]] || { echo "site/ is empty in $commit; nothing to deploy." >&2; exit 1; }

# ------------------------------------------------------------ work out changes
declare -A in_new=()
changes=()   # "op<TAB>path"
while IFS= read -r -d '' f; do
  in_new[$f]=1
  live=$DEST/$f
  if [[ -f "$live" ]]; then
    cmp -s "$stage/files/$f" "$live" && continue
    changes+=("update"$'\t'"$f")
  else
    changes+=("add"$'\t'"$f")
  fi
done < "$stage/new.list"

if [[ -f "$MANIFEST" ]]; then
  while IFS= read -r -d '' f; do
    [[ -n "${in_new[$f]:-}" ]] && continue
    [[ -e "$DEST/$f" || -L "$DEST/$f" ]] && changes+=("remove"$'\t'"$f")
  done < "$MANIFEST"
fi

manifest_current=0
[[ -f "$MANIFEST" ]] && cmp -s "$stage/new.list" "$MANIFEST" && manifest_current=1

if (( ${#changes[@]} == 0 )); then
  if (( DRY == 0 && manifest_current == 0 )); then
    sudo install -d -m 755 -o root -g root "$BACKUP_ROOT"
    sudo install -m 644 -o root -g root "$stage/new.list" "$MANIFEST.tmp"
    sudo mv -f "$MANIFEST.tmp" "$MANIFEST"
  fi
  echo "Live site already matches $commit. Nothing to deploy."
  exit 0
fi

for c in "${changes[@]}"; do
  printf '%-7s %s\n' "${c%%$'\t'*}" "${c#*$'\t'}"
done

if (( DRY )); then
  echo
  echo "Dry run: ${#changes[@]} change(s) would be deployed from $commit."
  exit 0
fi

# ---------------------------------------------------------------- apply
sudo true   # ask for a password (if sudo needs one) before anything changes

stamp=$(date +%Y%m%d-%H%M%S)
bdir=$BACKUP_ROOT/$stamp
sudo install -d -m 755 -o root -g root "$BACKUP_ROOT"
sudo install -d -m 700 -o root -g root "$bdir"

# Back up everything that will be replaced or removed before touching the site.
for c in "${changes[@]}"; do
  op=${c%%$'\t'*}; f=${c#*$'\t'}
  [[ "$op" == add ]] && continue
  sudo mkdir -p "$(dirname "$bdir/$f")"
  sudo cp -p "$DEST/$f" "$bdir/$f"
done

applying=1
for c in "${changes[@]}"; do
  op=${c%%$'\t'*}; f=${c#*$'\t'}
  live=$DEST/$f
  if [[ "$op" == remove ]]; then
    sudo rm -f "$live"
  else
    dir=$(dirname "$live")
    [[ -d "$dir" ]] || sudo install -d -m 755 -o root -g root "$dir"
    # Write next to the target, then rename over it, so the file is never half-written.
    tmp="$dir/.deploy-tmp.$$.$(basename "$live")"
    sudo install -m 644 -o root -g root "$stage/files/$f" "$tmp"
    sudo mv -f "$tmp" "$live"
    tmp=
  fi
  done_files+=("$c")
done

sudo install -m 644 -o root -g root "$stage/new.list" "$MANIFEST.tmp"
sudo mv -f "$MANIFEST.tmp" "$MANIFEST"
applying=0

echo
echo "Deployed ${#changes[@]} change(s) from $commit to $DEST."
echo "Backups: $bdir"
