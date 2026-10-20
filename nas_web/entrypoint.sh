#!/bin/sh
set -eu

# Supervisor mounts /data. Prepare only NAS Web private directories.
install -d -m 0700 -o nasweb -g nasweb /data/nasweb-thumbs
install -d -m 0700 -o nasweb -g nasweb /data/nasweb-video
install -d -m 0700 -o nasweb -g nasweb /data/nasweb-auth

# Supervisor options may be root-readable only. Keep the original unchanged.
# The copy is private to the unprivileged NAS Web process.
if [ -f /data/options.json ]; then
    install -m 0600 -o nasweb -g nasweb /data/options.json /data/nasweb-auth/options.json
else
    rm -f /data/nasweb-auth/options.json
fi

exec gosu nasweb "$@"
