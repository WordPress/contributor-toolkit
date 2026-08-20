#!/bin/bash -eu

echo "~~~ :apple: Configure macOS code signing"

echo "--- :ruby: Install gems"
install_gems

echo "--- :key: Set up signing"
bundle exec fastlane setup_code_signing

echo "Expose signing config to electron-builder..."
# Export necessary env vars for `electron-builder` to find those for its `notarize` option
# See https://www.electron.build/mac#notarize
MACOS_NOTARIZATION_TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/wordpress-contributor-toolkit-signing.XXXXXX")"
export APPLE_API_KEY="$MACOS_NOTARIZATION_TEMP_DIR/apple_api_key"

cleanup_macos_notarization_key() {
	rm -f "$APPLE_API_KEY"
	rmdir "$MACOS_NOTARIZATION_TEMP_DIR"
}
trap cleanup_macos_notarization_key EXIT

# `printenv` keeps the key itself out of shell traces, while the private temporary directory and
# restrictive file mode keep it unavailable to other users on the build agent.
( umask 077; printenv APP_STORE_CONNECT_API_KEY_KEY >"$APPLE_API_KEY" )
export APPLE_API_KEY_ID="$APP_STORE_CONNECT_API_KEY_KEY_ID"
export APPLE_API_ISSUER="$APP_STORE_CONNECT_API_KEY_ISSUER_ID"
