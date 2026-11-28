import { createRouter, createWebHashHistory } from "vue-router";
import { useHelloStore } from "@/stores/hello";
import { useWorkspaceStore } from "@/stores/workspace";
import { embeddedHostOrigin, embeddedProjectId, prepareEmbeddedWorkspace } from "@/lib/embeddedProject";
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
        useWorkspaceStore().activateEmbeddedProject(await prepareEmbeddedWorkspace(embeddedProjectId()));
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
      beforeEnter: async () => {
        const workspace = useWorkspaceStore();
        if (embeddedHostOrigin() && !workspace.embeddedProject) {
          workspace.activateEmbeddedProject(await prepareEmbeddedWorkspace(embeddedProjectId()));
        }
      },
    },
  ],
});
export default router;
