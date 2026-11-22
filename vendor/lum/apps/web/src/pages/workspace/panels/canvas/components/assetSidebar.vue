<template>
  <aside ref="sidebarElement" class="assetSidebar nodrag nopan nowheel" aria-label="资产管理" @dblclick.stop @contextmenu.stop>
    <el-segmented v-model="tab" class="sidebarTabs" :options="tabOptions" size="small" aria-label="资产管理视图" />
    <div class="sidebarToolbar">
      <el-button class="toolbarButton" text :type="searching ? 'primary' : 'default'" :aria-pressed="searching" aria-label="搜索节点" title="搜索节点" @click="toggleSearch">
        <icon-search :size="18" />
      </el-button>
      <el-dropdown trigger="click" placement="bottom-start" @command="kindFilter = $event">
        <el-button class="filterButton" text aria-label="按类型筛选">
          <icon-filter :size="18" /><span>{{ kindLabels[kindFilter] }}</span><icon-chevron-down :size="12" />
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-for="kind in filterKinds" :key="kind" :command="kind" :class="{ currentFilter: kindFilter === kind }">{{ kindLabels[kind] }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-button v-if="tab === 'canvas'" class="toolbarButton expandButton" text :disabled="!groupIds.length" :aria-label="allCollapsed ? '展开全部分组' : '折叠全部分组'" :title="allCollapsed ? '展开全部分组' : '折叠全部分组'" @click="toggleAll">
        <icon-list-tree :size="18" />
      </el-button>
    </div>
    <el-input v-if="searching" ref="searchInput" v-model="query" class="sidebarSearch" size="small" placeholder="搜索节点名称" aria-label="搜索节点名称" clearable @keydown.esc.stop="toggleSearch" />
    <el-scrollbar class="sidebarScroll">
      <ul class="sidebarList" role="tree" aria-label="画布节点">
        <li
          v-for="row in rows"
          :key="row.node.id"
          class="sidebarRow"
          :class="{ groupRow: row.kind === 'group', active: row.node.selected }"
          :style="{ paddingLeft: `${10 + row.depth * 22 + (tab === 'canvas' && row.kind !== 'group' ? 28 : 0)}px` }"
          role="treeitem"
          tabindex="0"
          :aria-expanded="row.kind === 'group' ? !collapsed.has(row.node.id) : undefined"
          :aria-selected="row.node.selected"
          :title="row.label"
          @click="locateNode(row.node)"
          @keydown.enter.stop.prevent="locateNode(row.node)">
          <button v-if="row.kind === 'group' && tab === 'canvas'" type="button" class="rowToggle" :class="{ expanded: !collapsed.has(row.node.id) }" :aria-label="collapsed.has(row.node.id) ? '展开分组' : '折叠分组'" @click.stop="toggleGroup(row.node.id)">
            <icon-chevron-right :size="14" />
          </button>
          <mentionThumbnail v-if="row.image" class="rowIcon" :thumbnail="row.image" :directory="directory"><icon-photo :size="18" /></mentionThumbnail>
          <span v-else class="rowIcon" :class="row.kind"><component :is="kindIcons[row.kind]" :size="row.kind === 'group' ? 22 : 18" aria-hidden="true" /></span>
          <span class="rowText">
            <span class="rowLabel">{{ row.label }}</span>
            <small v-if="row.parentLabel">{{ row.parentLabel }}</small>
          </span>
          <span v-if="row.count !== undefined" class="rowCount">{{ row.count }}</span>
        </li>
      </ul>
      <p v-if="!rows.length" class="sidebarEmpty">{{ query.trim() || kindFilter !== 'all' ? '没有匹配的节点' : tab === 'assets' ? '还没有生成或导入的图片、视频、音频' : '画布上还没有节点' }}</p>
    </el-scrollbar>
    <footer class="sidebarFooter">
      <el-button class="toolbarButton" text aria-label="收起资产管理" title="收起资产管理" @click="visible = false">
        <icon-arrow-bar-to-left :size="18" />
      </el-button>
      <span>{{ tab === 'assets' ? t`共 ${rows.length} 项资产` : t`共 ${nodeCount} 节点` }}</span>
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import { t } from "@lum/i18n/vue";
import { useVueFlow, type GraphNode } from "@vue-flow/core";
import { IconBox, IconFileText, IconFolder, IconMusic, IconPhoto, IconPlayerPlayFilled } from "@tabler/icons-vue";
import type { InputInstance } from "element-plus";
import type { NodeMediaValue } from "@lum/nodes-scaffold/values";
import mentionThumbnail from "@/components/agent/mentionThumbnail.vue";

type NodeKind = "group" | "video" | "image" | "audio" | "text" | "other";
type SidebarRow = { node: GraphNode; depth: number; kind: NodeKind; label: string; parentLabel?: string; count?: number; image?: NodeMediaValue };

const props = defineProps<{ directory?: string; nodeOptions: { type: string; label: string }[] }>();
const visible = defineModel<boolean>({ required: true });
const flow = useVueFlow();
const sidebarElement = ref<HTMLElement>();
const searchInput = ref<InputInstance>();
const tab = ref<"canvas" | "assets">("canvas");
const searching = ref(false);
const query = ref("");
const kindFilter = ref<NodeKind | "all">("all");
const collapsed = reactive(new Set<string>());
const kindIcons = { group: IconFolder, video: IconPlayerPlayFilled, image: IconPhoto, audio: IconMusic, text: IconFileText, other: IconBox };
const filterKinds = ["all", "video", "image", "audio", "text", "other"] as const;
const tabOptions = computed(() => [{ label: t`画布`, value: "canvas" }, { label: t`资产`, value: "assets" }]);
const kindLabels = computed<Record<NodeKind | "all", string>>(() => ({
  all: t`所有类型`, group: t`分组`, video: t`视频`, image: t`图片`, audio: t`音频`, text: t`文本`, other: t`其他`,
}));
const nodes = computed(() => flow.getNodes.value.filter(node => !node.hidden));
const nodeCount = computed(() => nodes.value.filter(node => node.type !== "canvasGroup").length);
const groupIds = computed(() => nodes.value.filter(node => node.type === "canvasGroup").map(node => node.id));
const allCollapsed = computed(() => groupIds.value.length > 0 && groupIds.value.every(id => collapsed.has(id)));
const rows = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase();
  const matches = (node: GraphNode) => (kindFilter.value === "all" || nodeKind(node) === kindFilter.value) && nodeLabel(node).toLocaleLowerCase().includes(keyword);
  if (tab.value === "assets") {
    return nodes.value.flatMap<SidebarRow>(node => {
      const media = nodeMedia(node);
      if (!media || !matches(node)) return [];
      const parent = node.parentNode ? flow.findNode(node.parentNode) : undefined;
      return [{ node, depth: 0, kind: nodeKind(node), label: nodeLabel(node), parentLabel: parent && nodeLabel(parent), image: media.dataType === "IMAGE" ? media.value : undefined }];
    }).sort(compareRows);
  }
  const children = new Map<string, GraphNode[]>();
  for (const node of nodes.value) {
    // 父节点不在画布上时当作顶层节点。
    const parentId = node.parentNode && flow.findNode(node.parentNode) ? node.parentNode : "";
    children.set(parentId, [...children.get(parentId) ?? [], node]);
  }
  const filtering = !!keyword || kindFilter.value !== "all";
  function visit(parentId: string, depth: number): SidebarRow[] {
    return (children.get(parentId) ?? []).map(node => ({ node, depth, kind: nodeKind(node), label: nodeLabel(node) })).sort(compareRows).flatMap<SidebarRow>(row => {
      if (row.kind !== "group") return matches(row.node) ? [{ ...row, image: imageOf(row.node) }] : [];
      const inner = visit(row.node.id, depth + 1);
      // 筛选时只留下有命中节点的分组，并且始终展开。
      if (filtering && !inner.length) return [];
      return [{ ...row, count: inner.filter(item => item.kind !== "group").length }, ...(filtering || !collapsed.has(row.node.id) ? inner : [])];
    });
  }
  return visit("", 0);
});

