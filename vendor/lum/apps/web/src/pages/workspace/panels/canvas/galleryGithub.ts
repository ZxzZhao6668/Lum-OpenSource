import { galleryMaxBytes, parseGalleryCanvas, type GalleryCanvas } from "./galleryCanvas";

export const galleryRepository = "ZxzZhao6668/Lum-OpenSource";
const baseBranch = "main";
const apiRoot = "https://api.github.com";
export const galleryFolder = "canvas-gallery/works";
const loginPattern = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;

export function prepareGallerySubmission(work: GalleryCanvas) {
  const reviewed = parseGalleryCanvas(work);
  const json = JSON.stringify(reviewed, null, 2) + "\n";
  const prefix = reviewed.title.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 46).replace(/^-+|-+$/g, "") || "canvas";
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
  return { json, title: reviewed.title, branch: `gallery-${id}`, fileName: `${prefix}-${id}.json` };
}

type Submission = ReturnType<typeof prepareGallerySubmission>;
type Repository = { full_name: string; owner: { login: string }; parent?: { full_name: string }; permissions?: { push?: boolean } };

export function manualGalleryUrls(repository: string, branch: string) {
  const [owner, name, extra] = repository.trim().split("/");
  if (extra !== undefined || !loginPattern.test(owner ?? "") || !/^[a-z\d_-][a-z\d._-]{0,99}$/i.test(name ?? "")) return;
  return {
    upload: `https://github.com/${owner}/${name}/upload/main/${galleryFolder}`,
    compare: `https://github.com/${galleryRepository}/compare/${baseBranch}...${owner}:${name}:${branch}?expand=1`,
  };
}

function base64Content(bytes: Uint8Array) {
  if (typeof bytes.toBase64 === "function") return bytes.toBase64();
  // 每块为 3 的倍数，中间块不会产生 Base64 填充；只将当前块转换为二进制字符串。
  const chunks: string[] = [];
  const chunkSize = 12 * 1024;
  for (let i = 0; i < bytes.length; i += chunkSize) chunks.push(btoa(String.fromCharCode(...bytes.subarray(i, i + chunkSize))));
  return chunks.join("");
}

