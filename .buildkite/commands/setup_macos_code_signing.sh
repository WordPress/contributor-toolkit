#!/bin/bash -eu

echo "~~~ :apple: Configure macOS code signing"

echo "--- :ruby: Install gems"
install_gems

echo "--- :key: Set up signing"
bundle exec fastlane setup_code_signing

# For `electron-builder` to find those as `notarize` options
# See https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/macPackager.ts#L599-L602
# See https://www.electron.build/mac#notarize
export APPLE_API_KEY="$APP_STORE_CONNECT_API_KEY_KEY"
export APPLE_API_KEY_ID="$APP_STORE_CONNECT_API_KEY_KEY_ID"
export APPLE_API_ISSUER="$APP_STORE_CONNECT_API_KEY_ISSUER_ID"
