import axios from "axios";
import useWorkspaceFiles from "./workspaceFiles";

export function embeddedHostOrigin() {
  if (window.parent === window || !URL.canParse(document.referrer)) return "";
  const origin = new URL(document.referrer).origin;
  return ["http://127.0.0.1:5178", "http://localhost:5178", "http://127.0.0.1:6178"].includes(origin) ? origin : "";
}

/** Keep the host's project identity across hash-router redirects. */
export function embeddedProjectId() {
  const id = new URLSearchParams(window.location.search).get("project");
  if (!id || id === "legacy" || id === "localProject") return "localProject";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("关联写作项目标识无效");
  }
  return id.toLowerCase();
}

/** Uses the same target checks for a switch and the subsequent workspace entry. */
export async function prepareEmbeddedWorkspace(projectId: string) {
  const { data } = await axios.post<{ code: number; data: { directory: string } }>(
    "/api/integration/project", { projectId }, { headers: { "x-lum-workspace": "1" } },
  );
  const { directory, entries } = await useWorkspaceFiles(data.data.directory).list();
  if (!entries.length) {
    try {
      await useWorkspaceFiles(directory).createInitialCanvas();
    } catch (error) {
      // Another window may have just initialized this project's first canvas.
      if (!axios.isAxiosError(error) || error.response?.status !== 409) throw error;
    }
  }
  return directory;
}
