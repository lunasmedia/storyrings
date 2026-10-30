#!/usr/bin/env bash
# One-time setup for publishing to Maven Central (see README.md):
#   1. creates the signing key "StoryRings (Lunasmedia)" with a random passphrase,
#   2. publishes its public half to keyserver.ubuntu.com (Maven Central checks signatures there),
#   3. stores the key and passphrase in ~/.gradle/gradle.properties (only readable by you).
# Prints no secrets. Back up ~/.gradle/gradle.properties: the same key should sign every release.
set -euo pipefail
umask 077
props="$HOME/.gradle/gradle.properties"
if [ -f "$props" ] && grep -q '^signingInMemoryKey=' "$props"; then
  echo "$props already has a signing key; nothing to do."
  exit 0
fi
command -v gpg >/dev/null || { echo "Install GnuPG first: brew install gnupg" >&2; exit 1; }

name="StoryRings (Lunasmedia)"
pass="$(openssl rand -hex 24)"
gpg --batch --pinentry-mode loopback --passphrase "$pass" --quick-gen-key "$name" ed25519 sign 5y
fpr="$(gpg --list-secret-keys --with-colons "$name" | awk -F: '/^fpr/ { print $10; exit }')"
key="$(gpg --batch --pinentry-mode loopback --passphrase "$pass" --armor --export-secret-keys "$fpr" \
  | awk '{ printf "%s\\n", $0 }')"

gpg --keyserver hkps://keyserver.ubuntu.com --send-keys "$fpr"

mkdir -p "$HOME/.gradle"
touch "$props"
chmod 600 "$props"
{
  echo
  echo "# StoryRings Maven Central signing key (gpg $fpr)"
  echo "signingInMemoryKey=$key"
  echo "signingInMemoryKeyPassword=$pass"
} >>"$props"
echo "Signing key $fpr created, published to keyserver.ubuntu.com and saved in $props."
