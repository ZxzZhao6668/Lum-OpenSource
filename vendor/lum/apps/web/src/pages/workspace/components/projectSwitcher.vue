<template>
  <el-popover v-model:visible="visible" trigger="click" placement="bottom-start" :width="320" popper-class="workspaceProjectPopover">
    <template #reference>
      <el-button class="currentProject" text :disabled="busy || !workspaceStore.project" :aria-expanded="visible" :title="workspaceStore.project?.name">
        <span>{{ workspaceStore.project?.name ?? "当前项目" }}</span>
        <icon-chevron-down :size="15" aria-hidden="true" />
      </el-button>
    </template>
    <div class="projectChoices" aria-label="最近打开的项目">
      <button v-for="project in projects" :key="project.directory" class="projectChoice" type="button"
        :aria-current="isCurrent(project)" :disabled="busy || isCurrent(project)" :title="project.directory" @click="select(project.directory)">
        <projectCover :directory="project.directory" />
        <span class="projectDetails">
          <strong>{{ project.name }}</strong>
          <small>最近打开 {{ formatTime(project.lastOpenedAt) }}</small>
        </span>
        <small v-if="isCurrent(project)">当前项目</small>
      </button>
    </div>
    <div class="projectActions">
      <el-button :disabled="busy" @click="select(undefined, true)">新建项目</el-button>
      <el-button :disabled="busy" @click="select()">打开已有项目</el-button>
    </div>
  </el-popover>
  <workspacePicker ref="picker" hideTrigger />
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { locale } from "@lum/i18n/vue";
import { IconChevronDown } from "@tabler/icons-vue";
import { useWorkspaceStore, type Project } from "@/stores/workspace";
import projectCover from "@/pages/home/projectCover.vue";
import workspacePicker from "@/pages/home/workspacePicker.vue";

const props = defineProps<{ switchWorkspace: (directory: string, create: boolean) => Promise<void> }>();
const workspaceStore = useWorkspaceStore();
const visible = ref(false);
const busy = ref(false);
const picker = ref<InstanceType<typeof workspacePicker>>();
const projects = computed(() => [...workspaceStore.projectList].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt));
const isCurrent = (project: Project) => project.directory === workspaceStore.project?.directory;
const formatTime = (time: number) => new Date(time).toLocaleString(locale.value, { hour12: false });

async function select(directory?: string, create = false) {
  if (busy.value) return;
  busy.value = true;
  visible.value = false;
  try {
    const target = directory ?? await picker.value?.chooseDirectory();
    if (target) await props.switchWorkspace(target, create);
  } finally { busy.value = false; }
}
</script>

<style scoped lang="scss">
.currentProject {
  min-width: 0;
  max-width: min(50vw, 240px);
  height: 28px;
  margin: 0;
  padding: 0 7px;
  font-weight: 600;
  :deep(> span) { min-width: 0; gap: 6px; }
  :deep(> span > span) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  svg { flex: none; }
}
.projectChoices { max-height: min(360px, 42dvh); overflow-y: auto; }
.projectChoice {
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--el-text-color-primary);
  font: inherit;
  text-align: start;
  cursor: pointer;
  &:disabled { cursor: default; }
  &:hover:not(:disabled), &[aria-current="true"] { background: var(--el-fill-color-light); }
  &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
  :deep(.projectCover) { width: 54px; border-radius: 6px; background: var(--el-fill-color); }
  :deep(.projectCover svg) { width: 22px; }
  small { font-size: 11px; color: var(--el-text-color-secondary); }
}
.projectDetails {
  display: grid;
  gap: 3px;
  strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}
.projectActions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.projectActions .el-button { margin: 0; }
</style>
