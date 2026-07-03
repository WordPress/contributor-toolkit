#!/bin/bash -u
# TEMPORARY diagnostics for AINFRA-2597: electron-builder reports the Developer ID
# identity as CSSMERR_TP_NOT_TRUSTED. Dumps keychain + trust-chain state on the CI
# agent so we can see which cert/anchor is missing. Never fails the build.
set +e

IDENTITY_CN='Developer ID Application: Automattic, Inc. (PZYM8XX95Q)'
INTERMEDIATE_CN='Developer ID Certification Authority'
WORKDIR=$(mktemp -d)

echo "--- :apple: OS + security versions"
sw_vers
security help 2>&1 | head -1

echo "--- :key: Keychain search list (user domain)"
security list-keychains -d user
echo "Default keychain:"
security default-keychain

echo "--- :mag: security find-identity -v -p codesigning  (what electron-builder inspects)"
security find-identity -v -p codesigning

echo "--- :mag: security find-identity -v  (all policies)"
security find-identity -v

echo "--- :page_facing_up: Is the '$INTERMEDIATE_CN' intermediate installed anywhere?"
if security find-certificate -a -c "$INTERMEDIATE_CN" -Z 2>/dev/null | grep -q 'SHA-1'; then
  security find-certificate -a -c "$INTERMEDIATE_CN" -Z 2>/dev/null | grep -E 'labl|SHA-1|keychain'
else
  echo ">>> INTERMEDIATE '$INTERMEDIATE_CN' NOT FOUND in any keychain <<<"
fi

echo "--- :page_facing_up: Per-keychain view of Developer ID certificates"
while IFS= read -r kc; do
  kc=$(echo "$kc" | tr -d '"' | xargs)
  [ -z "$kc" ] && continue
  echo "=== $kc ==="
  security find-certificate -a -c 'Developer ID' "$kc" 2>/dev/null | grep -E '"labl"' || echo "  (no Developer ID certs)"
done < <(security list-keychains -d user)

echo "--- :closed_lock_with_key: Export leaf cert and run an explicit trust evaluation"
if security find-certificate -a -p -c "$IDENTITY_CN" > "$WORKDIR/leaf.pem" 2>/dev/null && [ -s "$WORKDIR/leaf.pem" ]; then
  echo "Leaf exported. openssl subject/issuer:"
  openssl x509 -in "$WORKDIR/leaf.pem" -noout -subject -issuer -dates 2>/dev/null

  echo "security verify-cert (codeSign policy):"
  security verify-cert -p codeSign -c "$WORKDIR/leaf.pem" -v 2>&1
else
  echo ">>> Could not export leaf '$IDENTITY_CN' from keychain <<<"
fi

rm -rf "$WORKDIR"
echo "--- :white_check_mark: Diagnostics complete (non-fatal)"
