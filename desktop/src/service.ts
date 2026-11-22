import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { createApp } from '../../vendor/lum/apps/server/src/app';

async function start() {
const resourceRoot = process.env.LUM_RESOURCE_ROOT;
const dataDirectory = process.env.LUM_DATA_DIR || process.env.TOONFLOW_DATA_DIR;
const token = process.env.LUM_SESSION_TOKEN;
const parentPid = Number(process.env.LUM_PARENT_PID);
if (!resourceRoot || !dataDirectory || !token || token.length < 32 || !Number.isInteger(parentPid) || parentPid < 1) {
  throw new Error('请从 Lum 桌面程序启动本地服务。');
}
const expectedToken = Buffer.from(token);
const app = await createApp({
  webRoot: resolve(resourceRoot, 'web'), dataDirectory, appVersion: '1.0.11',
  toolsRoot: resolve(resourceRoot, 'tools'), nodesRoot: resolve(resourceRoot, 'nodes'),
  extRoot: resolve(resourceRoot, 'ext'),
  skillsRoot: resolve(resourceRoot, 'skills'), pluginRevision: process.env.LUM_BUILD_REVISION,
});
const server = createServer((request, response) => {
  const raw = request.headers['x-lum-session'];
  const supplied = typeof raw === 'string' ? Buffer.from(raw) : Buffer.alloc(0);
  if (request.headers.host !== '127.0.0.1:6181' || supplied.length !== expectedToken.length || !timingSafeEqual(supplied, expectedToken)) {
    response.writeHead(403).end('Lum desktop session required'); return;
  }
  if (request.url === '/lumHealth') {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end('{"app":"Lum","version":"1.0.11"}'); return;
  }
  app(request, response);
});
server.listen(6181, '127.0.0.1', () => console.log('LUM_READY'));
server.on('error', error => { console.error(error); process.exit(1); });
const { initializeMcpRuntime, stopMcpRuntime } = await import('../../vendor/lum/apps/server/src/utils/mcp/runtime');
const { closeBrowsers } = await import('../../vendor/lum/apps/server/src/utils/browser');
const { startMobileLinkRuntime, stopMobileLinkRuntime } = await import('../../vendor/lum/apps/server/src/utils/mobileLink');
const { stopPrevisJobs } = await import('../../vendor/lum/apps/server/src/utils/previs');
await initializeMcpRuntime(app, 'http://127.0.0.1:6181', resolve(resourceRoot, 'mcp/stdio.js'), process.env.LUM_BUN_PATH || process.env.TOONFLOW_BUN_PATH, { 'x-lum-session': token });
await startMobileLinkRuntime(app);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  clearInterval(parentWatch);
  // The desktop's 4.5 s process-tree cleanup must run before this final fallback.
  const timeout = setTimeout(() => process.exit(0), 10000);
  timeout.unref();
  server.close();
  server.closeAllConnections();
  stopMobileLinkRuntime(app);
  await Promise.allSettled([stopMcpRuntime(), closeBrowsers(), stopPrevisJobs()]);
  process.exit(0);
}
const parentWatch = setInterval(() => {
  try { process.kill(parentPid, 0); } catch { void close(); }
}, 2000);
parentWatch.unref();
process.stdin.setEncoding('utf8');
process.stdin.on('data', value => { if (String(value).includes('quit')) void close(); });
process.stdin.on('end', () => void close());
process.on('SIGTERM', () => void close());
process.on('SIGINT', () => void close());
}

void start().catch(error => { console.error(error); process.exit(1); });
