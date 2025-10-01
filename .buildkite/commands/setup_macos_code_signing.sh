#!/bin/bash -eu

echo "~~~ :apple: Configure macOS code signing"

echo "--- :ruby: Install gems"
install_gems

echo "--- :key: Set up signing"
bundle exec fastlane setup_code_signing

# For `electron-builder` to find those as `notarize` options
export APPLE_API_KEY="$APP_STORE_CONNECT_API_KEY_KEY"
export APPLE_API_KEY_ID="$APP_STORE_CONNECT_API_KEY_KEY_ID"
export APPLE_API_KEY_ISSUER="$APP_STORE_CONNECT_API_KEY_ISSUER_ID"
