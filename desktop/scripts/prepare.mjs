import { cpSync, copyFileSync, existsSync, lstatSync, mkdirSync, realpathSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(desktop, '..');
const vendor = join(root, 'vendor/lum');
const payload = join(desktop, 'payload');
const blenderSource = resolve(process.env.LUM_BLENDER_ROOT || join(root, 'runtime/blender/Blender Foundation/Blender 5.2'));
const mediaTools = resolve(process.env.LUM_MEDIA_TOOLS || join(process.env.LOCALAPPDATA || '', 'Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build'));
// Check every required runtime before doing any build work; a partial installer is not usable.
for (const [file, setting] of [
  [join(blenderSource, 'blender.exe'), 'LUM_BLENDER_ROOT'],
  [join(mediaTools, 'bin/ffmpeg.exe'), 'LUM_MEDIA_TOOLS'],
  [join(mediaTools, 'bin/ffprobe.exe'), 'LUM_MEDIA_TOOLS'],
]) {
  if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`Required runtime file is missing: ${file}. Set ${setting} to a complete runtime directory.`);
}
if (!existsSync(join(desktop, 'assets/lum.ico'))) throw new Error('Generate assets/lum.ico before preparing the desktop.');
const bunResult = spawnSync(process.env.LUM_BUN_PATH || 'bun', ['-p', 'process.execPath'], { encoding: 'utf8', windowsHide: true });
if (bunResult.status !== 0) throw new Error('Install Bun or set LUM_BUN_PATH to bun.exe.');
const bun = bunResult.stdout.trim();
const node = process.execPath;
const fast = process.argv.includes('--reuse-plugins');
const run = (command, args, cwd, extraEnv = {}) => new Promise((resolveRun, reject) => {
  const child = spawn(command, args, { cwd, windowsHide: true, stdio: 'inherit', env: { ...process.env, ...extraEnv } });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`${command} exited ${code}`)));
});
for (const folder of ['out', 'assets', 'payload']) mkdirSync(join(desktop, folder), { recursive: true });
const physicalPayload = join(realpathSync(desktop), 'payload');
if (realpathSync(payload).toLowerCase() !== physicalPayload.toLowerCase()) throw new Error(`Refusing to replace generated files through a redirected payload directory: ${payload}`);
const replaceGeneratedPayload = (folder, source) => {
  const target = resolve(payload, folder);
  // Only direct generated children of this desktop/payload may be removed.
  if (dirname(target) !== payload || (existsSync(target) && lstatSync(target).isSymbolicLink())) throw new Error(`Unsafe generated payload path: ${target}`);
  if (!existsSync(source) || !statSync(source).isDirectory()) throw new Error(`Build output is missing: ${source}`);
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true, dereference: true, filter: file => !/\.(map|d\.ts)$/.test(file) });
};
copyFileSync(join(root, 'app/public/brand/lumLogo.png'), join(desktop, 'assets/lumLogo.png'));
await run(node, ['node_modules/typescript/bin/tsc', '-b'], join(root, 'app'));
// This fixed output directory contains generated assets only.
await run(node, ['node_modules/vite/bin/vite.js', 'build', '--outDir', '../desktop/out/writing', '--emptyOutDir'], join(root, 'app'), { VITE_CANVAS_ORIGIN: 'http://127.0.0.1:6181', VITE_LUM_DESKTOP: '1' });
if (!fast) {
  for (const group of ['nodes', 'tools', 'ext']) {
    for (const entry of readdirSync(join(vendor, 'packages', group), { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(vendor, 'packages', group, entry.name, 'package.json'))) await run(bun, ['run', 'build'], join(vendor, 'packages', group, entry.name), { NODE_ENV: 'production' });
    }
  }
}
await run(node, ['--max-old-space-size=4096', 'node_modules/vite/bin/vite.js', 'build'], join(vendor, 'apps/web'), { RAYON_NUM_THREADS: '1' });
await run(bun, ['run', 'build'], join(vendor, 'apps/server'));
for (const folder of ['web', 'tools', 'nodes', 'ext', 'providers', 'skills', 'mcp']) replaceGeneratedPayload(folder, join(vendor, 'build', folder));
// Provider metadata is parsed from a direct `export default { ... }` AST.
// Keep editable provider source intact; a bundler rewrites that required format.
replaceGeneratedPayload('node_modules', join(vendor, 'build/server/node_modules'));
for (const name of ['ffmpegWorker.js', 'sandboxProcess.js']) copyFileSync(join(vendor, 'build/server', name), join(payload, name));
if (process.env.LUM_STAGE_LIBRARY) {
  const library = resolve(process.env.LUM_STAGE_LIBRARY);
  if (!existsSync(join(library,'packManifest.json'))) throw new Error('Stage library manifest is missing.');
  cpSync(library,join(payload,'stageLibrary'),{recursive:true,dereference:true});
}
copyFileSync(bun, join(payload, 'bun.exe'));
cpSync(blenderSource, join(payload, 'blender'), { recursive: true, dereference: true });
mkdirSync(join(payload, 'mediaTools'), { recursive: true });
for (const name of ['ffmpeg.exe', 'ffprobe.exe']) copyFileSync(join(mediaTools, 'bin', name), join(payload, 'mediaTools', name));
for (const name of ['LICENSE', 'LICENSE.txt']) if (existsSync(join(mediaTools, name))) copyFileSync(join(mediaTools, name), join(payload, 'mediaTools', name));
const external = ['@silvia-odwyer/photon-node', '@firecrawl/anydoc', '@firecrawl/anydoc-wasm', 'just-bash'];
await run(bun, ['build', 'src/service.ts', '--compile', '--minify', ...external.flatMap(name => ['--external', name]), '--outfile', join(payload, 'lumService.exe')], desktop);
await run(bun, ['build', 'src/main.ts', '--target=node', '--format=cjs', '--minify', '--external', 'electron', '--outfile', 'out/main.cjs'], desktop);
await run(bun, ['build', 'src/preload.ts', '--target=node', '--format=cjs', '--minify', '--external', 'electron', '--outfile', 'out/preload.cjs'], desktop);
writeFileSync(join(payload, 'revision.txt'), new Date().toISOString());
mkdirSync(join(payload, 'licenses'), { recursive: true });
for (const entry of readdirSync(vendor)) if (/^(license|notice|copying)/i.test(entry)) copyFileSync(join(vendor, entry), join(payload, 'licenses', entry));
const creativeNotices = join(payload, 'licenses', 'lum-cover-and-creative');
mkdirSync(creativeNotices, { recursive: true });
for (const name of ['LICENSES.txt', 'SOURCES.txt']) copyFileSync(join(root, 'skills/cover-and-creative', name), join(creativeNotices, name));
console.log('Lum desktop payload prepared.');
