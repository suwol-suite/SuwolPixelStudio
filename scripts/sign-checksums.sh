#!/usr/bin/env bash
set -euo pipefail

directory="${1:-artifacts/release}"
: "${GPG_PRIVATE_KEY_B64:?Missing required checksum secret: GPG_PRIVATE_KEY_B64}"
: "${GPG_PASSPHRASE:?Missing required checksum secret: GPG_PASSPHRASE}"

base="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
export GNUPGHOME
GNUPGHOME="$(mktemp -d "$base/suwol-gpg.XXXXXX")"
chmod 700 "$GNUPGHOME"
cleanup() { rm -rf "$GNUPGHOME"; }
trap cleanup EXIT INT TERM

printf '%s' "$GPG_PRIVATE_KEY_B64" | base64 --decode | gpg --batch --import
fingerprint="$(gpg --batch --with-colons --list-secret-keys | awk -F: '$1 == "fpr" { print $10; exit }')"
test -n "$fingerprint" || { echo "Imported GPG signing key has no fingerprint"; exit 1; }
echo "GPG key fingerprint: $fingerprint"
rm -f "$directory/checksums.txt.asc"
gpg --batch --yes --pinentry-mode loopback --passphrase "$GPG_PASSPHRASE" \
  --armor --detach-sign --output "$directory/checksums.txt.asc" "$directory/checksums.txt"
gpg --verify "$directory/checksums.txt.asc" "$directory/checksums.txt"
