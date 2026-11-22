import axios from "axios";

export async function installPluginFile(type: "node" | "tool" | "skill" | "agent" | "ext", file: File, mode: boolean | "createOnly" = false) {
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error("请选择非空且不超过 20 MB 的插件文件");
  const payload = mode !== "createOnly" && (type === "skill" || type === "agent")
    ? { fileName: file.name, base64: await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",", 2)[1]!);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      }) }
    : { fileName: file.name, source: await file.text() };
  const url = mode === "createOnly" ? "/api/plugins/create" : `/api/${type === "ext" ? "ext" : `${type}s`}/install`;
  const { data } = await axios.post(url, { ...payload, ...(mode === "createOnly" ? { type } : { force: mode }) }, { headers: { "x-lum-workspace": "1" } });
  if (data.code !== 200) throw new Error(data.message || "安装插件失败");
  const name = data.data?.name;
  if (typeof name !== "string" || !name.trim()) throw new Error("安装接口未返回有效的插件名称");
  window.dispatchEvent(new CustomEvent("lum:plugin-installed", { detail: { type, name } }));
  if (type === "ext") window.dispatchEvent(new CustomEvent("lum:ext-updated", { detail: { name } }));
  return name;
}