watch(groupIds, ids => {
  for (const id of collapsed) if (!ids.includes(id)) collapsed.delete(id);
});

function nodeKind(node: GraphNode): NodeKind {
  const type = node.type ?? "";
  if (type === "canvasGroup") return "group";
  if (/video/i.test(type)) return "video";
  if (/image/i.test(type)) return "image";
  if (/audio/i.test(type)) return "audio";
  return /text|script/i.test(type) ? "text" : "other";
}

function nodeLabel(node: GraphNode) {
  return String(node.data?.label || (node.type === "canvasGroup" ? t`分组` : props.nodeOptions.find(item => item.type === node.type)?.label) || node.type || t`未命名节点`);
}

function nodeMedia(node: GraphNode) {
  const outputs = Object.values(node.data?.outputs ?? {}) as ({ dataType?: string; value?: NodeMediaValue } | undefined)[];
  return outputs.find((item): item is { dataType: string; value: NodeMediaValue } => ["IMAGE", "VIDEO", "AUDIO"].includes(item?.dataType ?? "") && !!item?.value?.url);
}

function imageOf(node: GraphNode) {
  const media = nodeMedia(node);
  return media?.dataType === "IMAGE" ? media.value : undefined;
}

// 分组排在前面，按画布上从上到下、从左到右的位置；其余节点按名称排，#2 排在 #10 前。
function compareRows(left: SidebarRow, right: SidebarRow) {
  if (left.kind === "group" && right.kind === "group") {
    return left.node.computedPosition.y - right.node.computedPosition.y || left.node.computedPosition.x - right.node.computedPosition.x;
  }
  return Number(right.kind === "group") - Number(left.kind === "group") || left.label.localeCompare(right.label, undefined, { numeric: true });
}

function toggleGroup(id: string) {
  if (!collapsed.delete(id)) collapsed.add(id);
}

