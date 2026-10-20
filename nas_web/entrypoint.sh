#!/bin/sh
set -eu

# HA Supervisor bind-mounts /data at runtime, overriding build-time ownership.
# Touch only NAS Web's private subdirectories, never chown the whole /data mount.
install -d -m 0700 -o nasweb -g nasweb /data/nasweb-thumbs
install -d -m 0700 -o nasweb -g nasweb /data/nasweb-video
install -d -m 0700 -o nasweb -g nasweb /data/nasweb-auth

# Restrict privilege to startup setup; application handles requests as uid 10001.
exec gosu nasweb "$@"
