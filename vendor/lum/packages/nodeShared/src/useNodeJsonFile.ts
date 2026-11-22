import { onMounted, ref, type Ref } from "vue";
import { useNode } from "@lum/nodes-scaffold/runtime";
import { useNodeDocumentState } from "@lum/nodes-scaffold/nodeDocument";

type Snapshot = { text: string; revision: string; encoding: "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be" };
type FileData = { filePath?: string; fileSnapshot?: string };

function errorMessage(error: unknown, fallback: string) {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message || (error instanceof Error ? error.message : fallback);
}
const isExisting = (error: unknown) => (error as { response?: { data?: { data?: { code?: string } } } })?.response?.data?.data?.code === "EEXIST";

/**
 * 节点正文存到 `assets/<节点ID>/<fileName>`，画布 JSON 只记路径（与文本节点同一约定）。
 * 写入带版本号，磁盘被别处改过时报错而不覆盖；复制节点时把当前内容内联，副本落盘到自己的目录。
 */
export function useNodeJsonFile<T>(fileName: string, options: { create: () => T; normalize: (value: unknown) => T; delay?: number }) {
  const { id, node, files, nodeEvent } = useNode();
  const data = node.data as typeof node.data & FileData;
  const path = `assets/${id}/${fileName}`;
  const value = ref(options.create()) as Ref<T>;
  const ready = ref(false);
  const loading = ref(true);
  const state = useNodeDocumentState();
  let workspace: ReturnType<typeof files.getWorkspaceFiles>;
  let snapshot: Snapshot | undefined;
  let saving = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let revision = 0;

  async function load() {
    loading.value = true;
    ready.value = false;
    try {
      if (!id || /[\\/]/.test(id) || id === "." || id === "..") throw new Error("节点 ID 不能作为文件夹名称");
      if (data.filePath !== undefined && data.filePath !== path) throw new Error("节点文件路径无效");
      workspace = files.getWorkspaceFiles();
      if (data.filePath) {
        snapshot = await workspace.readTextSnapshot(path);
        value.value = options.normalize(JSON.parse(snapshot.text));
      } else {
        const initial = data.fileSnapshot !== undefined ? options.normalize(JSON.parse(data.fileSnapshot)) : options.create();
        for (const directory of ["assets", `assets/${id}`]) await workspace.mkdir(directory).catch(error => { if (!isExisting(error)) throw error; });
        await workspace.write(path, JSON.stringify(initial, null, 2), true).catch(error => { if (!isExisting(error)) throw error; });
        snapshot = await workspace.readTextSnapshot(path);
        value.value = options.normalize(JSON.parse(snapshot.text));
        data.filePath = path;
        delete data.fileSnapshot;
      }
      ready.value = true;
      state.dirty = false;
      state.error = "";
    } catch (error) {
      state.error = errorMessage(error, "节点文件读取失败");
    } finally { loading.value = false; }
  }

  function write() {
    const current = ++revision;
    const text = JSON.stringify(value.value, null, 2);
    saving = saving.catch(() => {}).then(async () => {
      if (!snapshot) throw new Error("节点文件尚未加载，无法保存");
      if (text === snapshot.text) return;
      snapshot.revision = await workspace.writeTextSnapshot(path, text, snapshot);
      snapshot.text = text;
      if (current === revision) { state.dirty = false; state.error = ""; }
    }).catch(error => { state.error = errorMessage(error, "节点文件保存失败"); throw error; });
    return saving;
  }

  /** 修改后调用；连续修改合并成一次写入。 */
  function touch(immediate = false) {
    if (!ready.value) return Promise.reject(new Error(state.error || "节点文件尚未加载"));
    state.dirty = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (immediate) return write();
    timer = setTimeout(() => { timer = undefined; void write().catch(() => {}); }, options.delay ?? 600);
    return Promise.resolve();
  }

  async function flush() {
    if (timer) { clearTimeout(timer); timer = undefined; await write(); }
    let pending: Promise<void>;
    do { pending = saving; await pending; } while (pending !== saving);
  }

  async function reload() {
    await flush().catch(() => {});
    snapshot = undefined;
    await load();
  }

  nodeEvent.on("save", async () => {
    if (!ready.value) throw new Error(state.error || "节点文件尚未加载，无法保存");
    await flush();
  });
  nodeEvent.on("copy", () => {
    if (!ready.value) throw new Error("节点文件尚未加载");
    return { filePath: undefined, fileSnapshot: JSON.stringify(value.value) };
  });
  onMounted(() => { void load(); });
  return { value, ready, loading, state, path, touch, flush, reload };
}
