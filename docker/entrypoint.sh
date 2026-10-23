#!/bin/sh
# Starts as root only to give the app user its mounted data folders (on Linux hosts Docker
# creates missing bind-mount folders as root), then runs the command as the unprivileged `node` user.
set -e
if [ "$(id -u)" = "0" ]; then
  for d in storage auditions backups secrets secrets/public content; do
    if [ -d "/app/$d" ]; then chown node:node "/app/$d" 2>/dev/null || true; fi
  done
  export HOME=/home/node USER=node
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
