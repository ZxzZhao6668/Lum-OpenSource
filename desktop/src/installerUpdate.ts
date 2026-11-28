import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

const repository = 'ZxzZhao6668/Lum-OpenSource';
const releasesApi = `https://api.github.com/repos/${repository}/releases/latest`;
const assetOrigin = 'https://release-assets.githubusercontent.com';
const assetPrefix = '/github-production-release-asset/1467507757/';
const userAgent = 'Lum-Desktop';
const networkTimeout = 30_000;

type InstallerUpdateSnapshot = {
  status: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready';
  currentVersion: string;
  latestVersion: string;
  notes: string;
  received: number;
  total: number;
  error: string;
};

type InstallerAsset = {
  name: string;
  url: string;
  size: number;
  sha256: string;
};

type VerifiedInstaller = { path: string; sha256: string };

type GitHubAsset = {
  name?: unknown;
  state?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
  digest?: unknown;
};

type GitHubRelease = {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  body?: unknown;
  assets?: GitHubAsset[];
};

class UpdateError extends Error {}

function isNewer(latest: string, current: string) {
  const installed = current.match(/^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!installed) throw new UpdateError('无法识别当前 Lum 版本。');
  const version = latest.split('.').map(BigInt);
  const currentParts = installed.slice(1, 4).map(BigInt);
  for (let index = 0; index < version.length; index++) {
    if (version[index] !== currentParts[index]) return version[index] > currentParts[index];
  }
  return Boolean(installed[4]);
}

function matchingInstaller(release: GitHubRelease, tag: string, version: string): InstallerAsset {
  const name = `Lum-Setup-${version}-x64.exe`;
  const url = `https://github.com/${repository}/releases/download/${tag}/${name}`;
  const matches = Array.isArray(release.assets) ? release.assets.filter(asset => asset?.name === name) : [];
  const asset = matches[0];
  if (matches.length !== 1 || asset.state !== 'uploaded' || asset.browser_download_url !== url) {
    throw new UpdateError('此版本未提供可用的 Windows x64 安装包，可查看 GitHub 发布页。');
  }
  const digest = typeof asset.digest === 'string' ? /^sha256:([a-f\d]{64})$/i.exec(asset.digest) : null;
  if (!digest || typeof asset.size !== 'number' || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
    throw new UpdateError('GitHub 发布附件缺少有效的大小或 SHA-256，无法安全下载安装包。');
  }
  return { name, url, size: asset.size, sha256: digest[1].toLowerCase() };
}

async function latestRelease() {
  const response = await fetch(releasesApi, {
    headers: {
      'User-Agent': userAgent,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(networkTimeout),
  });
  if (response.status !== 200) {
    void response.body?.cancel().catch(() => {});
    throw new UpdateError(`GitHub 返回 HTTP ${response.status}，请稍后重试检查更新。`);
  }
  const release = await response.json() as GitHubRelease;
  const tag = release?.tag_name;
  const version = typeof tag === 'string' && tag.match(/^v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/);
  if (typeof tag !== 'string' || !version || release.draft !== false || release.prerelease !== false) {
    throw new UpdateError('GitHub 没有返回可识别的 Lum 正式版本。');
  }
  return { release, tag, version: version[1], notes: typeof release.body === 'string' ? release.body : '' };
}

async function downloadResponse(asset: InstallerAsset, signal: AbortSignal) {
  let url = new URL(asset.url);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetch(url, {
      headers: { 'User-Agent': userAgent, 'Accept-Encoding': 'identity' }, redirect: 'manual', signal,
    });
    if (response.status === 200 && response.body) return { body: response.body, headers: response.headers };
    void response.body?.cancel().catch(() => {});
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      throw new UpdateError(`下载安装包时 GitHub 返回 HTTP ${response.status}，请重试。`);
    }

    const location = response.headers.get('location');
    const target = location && new URL(location, url);
    if (!target || target.origin !== assetOrigin || target.username || target.password
      || !target.pathname.startsWith(assetPrefix) || target.hash) {
      throw new UpdateError('GitHub 安装包重定向到了未受信任的地址。');
    }
    url = target;
  }
  throw new UpdateError('GitHub 安装包的重定向次数过多，请重试。');
}

async function hasVerifiedContents(path: string, asset: InstallerAsset) {
  const entry = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (!entry || !entry.isFile() || entry.size !== asset.size) return false;

  const file = await open(path, 'r');
  try {
    const opened = await file.stat();
    if (opened.dev !== entry.dev || opened.ino !== entry.ino || opened.size !== asset.size) return false;
    const hash = createHash('sha256');
    for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
    const verified = hash.digest('hex') === asset.sha256;
    const after = await lstat(path);
    return verified && after.isFile() && after.dev === opened.dev && after.ino === opened.ino
      && after.size === opened.size && after.mtimeMs === opened.mtimeMs && after.ctimeMs === opened.ctimeMs;
  } finally {
    await file.close();
  }
}

