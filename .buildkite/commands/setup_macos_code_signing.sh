#!/bin/bash -eu

echo "~~~ :apple: Configure macOS code signing"

echo "--- :ruby: Install gems"
install_gems

# The Buildkite step sources this script, so the shebang's `-eu` never applies. Return explicitly
# so callers without `errexit` still receive materialization failures instead of continuing.
for required_var in \
	WPCT_MACOS_SIGNING_KEY_ID_V2 \
	WPCT_MACOS_SIGNING_ISSUER_ID_V2 \
	WPCT_MACOS_SIGNING_PRIVATE_KEY_V2; do
	if [ -z "${!required_var:-}" ]; then
		echo "$required_var is required. This branch predates the secure macOS signing credentials; merge the latest trunk." >&2
		return 1
	fi
done

MACOS_NOTARIZATION_TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/wordpress-contributor-toolkit-signing.XXXXXX")" || return 1
export APPLE_API_KEY="$MACOS_NOTARIZATION_TEMP_DIR/apple_api_key"
export APPLE_API_KEY_ID="$WPCT_MACOS_SIGNING_KEY_ID_V2"
export APPLE_API_ISSUER="$WPCT_MACOS_SIGNING_ISSUER_ID_V2"

cleanup_macos_notarization_key() {
	rm -rf "$MACOS_NOTARIZATION_TEMP_DIR"
}
trap cleanup_macos_notarization_key EXIT

# `printenv` keeps the key itself out of shell traces, while the private temporary directory and
# restrictive file mode keep it unavailable to other users on the build agent. Unlike `echo` under
# `set -u`, `printenv` exits quietly when the variable is missing — hence the explicit guard.
( umask 077; printenv WPCT_MACOS_SIGNING_PRIVATE_KEY_V2 >"$APPLE_API_KEY" ) || {
	echo "WPCT_MACOS_SIGNING_PRIVATE_KEY_V2 could not be written to $APPLE_API_KEY" >&2
	return 1
}

echo "--- :key: Set up signing"
bundle exec fastlane setup_code_signing

echo "Signing config is ready for electron-builder."
