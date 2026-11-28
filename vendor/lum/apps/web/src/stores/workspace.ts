import { defineStore } from "pinia";
import { computed, ref } from "vue";
import axios from "axios";
import type { AgentAttachment } from "@/components/agent/types";

export type Project = {
  directory: string;
  name: string;
  lastOpenedAt: number;
};

export const useWorkspaceStore = defineStore("workspace", () => {
  const standaloneProject = ref<Project | null>(null);
  const embeddedProject = ref<Project | null>(null);
  const project = computed(() => embeddedProject.value ?? standaloneProject.value);
  const projectList = ref<Project[]>([]);
  const projectLoading = ref(false);
  const projectLoadingDrawn = ref(false);
  const projectLoadingVisible = ref(false);
  // submit 为 false 时只填入输入框，由用户补充后自己发送（剧本设定器、选区「添加到聊天」）。
  const pendingAgentMessage = ref<{ directory: string; source?: "canvas"; prompt: string; attachments?: AgentAttachment[]; model?: string; reasoningEffort?: string; submit?: boolean } | null>(null);

  async function validateProjectDirectory(path: string, signal?: AbortSignal) {
    const { data } = await axios.get<{ code: number; data?: { directory: string }; message?: string }>("/api/workspaces/check", {
      params: { directory: path }, headers: { "x-lum-workspace": "1" }, signal,
    });
    signal?.throwIfAborted();
    if (data.code !== 200 || !data.data?.directory) throw new Error(data.message || "工作目录校验失败");
    return data.data.directory;
  }

  function recordProject(checkedDirectory: string, previousDirectory: string, name?: string) {
    const existing = projectList.value.find(project => project.directory === previousDirectory)
      ?? projectList.value.find(project => project.directory === checkedDirectory);
    const added = { directory: checkedDirectory, name: name?.trim() || existing?.name || checkedDirectory.split(/[\\/]/).filter(Boolean).at(-1) || checkedDirectory, lastOpenedAt: Date.now() };
    projectList.value = [
      added,
      ...projectList.value.filter(item => item.directory !== previousDirectory && item.directory !== checkedDirectory),
    ];
    return added;
  }

  async function addProject(path: string, name?: string, signal?: AbortSignal, previousDirectory = path) {
    return recordProject(await validateProjectDirectory(path, signal), previousDirectory, name);
  }

  async function openProject(path: string, previousDirectory = path, signal?: AbortSignal) {
    activateProject(await validateProjectDirectory(path, signal), previousDirectory);
  }

  function activateProject(directory: string, previousDirectory = directory) {
    standaloneProject.value = recordProject(directory, previousDirectory);
    embeddedProject.value = null;
    pendingAgentMessage.value = null;
  }

  function activateEmbeddedProject(directory: string) {
    embeddedProject.value = { directory, name: directory.split(/[\\/]/).filter(Boolean).at(-1) || directory, lastOpenedAt: Date.now() };
    pendingAgentMessage.value = null;
  }

  function renameProject(path: string, name: string) {
    if (!name.trim()) return;
    if (embeddedProject.value?.directory === path) {
      embeddedProject.value = { ...embeddedProject.value, name: name.trim() };
      return;
    }
    const target = projectList.value.find(item => item.directory === path);
    if (!target) return;
    target.name = name.trim();
    if (standaloneProject.value?.directory === path) standaloneProject.value = target;
  }

  function removeProject(path: string) {
    projectList.value = projectList.value.filter(item => item.directory !== path);
    if (standaloneProject.value?.directory === path) standaloneProject.value = null;
  }

  return { project, standaloneProject, embeddedProject, projectList, projectLoading, projectLoadingDrawn, projectLoadingVisible, pendingAgentMessage, addProject, openProject, validateProjectDirectory, activateProject, activateEmbeddedProject, renameProject, removeProject };
}, {
  persist: {
    key: "lum.projectList",
    pick: ["standaloneProject", "projectList"],
    storage: {
      getItem: key => localStorage.getItem(key),
      setItem(key, value) {
        // Host frames must not overwrite the standalone catalog with a stale snapshot.
        if (window.parent === window || !new URLSearchParams(location.search).has("project")) {
          localStorage.setItem(key, value);
        }
      },
    },
    beforeHydrate({ store }) {
      // Keep the last standalone project from the old persistence format.
      try {
        const saved = JSON.parse(localStorage.getItem("lum.projectList") ?? "null");
        if (saved && !("standaloneProject" in saved) && saved.project) store.$patch({ standaloneProject: saved.project });
      } catch { /* A malformed saved entry is ignored by the storage plugin. */ }
    },
  },
});
