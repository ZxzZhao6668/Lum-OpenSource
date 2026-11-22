import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = fileURLToPath(new URL('../vendor/lum/', import.meta.url));
const env = { ...process.env, NODE_ENV: 'production', RAYON_NUM_THREADS: process.env.RAYON_NUM_THREADS || '1' };

function build(folder) {
  console.log('Building', folder);
  const result = spawnSync(process.env.LUM_BUN_PATH || 'bun', ['run', 'build'], {
    cwd: folder, stdio: 'inherit', env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const group of ['nodes', 'tools', 'ext']) {
  const packages = join(workspace, 'packages', group);
  for (const entry of readdirSync(packages, { withFileTypes: true })) {
    const folder = join(packages, entry.name);
    if (entry.isDirectory() && existsSync(join(folder, 'package.json'))) build(folder);
  }
}
build(join(workspace, 'apps', 'web'));
build(join(workspace, 'apps', 'server'));
