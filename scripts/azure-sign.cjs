// electron-builder `win.sign` hook: signs Windows artifacts with Azure Trusted Signing.
//
// electron-builder calls this once per file to sign, after `rcedit` has rewritten the PE
// resource directory, so signatures are not orphaned. Azure Trusted Signing is SHA256-only,
// hence `signingHashAlgorithms: ["sha256"]` in package.json — there is no SHA1 pass.
//
// The Azure env vars are exported by the CI Toolkit's `setup_azure_trusted_signing.ps1`. When
// they are absent (local `dist:win`), signing is skipped so the build still produces an
// (unsigned) artifact instead of failing.

const { spawnSync } = require('node:child_process');

const REQUIRED_ENV_VARS = ['SIGNTOOL_PATH', 'AZURE_CODE_SIGNING_DLIB', 'AZURE_METADATA_JSON'];

function shouldSign(env) {
  return REQUIRED_ENV_VARS.every((name) => {
    const value = env[name];
    return typeof value === 'string' && value.trim() !== '';
  });
}

function buildSigntoolArgs(file, env) {
  const fileDigest = env.AZURE_FILE_DIGEST || 'SHA256';
  const timestampServer = env.AZURE_TIMESTAMP_SERVER || 'http://timestamp.acs.microsoft.com';
  const timestampDigest = env.AZURE_TIMESTAMP_DIGEST || 'SHA256';

  // `/debug` surfaces Azure auth/quota/network diagnostics on failure instead of a generic
  // SignTool error.
  return [
    'sign',
    '/v',
    '/debug',
    '/fd', fileDigest,
    '/tr', timestampServer,
    '/td', timestampDigest,
    '/dlib', env.AZURE_CODE_SIGNING_DLIB,
    '/dmdf', env.AZURE_METADATA_JSON,
    file,
  ];
}

module.exports = async function sign(configuration) {
  const file = configuration.path;
  const env = process.env;

  if (!shouldSign(env)) {
    console.log(
      `[azure-sign] Azure Trusted Signing env vars not set; skipping signing of ${file} (expected for local builds).`,
    );
    return;
  }

  console.log(`[azure-sign] Signing ${file} with Azure Trusted Signing`);
  const result = spawnSync(env.SIGNTOOL_PATH, buildSigntoolArgs(file, env), { stdio: 'inherit' });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`[azure-sign] signtool exited with code ${result.status} signing ${file}`);
  }
};

module.exports.shouldSign = shouldSign;
module.exports.buildSigntoolArgs = buildSigntoolArgs;
