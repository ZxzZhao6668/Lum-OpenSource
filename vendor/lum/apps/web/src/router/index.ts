import { createRouter, createWebHashHistory } from "vue-router";
import { useHelloStore } from "@/stores/hello";
import { useWorkspaceStore } from "@/stores/workspace";
import axios from "axios";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { embeddedProjectId } from "@/lib/embeddedProject";
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      redirect: "/hello",
    },
    {
      path: "/hello",
      beforeEnter: async () => await useHelloStore().load() ? { path: "/home", replace: true } : true,
      component: () => import("@/pages/hello/index.vue"),
    },
    {
      path: "/home",
      component: () => import("@/pages/home/index.vue"),
    },
    {
      path: "/embeddedWorkspace",
      component: () => import("@/pages/home/index.vue"),
      beforeEnter: async () => {
        const workspace = useWorkspaceStore();
        const { data } = await axios.post<{ code: number; data: { directory: string } }>(
          "/api/integration/project", { projectId: embeddedProjectId() }, { headers: { "x-lum-workspace": "1" } },
        );
        const files = useWorkspaceFiles(data.data.directory);
        const { directory, entries } = await files.list();
        if (!entries.length) {
          try {
            await useWorkspaceFiles(directory).writeJson("画布1.json", {
              lumCanvas: true, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
            }, true);
          } catch (error) {
            // 另一个窗口可能刚创建初始画布，仅容忍服务端明确的同名冲突。
            if (!axios.isAxiosError(error) || error.response?.status !== 409) throw error;
          }
        }
        await workspace.openProject(directory);
        return { path: "/workspace", replace: true };
      },
    },
    {
      path: "/canvas",
      redirect: "/workspace",
    },
    {
      path: "/workspace",
      component: () => import("@/pages/workspace/index.vue"),
    },
  ],
});
export default router;
