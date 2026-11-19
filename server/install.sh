#!/usr/bin/env bash
# Install or update the Snake leaderboard backend on this server.
#   - app.py                         -> /opt/snake-scores/
#   - snake-scores.service           -> /etc/systemd/system/
#   - nginx-snake-scores.conf        -> /etc/nginx/snippets/snake-scores.conf
#   - nginx-snake-scores-limit.conf  -> /etc/nginx/conf.d/snake-scores-limit.conf
#   - includes the snippet in both server blocks of sites-available/default that serve /var/www/html
# Anything replaced is first copied to <file>.bak-<stamp>. scores.db and secret are never touched.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

APP=/opt/snake-scores
UNIT=/etc/systemd/system/snake-scores.service
SNIPPET=/etc/nginx/snippets/snake-scores.conf
LIMIT=/etc/nginx/conf.d/snake-scores-limit.conf
SITE=/etc/nginx/sites-available/default
INCLUDE='include snippets/snake-scores.conf; # Snake leaderboard, repo home-site/server'
stamp=$(date +%Y%m%d-%H%M%S)

python3 -m unittest -q test_app

put() {  # put <src> <dest> <owner> <mode>: install only if different, backing up the old copy
  local src=$1 dest=$2 owner=$3 mode=$4
  if sudo test -f "$dest"; then
    sudo cmp -s "$src" "$dest" && { echo "unchanged $dest"; return 0; }
    sudo cp -p "$dest" "$dest.bak-$stamp"
  fi
  sudo install -o "$owner" -g "$owner" -m "$mode" "$src" "$dest"
  echo "installed $dest"
  changed=1
}

sudo install -d -o ubuntu -g ubuntu -m 755 "$APP"
changed=0; put app.py "$APP/app.py" ubuntu 644; app_changed=$changed
changed=0; put snake-scores.service "$UNIT" root 644; unit_changed=$changed
changed=0
put nginx-snake-scores.conf "$SNIPPET" root 644
put nginx-snake-scores-limit.conf "$LIMIT" root 644

# Add the include after "server_name _;" (port 80 default server) and after the
# scratchbuild resume include (the 443 server), once each.
if ! sudo grep -qF 'snippets/snake-scores.conf' "$SITE"; then
  sudo cp -p "$SITE" "$SITE.bak-$stamp"
  sudo sed -i \
    -e "/^\s*server_name _;/a\\	$INCLUDE" \
    -e "/^\s*include snippets\/scratchbuild-resume.conf;/a\\	$INCLUDE" \
    "$SITE"
  n=$(sudo grep -cF 'snippets/snake-scores.conf' "$SITE")
  if [[ "$n" != 2 ]]; then
    echo "Expected 2 includes in $SITE, found $n; restoring it." >&2
    sudo cp -p "$SITE.bak-$stamp" "$SITE"
    exit 1
  fi
  echo "added the include to both server blocks in $SITE"
  changed=1
fi
nginx_changed=$changed

(( unit_changed )) && sudo systemctl daemon-reload
sudo systemctl enable --quiet snake-scores
if (( app_changed || unit_changed )) || ! systemctl is-active --quiet snake-scores; then
  sudo systemctl restart snake-scores
  echo "restarted snake-scores"
fi

if (( nginx_changed )); then
  if ! sudo nginx -t; then
    echo "nginx -t failed. Backups are at *.bak-$stamp; nginx was not reloaded." >&2
    exit 1
  fi
  sudo systemctl reload nginx
  echo "reloaded nginx"
fi

for i in 1 2 3 4 5; do
  curl -fs http://127.0.0.1:5003/snake/api/scores && { echo; exit 0; }
  sleep 1
done
echo "snake-scores did not answer; see: journalctl -u snake-scores" >&2
exit 1
