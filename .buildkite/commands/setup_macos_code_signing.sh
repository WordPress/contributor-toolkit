#!/bin/bash -eu

echo "~~~ :apple: Configure macOS code signing"

echo "--- :ruby: Install gems"
install_gems

echo "--- :key: Set up signing"
bundle exec fastlane setup_code_signing

echo "Expose signing config to electron-builder..."
# Export necessary env vars for `electron-builder` to find those for its `notarize` option
# See https://www.electron.build/mac#notarize
#
# The Buildkite step sources this script, so the shebang's `-eu` never applies. Return explicitly
# so callers without `errexit` still receive materialization failures instead of continuing.
MACOS_NOTARIZATION_TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/wordpress-contributor-toolkit-signing.XXXXXX")" || return 1
export APPLE_API_KEY="$MACOS_NOTARIZATION_TEMP_DIR/apple_api_key"

cleanup_macos_notarization_key() {
	rm -rf "$MACOS_NOTARIZATION_TEMP_DIR"
}
trap cleanup_macos_notarization_key EXIT

# `printenv` keeps the key itself out of shell traces, while the private temporary directory and
# restrictive file mode keep it unavailable to other users on the build agent. Unlike `echo` under
# `set -u`, `printenv` exits quietly when the variable is missing — hence the explicit guard.
( umask 077; printenv APP_STORE_CONNECT_API_KEY_KEY >"$APPLE_API_KEY" ) || {
	echo "APP_STORE_CONNECT_API_KEY_KEY is unset or could not be written to $APPLE_API_KEY" >&2
	return 1
}
export APPLE_API_KEY_ID="$APP_STORE_CONNECT_API_KEY_KEY_ID"
export APPLE_API_ISSUER="$APP_STORE_CONNECT_API_KEY_ISSUER_ID"