async function downloadInstaller(asset: InstallerAsset, path: string, onProgress: (received: number) => void) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resetTimeout = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), networkTimeout);
  };
  resetTimeout();
  try {
    const response = await downloadResponse(asset, controller.signal);
    const size = response.headers.get('content-length');
    if (size !== null && Number(size) !== asset.size) {
      void response.body.cancel().catch(() => {});
      throw new UpdateError('下载安装包的大小与 GitHub 发布信息不一致，请重新下载。');
    }

    let received = 0;
    const hash = createHash('sha256');
    const reader = response.body.getReader();
    const cancelRead = () => { void reader.cancel().catch(() => {}); };
    controller.signal.addEventListener('abort', cancelRead, { once: true });
    try {
      const file = await open(path, 'wx');
      try {
        while (true) {
          const { done, value } = await reader.read();
          controller.signal.throwIfAborted();
          if (done) break;
          received += value.byteLength;
          if (received > asset.size) {
            throw new UpdateError('下载安装包的大小与 GitHub 发布信息不一致，请重新下载。');
          }
          resetTimeout();
          hash.update(value);
          await file.writeFile(value);
          onProgress(received);
        }
      } finally {
        await file.close();
      }
    } finally {
      controller.signal.removeEventListener('abort', cancelRead);
      cancelRead();
      reader.releaseLock();
    }
    if (received !== asset.size || hash.digest('hex') !== asset.sha256) {
      throw new UpdateError('安装包的大小或 SHA-256 校验失败，请重新下载。');
    }
  } catch (error) {
    if (controller.signal.aborted) throw new UpdateError('下载安装包时连接超时，请重试。');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function createInstallerUpdate(currentVersion: string, cacheDir: string) {
  let snapshot: InstallerUpdateSnapshot = {
    status: 'idle', currentVersion, latestVersion: '', notes: '', received: 0, total: 0, error: '',
  };
  let asset: InstallerAsset | undefined;
  let pendingVerification: Promise<VerifiedInstaller> | undefined;
  const read = () => ({ ...snapshot });
  const busy = () => snapshot.status === 'checking' || snapshot.status === 'downloading' || Boolean(pendingVerification);
  const cachedPath = (candidate: InstallerAsset) => join(cacheDir, `${candidate.sha256}-${candidate.name}`);
  const errorMessage = (error: unknown, fallback: string) => error instanceof UpdateError ? error.message : fallback;

  function check() {
    if (busy()) return read();
    const previous = snapshot;
    snapshot = { ...snapshot, status: 'checking', error: '' };
    void (async () => {
      try {
        const latest = await latestRelease();
        const status = { latestVersion: latest.version, notes: latest.notes, received: 0, total: 0 };
        if (!isNewer(latest.version, currentVersion)) {
          asset = undefined;
          snapshot = { ...snapshot, ...status, status: 'current' };
          return;
        }

        asset = undefined;
        snapshot = { ...snapshot, ...status };
        const candidate = matchingInstaller(latest.release, latest.tag, latest.version);
        // GitHub supplies the expected digest on every check, including after a restart.
        const cached = await hasVerifiedContents(cachedPath(candidate), candidate).catch(() => false);
        asset = candidate;
        snapshot = { ...snapshot, status: cached ? 'ready' : 'available', received: cached ? candidate.size : 0, total: candidate.size };
      } catch (error) {
        const base = asset ? previous : { ...snapshot, status: 'idle' as const };
        snapshot = { ...base, error: errorMessage(error, '无法连接 GitHub 检查更新，请检查网络后重试。') };
      }
    })();
    return read();
  }

  function download() {
    if (busy() || snapshot.status === 'ready') return read();
    const candidate = asset;
    if (!candidate) return read();
    snapshot = { ...snapshot, status: 'downloading', received: 0, error: '' };
    void (async () => {
      let stagingDir: string | undefined;
      try {
        const destination = cachedPath(candidate);
        if (!await hasVerifiedContents(destination, candidate)) {
          await mkdir(cacheDir, { recursive: true });
          stagingDir = await mkdtemp(join(cacheDir, 'download-'));
          const partial = join(stagingDir, 'installer.part');
          await downloadInstaller(candidate, partial, received => { snapshot.received = received; });
          await rename(partial, destination);
        }
        snapshot = { ...snapshot, status: 'ready', received: candidate.size };
      } catch (error) {
        snapshot = { ...snapshot, status: 'available', received: 0,
          error: errorMessage(error, '下载安装包失败，请检查网络和可用磁盘空间后重试。') };
      } finally {
        if (stagingDir) await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
      }
    })();
    return read();
  }

  function verifiedInstaller(): Promise<VerifiedInstaller> {
    if (pendingVerification) return pendingVerification;
    const candidate = asset;
    if (snapshot.status !== 'ready' || !candidate) return Promise.reject(new UpdateError('请先下载并校验安装包。'));
    const destination = cachedPath(candidate);
    pendingVerification = (async () => {
      try {
        if (await hasVerifiedContents(destination, candidate).catch(() => false)) {
          return { path: destination, sha256: candidate.sha256 };
        }
        const error = '本地安装包校验失败，请重新下载。';
        snapshot = { ...snapshot, status: 'available', received: 0, error };
        throw new UpdateError(error);
      } finally {
        pendingVerification = undefined;
      }
    })();
    return pendingVerification;
  }

  return { read, check, download, verifiedInstaller };
}
