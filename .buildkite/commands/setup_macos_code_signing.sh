#!/bin/bash -eu

echo "~~~ :apple: Configure macOS code signing"

echo "--- :ruby: Install gems"
install_gems

echo "--- :key: Set up signing"
bundle exec fastlane setup_code_signing
