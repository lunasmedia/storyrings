#!/usr/bin/env bash
# One-time setup for publishing to Maven Central (see README.md):
#   1. creates the signing key "StoryRings (Lunasmedia)" with a random passphrase,
#   2. stores the key and passphrase in ~/.gradle/gradle.properties (only readable by you),
#   3. publishes its public half to keyserver.ubuntu.com (Maven Central checks signatures there).
# Prints no secrets. Back up ~/.gradle/gradle.properties: the same key should sign every release.
# Safe to run again: it only uploads the public key if the key is already set up.
set -euo pipefail
umask 077
props="$HOME/.gradle/gradle.properties"
name="StoryRings (Lunasmedia)"
command -v gpg >/dev/null || { echo "Install GnuPG first: brew install gnupg" >&2; exit 1; }

fingerprint() { gpg --list-secret-keys --with-colons "$name" 2>/dev/null | awk -F: '/^fpr/ { print $10; exit }'; }

if [ -f "$props" ] && grep -q '^signingInMemoryKey=' "$props"; then
  echo "$props already has the signing key."
else
  # A key from an earlier run that stopped before saving its passphrase can't be used: replace it.
  old="$(fingerprint)"
  if [ -n "$old" ]; then
    echo "Replacing the unusable key $old from an earlier run."
    gpg --batch --yes --delete-secret-and-public-key "$old"
  fi
  pass="$(openssl rand -hex 24)"
  gpg --batch --pinentry-mode loopback --passphrase "$pass" --quick-gen-key "$name" ed25519 sign 5y
  key="$(gpg --batch --pinentry-mode loopback --passphrase "$pass" --armor --export-secret-keys "$(fingerprint)" \
    | awk '{ printf "%s\\n", $0 }')"
  mkdir -p "$HOME/.gradle"
  touch "$props"
  chmod 600 "$props"
  {
    echo
    echo "# StoryRings Maven Central signing key (gpg $(fingerprint))"
    echo "signingInMemoryKey=$key"
    echo "signingInMemoryKeyPassword=$pass"
  } >>"$props"
  echo "Signing key $(fingerprint) saved in $props."
fi

# Over IPv4 with curl: gpg's own keyserver client can fail where IPv6 isn't routed.
fpr="$(fingerprint)"
if curl -4 -fsS -o /dev/null --data-urlencode "keytext=$(gpg --armor --export "$fpr")" \
  https://keyserver.ubuntu.com/pks/add; then
  echo "Public key $fpr published to keyserver.ubuntu.com."
else
  echo "Couldn't reach keyserver.ubuntu.com. Run this script again later to retry the upload." >&2
  exit 1
fi
