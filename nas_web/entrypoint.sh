#!/bin/sh
set -eu

# HA Supervisor bind-mounts /data at runtime, overriding build-time ownership.
# Touch only NAS Web's private subdirectories, never chown the whole /data mount.
install -d -m 0700 -o nasweb -g nasweb /data/nasweb-thumbs
install -d -m 0700 -o nasweb -g nasweb /data/nasweb-video
install -d -m 0700 -o nasweb -g nasweb /data/nasweb-auth

# Supervisor options.json can be root-only. Copy just this configuration to a\n# private app-owned file; do not change the permissions of Supervisor files.\n# Refresh the copy on each add-on start, before dropping root privileges.\nif [ -f /data/options.json ]; then\n    install -m 0600 -o nasweb -g nasweb /data/options.json /data/nasweb-auth/options.json\nelse\n    rm -f /data/nasweb-auth/options.json\nfi\n\n# Restrict privilege to startup setup; application handles requests as uid 10001.
exec gosu nasweb "$@"