async function gitBlobSha(bytes: Uint8Array) {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const object = new Uint8Array(header.length + bytes.length);
  object.set(header);
  object.set(bytes, header.length);
  if (!crypto.subtle) throw new Error("当前地址不支持校验已上传的作品，请在本机或 HTTPS 中重试，或使用浏览器投稿。");
  const digest = await crypto.subtle.digest("SHA-1", object);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function requireOk(response: Response, step: string) {
  if (response.ok) return;
  const hint = response.status === 401 ? "请检查令牌是否有效。" : response.status === 403 || response.status === 404
    ? "请检查仓库访问权限、令牌权限和 GitHub 请求额度，也可使用浏览器投稿。" : "请重试或使用浏览器投稿。";
  throw new Error(`${step}失败（GitHub HTTP ${response.status}）。${hint}`);
}

export async function submitGalleryWork(submission: Submission, token: string, signal: AbortSignal, progress: (value: string) => void, committed: (value: string) => void) {
  if (!submission.json.length || submission.json.length > galleryMaxBytes) throw new Error("投稿文件必须为非空 JSON，最大 20 MiB。");
  const bytes = new TextEncoder().encode(submission.json);
  if (bytes.length > galleryMaxBytes) throw new Error("投稿文件超过 20 MiB。");
  const api = (path: string, method = "GET", body?: unknown, accept = "application/vnd.github+json") => fetch(apiRoot + path, {
    method, redirect: "error", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
    signal: AbortSignal.any([signal, AbortSignal.timeout(method === "PUT" ? 300000 : 30000)]),
    headers: { Accept: accept, Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const upstream = `/repos/${galleryRepository}`;
  const { branch, fileName, title } = submission;
  progress("正在确认 GitHub 账户和仓库权限…");
  const [user, repo] = await Promise.all([api("/user"), api(upstream)]);
  requireOk(user, "读取账户"); requireOk(repo, "读取仓库");
  const { login } = await user.json() as { login: string };
  if (!loginPattern.test(login)) throw new Error("GitHub 返回了无效的账户名。");
  const canPush = (await repo.json() as Repository).permissions?.push === true;
  let target = galleryRepository;
  if (!canPush) {
    progress("正在准备你的公开 fork…");
    const defaultFork = await api(`/repos/${login}/Lum-OpenSource`);
    if (defaultFork.status !== 404) requireOk(defaultFork, "查找 fork");
    let fork: Repository | undefined = defaultFork.ok ? await defaultFork.json() : undefined;
    if (!fork || fork.parent?.full_name.toLowerCase() !== galleryRepository.toLowerCase()) {
      const result = await api(`${upstream}/forks`, "POST", { default_branch_only: true, ...(fork ? { name: "Lum-OpenSource-gallery" } : {}) });
      requireOk(result, "创建 fork");
      fork = await result.json() as Repository;
    }
    const [owner, name, extra] = fork.full_name.split("/");
    if (extra !== undefined || owner?.toLowerCase() !== login.toLowerCase() || !/^[a-z\d_-][a-z\d._-]{0,99}$/i.test(name ?? "")) throw new Error("GitHub 返回的 fork 不属于当前投稿账户。");
    target = fork.full_name;
    let ready = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      const forkInfo = await api(`/repos/${target}`);
      if (forkInfo.status !== 404) {
        requireOk(forkInfo, "读取 fork");
        const info: Repository = await forkInfo.json();
        if (info.parent?.full_name.toLowerCase() !== galleryRepository.toLowerCase()) throw new Error("该仓库不是 Lum 作品库的 fork。");
        const ref = await api(`/repos/${target}/git/ref/heads/${baseBranch}`);
        if (ref.ok) { ready = true; break; }
        if (ref.status !== 404 && ref.status !== 409) requireOk(ref, "等待 fork 初始化");
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!ready) throw new Error("GitHub 正在初始化你的 fork，请稍后重试。");
  }
  const targetPath = `/repos/${target}`;
  const owner = target.split("/")[0]!;
  const head = canPush ? branch : `${owner}:${branch}`;
  progress("正在新建投稿分支…");
  const latest = await api(`${upstream}/git/ref/heads/${baseBranch}`);
  requireOk(latest, "读取主分支");
  const { object } = await latest.json() as { object: { sha: string } };
  const created = await api(`${targetPath}/git/refs`, "POST", { ref: `refs/heads/${branch}`, sha: object.sha });
  const filePath = `${galleryFolder}/${fileName}`;
  const contents = `${targetPath}/contents/${filePath}`;
  let uploadedSha: string | undefined;
  if (created.status === 422) {
    const ref = await api(`${targetPath}/git/ref/heads/${branch}`);
    requireOk(ref, "读取已有投稿分支");
    const file = await api(`${contents}?ref=${branch}`, "GET", undefined, "application/vnd.github.object+json");
    if (file.ok) {
      const existing = await file.json() as { type: string; sha: string };
      if (existing.type !== "file" || existing.sha !== await gitBlobSha(bytes)) throw new Error("投稿分支上的文件与预览不同，请在 GitHub 检查后重新投稿。");
      uploadedSha = existing.sha;
    } else {
      if (file.status !== 404) requireOk(file, "读取已提交的文件");
      if ((await ref.json()).object.sha !== object.sha) throw new Error("投稿分支已发生变化，请通过浏览器核对后提交。");
    }
  } else requireOk(created, "新建投稿分支");
  if (!uploadedSha) {
    progress("正在上传当前预览的作品…");
    const written = await api(contents, "PUT", { message: `投稿画布作品：${title}`, content: base64Content(bytes), branch });
    requireOk(written, "上传作品");
    uploadedSha = (await written.json()).content?.sha;
  }
  const compare = manualGalleryUrls(target, branch)!.compare;
  committed(compare);
  progress("正在核对改动并创建审核请求…");
  const changes = await api(`${upstream}/compare/${baseBranch}...${encodeURIComponent(head)}`);
  requireOk(changes, "核对投稿分支");
  const { files } = await changes.json() as { files?: { filename: string; status: string; sha: string }[] };
  if (!uploadedSha || files?.length !== 1 || files[0]?.filename !== filePath || files[0]?.status !== "added" || files[0]?.sha !== uploadedSha) {
    throw new Error("投稿分支包含预览以外的改动，请在 GitHub 查看差异。");
  }
  const pr = await api(`${upstream}/pulls`, "POST", { title: `画布作品：${title}`, head, base: baseBranch, body: "请审核本次新增的画布作品。" });
  let number: number;
  if (pr.status === 422) {
    const existing = await api(`${upstream}/pulls?${new URLSearchParams({ state: "open", head: `${owner}:${branch}`, base: baseBranch })}`);
    requireOk(existing, "查找已有审核请求");
    number = (await existing.json())[0]?.number;
    if (!number) requireOk(pr, "创建审核请求");
  } else {
    requireOk(pr, "创建审核请求");
    number = (await pr.json()).number;
  }
  if (!Number.isSafeInteger(number) || number < 1) throw new Error("请到 GitHub 的 Pull requests 页面核对投稿状态。");
  return `https://github.com/${galleryRepository}/pull/${number}`;
}
