const test = require('node:test');
const assert = require('node:assert/strict');

const { shouldSign, buildSigntoolArgs } = require('../scripts/azure-sign.cjs');

const FULL_ENV = {
  SIGNTOOL_PATH: 'C:/sdk/x64/signtool.exe',
  AZURE_CODE_SIGNING_DLIB: 'C:/pkg/Azure.CodeSigning.Dlib.dll',
  AZURE_METADATA_JSON: 'C:/tmp/metadata.json',
};

function valueAfter(args, flag) {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

test('shouldSign is false when no Azure env vars are set', () => {
  assert.equal(shouldSign({}), false);
});

test('shouldSign is false when only some Azure env vars are set', () => {
  assert.equal(shouldSign({ SIGNTOOL_PATH: 'x', AZURE_CODE_SIGNING_DLIB: 'y' }), false);
});

test('shouldSign is false when a required var is blank', () => {
  assert.equal(shouldSign({ ...FULL_ENV, AZURE_METADATA_JSON: '   ' }), false);
});

test('shouldSign is true when all Azure env vars are set', () => {
  assert.equal(shouldSign(FULL_ENV), true);
});

test('buildSigntoolArgs signs SHA256-only with dlib, metadata, timestamp, and target', () => {
  const args = buildSigntoolArgs('app.exe', FULL_ENV);

  assert.equal(args[0], 'sign');
  assert.equal(valueAfter(args, '/fd'), 'SHA256');
  assert.equal(valueAfter(args, '/td'), 'SHA256');
  assert.equal(valueAfter(args, '/tr'), 'http://timestamp.acs.microsoft.com');
  assert.equal(valueAfter(args, '/dlib'), FULL_ENV.AZURE_CODE_SIGNING_DLIB);
  assert.equal(valueAfter(args, '/dmdf'), FULL_ENV.AZURE_METADATA_JSON);
  assert.equal(args.at(-1), 'app.exe');
  assert.ok(!args.includes('SHA1'));
});

test('buildSigntoolArgs trims surrounding whitespace from dlib and metadata paths', () => {
  const args = buildSigntoolArgs('app.exe', {
    ...FULL_ENV,
    AZURE_CODE_SIGNING_DLIB: '  C:/pkg/Azure.CodeSigning.Dlib.dll  ',
    AZURE_METADATA_JSON: '\tC:/tmp/metadata.json\n',
  });

  assert.equal(valueAfter(args, '/dlib'), 'C:/pkg/Azure.CodeSigning.Dlib.dll');
  assert.equal(valueAfter(args, '/dmdf'), 'C:/tmp/metadata.json');
});

test('buildSigntoolArgs falls back to defaults when overrides are blank', () => {
  const args = buildSigntoolArgs('app.exe', {
    ...FULL_ENV,
    AZURE_FILE_DIGEST: '   ',
    AZURE_TIMESTAMP_SERVER: '',
    AZURE_TIMESTAMP_DIGEST: '\t',
  });

  assert.equal(valueAfter(args, '/fd'), 'SHA256');
  assert.equal(valueAfter(args, '/tr'), 'http://timestamp.acs.microsoft.com');
  assert.equal(valueAfter(args, '/td'), 'SHA256');
});

test('buildSigntoolArgs honors the toolkit-exported digest/timestamp overrides', () => {
  const args = buildSigntoolArgs('app.exe', {
    ...FULL_ENV,
    AZURE_FILE_DIGEST: 'SHA384',
    AZURE_TIMESTAMP_SERVER: 'http://ts.example/test',
    AZURE_TIMESTAMP_DIGEST: 'SHA512',
  });

  assert.equal(valueAfter(args, '/fd'), 'SHA384');
  assert.equal(valueAfter(args, '/tr'), 'http://ts.example/test');
  assert.equal(valueAfter(args, '/td'), 'SHA512');
});