function toggleAll() {
  const expand = allCollapsed.value;
  collapsed.clear();
  if (!expand) groupIds.value.forEach(id => collapsed.add(id));
}

async function toggleSearch() {
  searching.value = !searching.value;
  query.value = "";
  await nextTick();
  searchInput.value?.focus();
}

async function locateNode(node: GraphNode) {
  flow.removeSelectedElements();
  flow.addSelectedNodes([node]);
  flow.nodesSelectionActive.value = false;
  await nextTick();
  const { width, height } = node.dimensions;
  const pane = flow.dimensions.value;
  const covered = sidebarElement.value?.offsetWidth ?? 0;
  // 节点放进侧边栏右侧的可见区域；最多放大到 100%，普通节点靠上一些，给选中后出现在下方的面板留位置。
  const zoom = Math.max(flow.minZoom.value, Math.min(1, (pane.width - covered) * 0.8 / (width || 1), pane.height * 0.7 / (height || 1)));
  const lift = node.type === "canvasGroup" ? 0 : pane.height * 0.2;
  await flow.setCenter(node.computedPosition.x + width / 2 - covered / 2 / zoom, node.computedPosition.y + height / 2 + lift / zoom, { zoom, duration: 250 });
}
</script>

<style lang="scss" scoped>
.assetSidebar {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  width: var(--assetSidebarWidth);
  // 顶部留给左上角的工作区菜单和画布菜单。
  padding: 62px 0 0;
  border-right: 1px solid var(--el-border-color-light);
  background: color-mix(in srgb, var(--el-bg-color-overlay) 97%, transparent);
  backdrop-filter: blur(10px);
  box-sizing: border-box;
  cursor: default;

  .sidebarTabs {
    align-self: flex-start;
    margin: 0 12px 10px;
    padding: 0;
    --el-border-radius-base: var(--ui-radius-large);
    --el-segmented-bg-color: transparent;
    --el-segmented-color: var(--el-text-color-secondary);
    --el-segmented-item-selected-color: var(--el-text-color-primary);
    --el-segmented-item-selected-bg-color: var(--el-fill-color-dark);
    --el-segmented-item-hover-bg-color: var(--el-fill-color-light);
    font-size: 14px;
    font-weight: 600;

    :deep(.el-segmented__item) { padding: 4px 14px; }
  }

  .sidebarToolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 12px;
    border-top: 1px solid var(--el-border-color-lighter);
    border-bottom: 1px solid var(--el-border-color-lighter);

    .filterButton {
      height: 28px;
      margin: 0;
      padding: 0 6px;
      font-weight: 600;
      :deep(> span) { gap: 6px; }
    }
    .expandButton { margin-left: auto; }
  }

  .toolbarButton {
    width: 28px;
    height: 28px;
    margin: 0;
    padding: 0;
  }

  .sidebarSearch { margin: 8px 12px 0; width: auto; }

  .sidebarScroll { flex: 1; min-height: 0; }

  .sidebarList {
    margin: 0;
    padding: 8px 8px 12px;
    list-style: none;

    .sidebarRow {
      display: flex;
      align-items: center;
      gap: 10px;
      height: 46px;
      padding-right: 10px;
      border-radius: var(--el-border-radius-base);
      color: var(--el-text-color-primary);
      font-size: 14px;
      cursor: pointer;

      &:hover { background: var(--el-fill-color-light); }
      &:focus-visible { outline: 2px solid var(--el-color-primary-light-3); outline-offset: -2px; }
      &.active { background: var(--el-color-primary-light-9); }
      &.groupRow { font-weight: 600; }

      .rowToggle {
        display: grid;
        place-items: center;
        flex-shrink: 0;
        width: 18px;
        height: 28px;
        padding: 0;
        border: 0;
        background: none;
        color: var(--el-text-color-secondary);
        cursor: pointer;
        svg { transition: transform 120ms ease; }
        &.expanded svg { transform: rotate(90deg); }
      }

      .rowIcon {
        display: grid;
        place-items: center;
        flex-shrink: 0;
        width: 32px;
        height: 32px;
        border-radius: 7px;
        background: var(--el-fill-color);
        color: var(--el-text-color-secondary);

        &.group { background: none; color: var(--el-text-color-regular); }
      }

      .rowText {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-width: 0;
        line-height: 1.3;

        .rowLabel, small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        small { color: var(--el-text-color-secondary); font-size: 12px; font-weight: 400; }
      }

      .rowCount { flex-shrink: 0; color: var(--el-text-color-secondary); font-size: 12px; font-weight: 400; font-variant-numeric: tabular-nums; }
    }
  }

  .sidebarEmpty {
    margin: 40px 16px;
    color: var(--el-text-color-secondary);
    font-size: 13px;
    text-align: center;
  }

  .sidebarFooter {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 46px;
    padding: 0 14px 0 12px;
    border-top: 1px solid var(--el-border-color-lighter);
    color: var(--el-text-color-secondary);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
}

:global(.el-dropdown-menu__item.currentFilter) { color: var(--el-color-primary); font-weight: 600; }
</style>
