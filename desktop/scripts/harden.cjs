const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const { existsSync } = require('node:fs');
const path = require('node:path');
module.exports = async context => {
  for (const dependency of ['@silvia-odwyer/photon-node', '@firecrawl/anydoc', '@firecrawl/anydoc-wasm', 'just-bash']) {
    const manifest = path.join(context.appOutDir, 'resources/payload/node_modules', dependency, 'package.json');
    if (!existsSync(manifest)) throw new Error(`Missing packaged service dependency: ${manifest}`);
  }
  await flipFuses(path.join(context.appOutDir, 'Lum.exe'), {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
};
