/** Keep the host's project identity across hash-router redirects. */
export function embeddedProjectId() {
  const id = new URLSearchParams(window.location.search).get("project");
  if (!id || id === "legacy" || id === "localProject") return "localProject";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("关联写作项目标识无效");
  }
  return id.toLowerCase();
}
