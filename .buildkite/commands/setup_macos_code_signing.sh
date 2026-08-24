#!/bin/bash -eu

echo "~~~ :apple: Configure macOS code signing"

# The Buildkite command enables `set -eu` before sourcing this script. Validate the non-secret values
# while exporting them, but keep the private key out of commands that xtrace would log.
export APPLE_API_KEY_ID="${WPCT_MACOS_SIGNING_KEY_ID:?is required. Configure the macOS signing credentials in Buildkite.}"
export APPLE_API_ISSUER="${WPCT_MACOS_SIGNING_ISSUER_ID:?is required. Configure the macOS signing credentials in Buildkite.}"
if ! printenv WPCT_MACOS_SIGNING_PRIVATE_KEY | grep -q .; then
	echo "WPCT_MACOS_SIGNING_PRIVATE_KEY is required. Configure the macOS signing credentials in Buildkite." >&2
	return 1
fi

echo "--- :ruby: Install gems"
install_gems

# Materialize the Buildkite credential once, then expose the APPLE_API_* interface used by both consumers:
# Fastlane reads it explicitly in Fastfile, and electron-builder inherits it during the later `npm run dist`.
# APPLE_API_KEY must contain a filepath, not the private-key contents.
# See https://www.electron.build/mac#notarize
MACOS_NOTARIZATION_TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/wordpress-contributor-toolkit-signing.XXXXXX")"
export APPLE_API_KEY="$MACOS_NOTARIZATION_TEMP_DIR/apple_api_key"

cleanup_macos_notarization_key() {
	rm -rf "$MACOS_NOTARIZATION_TEMP_DIR"
}
trap cleanup_macos_notarization_key EXIT

# `printenv` keeps the key itself out of shell traces, while the private temporary directory and
# restrictive file mode keep it unavailable to other users on the build agent.
( umask 077; printenv WPCT_MACOS_SIGNING_PRIVATE_KEY >"$APPLE_API_KEY" ) || {
	echo "WPCT_MACOS_SIGNING_PRIVATE_KEY could not be written to $APPLE_API_KEY" >&2
	return 1
}

echo "--- :key: Set up signing"
bundle exec fastlane setup_code_signing

echo "Signing config is ready for electron-builder."
