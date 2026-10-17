#!/bin/sh
set -eu
set -f

: "${DATA_S3_BUCKET:?}"
cache=${PROVISION_CACHE_DIR:-/cache}
volumes=${PROVISION_VOLUMES_DIR:-/volumes}
mkdir -p "$cache"

fail() { echo "$*" >&2; exit 1; }
validate_blob() {
    printf '%s\n' "$1" | LC_ALL=C grep -Eq '^[0-9a-f]{64}\.tar\.gz$' || fail "Invalid blob name: $1"
}
fetch() {
    validate_blob "$1"
    name=$1
    if [ -f "$cache/$name" ]; then
        echo "$name: cache hit"
        return
    fi
    set -- s3 cp "s3://$DATA_S3_BUCKET/$name" "$cache/$name.partial" --only-show-errors
    if [ -n "${DATA_S3_ENDPOINT:-}" ]; then
        set -- --endpoint-url "$DATA_S3_ENDPOINT" "$@"
    fi
    aws "$@"
    actual=$(sha256sum "$cache/$name.partial")
    if [ "${actual%% *}" != "${name%.tar.gz}" ]; then
        rm -f "$cache/$name.partial"
        fail "Checksum mismatch: $name"
    fi
    mv "$cache/$name.partial" "$cache/$name"
    echo "$name: downloaded and verified"
}
sync_volume() (
    volume=$1
    blob=$2
    printf '%s\n' "$volume" | LC_ALL=C grep -Eq '^[a-z0-9][a-z0-9_-]*$' || fail "Invalid volume name: $volume"
    target=$volumes/$volume
    [ -d "$target" ] || fail "Target mount does not exist: $target"
    fetch "$blob"
    listing=$(tar -tzf "$cache/$blob")
    if printf '%s\n' "$listing" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
        fail "Unsafe archive paths: $blob"
    fi
    staging=$target/.staging-$$
    trap 'rm -rf "$staging"' 0
    trap 'exit 1' 1 2 15
    mkdir "$staging"
    tar -xzf "$cache/$blob" -C "$staging"
    set +f
    for entry in "$target"/* "$target"/.[!.]* "$target"/..?*; do
        [ -e "$entry" ] || [ -L "$entry" ] || continue
        [ "$entry" = "$staging" ] || rm -rf "$entry"
    done
    for entry in "$staging"/* "$staging"/.[!.]* "$staging"/..?*; do
        [ -e "$entry" ] || [ -L "$entry" ] || continue
        mv "$entry" "$target/"
    done
    rmdir "$staging"
)

for target in ${SYNC_TARGETS:-}; do
    case "$target" in *=*) ;; *) fail "Invalid sync target: $target" ;; esac
    sync_volume "${target%%=*}" "${target#*=}"
done
