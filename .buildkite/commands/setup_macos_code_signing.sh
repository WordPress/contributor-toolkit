#!/bin/bash -eu

echo "~~~ :apple: Configure macOS code signing"

# The Buildkite step sources this script, so the shebang's `-eu` never applies. Validate before
# installing gems, and avoid expanding the private-key value into a command that xtrace would log.
for required_var in \
	WPCT_MACOS_SIGNING_KEY_ID \
	WPCT_MACOS_SIGNING_ISSUER_ID \
	WPCT_MACOS_SIGNING_PRIVATE_KEY; do
	if ! printenv "$required_var" | grep -q .; then
		echo "$required_var is required. Configure the macOS signing credentials in Buildkite." >&2
		return 1
	fi
done

echo "--- :ruby: Install gems"
install_gems

# Materialize the Buildkite credential once, then expose the APPLE_API_* interface used by both consumers:
# Fastlane reads it explicitly in Fastfile, and electron-builder inherits it during the later `npm run dist`.
# APPLE_API_KEY must contain a filepath, not the private-key contents.
# See https://www.electron.build/mac#notarize
MACOS_NOTARIZATION_TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/wordpress-contributor-toolkit-signing.XXXXXX")" || return 1
export APPLE_API_KEY="$MACOS_NOTARIZATION_TEMP_DIR/apple_api_key"
export APPLE_API_KEY_ID="$WPCT_MACOS_SIGNING_KEY_ID"
export APPLE_API_ISSUER="$WPCT_MACOS_SIGNING_ISSUER_ID"

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
bundle exec fastlane setup_code_signing || return $?

echo "Signing config is ready for electron-builder."
