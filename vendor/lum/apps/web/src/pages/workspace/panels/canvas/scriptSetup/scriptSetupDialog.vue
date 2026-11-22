<template>
  <el-dialog v-model="visible" width="min(1080px, calc(100vw - 32px))" alignCenter appendToBody class="scriptSetupDialog" :showClose="false">
    <div class="setupLayout">
      <aside v-if="showPresets" class="presetPanel" aria-label="爆款预设">
        <h3>爆款预设 Top 8</h3>
        <button v-for="(preset, index) in presets" :key="preset.label" type="button" class="presetItem" :class="{ active: activePreset === preset.label }" :aria-pressed="activePreset === preset.label" @click="applyPreset(preset.label)">
          <span class="rank">{{ index + 1 }}</span>{{ preset.label }}
        </button>
      </aside>
      <section class="setupMain">
        <header class="setupHeader">
          <h2>剧本设定器</h2>
          <el-button text :icon="IconX" aria-label="关闭" @click="visible = false" />
        </header>
        <div class="genreStage">
          <genreWheel class="mainWheel" label="主题材" :selected="mainGenre.label" :options="mainOptions" @select="selectMain" />
          <div class="genrePreview">
            <img :src="artUrl(mainGenre)" :alt="describeGenre(mainGenre)" :title="describeGenre(mainGenre)" />
            <div class="fusionPreview">
              <img v-if="fusionGenre" :src="artUrl(fusionGenre)" :alt="describeGenre(fusionGenre)" :title="describeGenre(fusionGenre)" />
              <button type="button" :class="fusionGenre ? 'removeFusion' : 'addFusion'"
                :aria-label="fusionAction" :title="fusionAction" @click="selectFusion(fusionGenre ? noFusion.label : nextFusion)">
                <icon-minus v-if="fusionGenre" :size="15" />
                <icon-plus v-else :size="24" />
              </button>
            </div>
          </div>
          <genreWheel class="fusionWheel" label="副题材" :selected="fusionGenre?.label ?? noFusion.label" :options="fusionOptions" @select="selectFusion" />
        </div>
        <div class="settingCards">
          <el-popover v-for="field in fields" :key="field.key" trigger="click" placement="top" :width="380">
            <template #reference>
              <button type="button" class="settingCard">
                <component :is="field.icon" :size="20" />
                <span><small>{{ field.label }}</small><strong>{{ field.summary() }}</strong></span>
              </button>
            </template>
            <div class="fieldPopover">
              <header><strong>{{ field.label }}</strong><small>{{ field.limit ? `至多 ${field.limit} 项` : "单选" }}</small></header>
              <template v-if="field.key === 'structure'">
                <label>集数 <el-slider v-model="value.episodes" :min="1" :max="30" showInput size="small" /></label>
                <label>每集分钟 <el-slider v-model="value.episodeMinutes" :min="1" :max="15" showInput size="small" /></label>
                <div class="tagList">
                  <el-check-tag v-for="item in structures" :key="item" :checked="value.structure === item" @change="value.structure = item">{{ item }}</el-check-tag>
                </div>
              </template>
              <template v-else-if="field.key === 'style'">
                <div class="styleList">
                  <button v-for="item in styles" :key="item.label" type="button" class="styleItem" :class="{ active: value.style === item.label }" @click="value.style = value.style === item.label ? '' : item.label">
                    <span class="swatches"><i v-for="color in item.swatches" :key="color" :style="{ background: color }" /></span>{{ item.label }}
                  </button>
                </div>
                <el-input v-model="customStyle" size="small" placeholder="其他：自己描述画风，回车确定" @keydown.enter.prevent="useCustomStyle" />
              </template>
              <template v-else>
                <div class="tagList">
                  <el-check-tag v-for="item in field.options" :key="item.label" :checked="value[field.key].includes(item.label)" @change="toggle(field.key, item.label)">{{ item.label }}</el-check-tag>
                  <el-check-tag v-for="item in value[field.key].filter(item => !field.options!.some(option => option.label === item))" :key="item" checked @change="toggle(field.key, item)">{{ item }}</el-check-tag>
                </div>
                <el-input v-model="custom[field.key]" size="small" placeholder="其他：自己填写，回车添加" @keydown.enter.prevent="addCustom(field.key)" />
              </template>
            </div>
          </el-popover>
        </div>
        <el-input v-model="extra" type="textarea" :autosize="{ minRows: 1, maxRows: 3 }" placeholder="补充一句（可选）：例如主角是谁、想要的结局、必须出现的桥段" aria-label="补充要求" />
        <footer class="setupFooter">
          <label class="presetSwitch"><el-switch v-model="showPresets" size="small" />展示爆款预设</label>
          <span class="spacer" />
          <el-button @click="visible = false">取消</el-button>
          <el-button type="primary" @click="confirm">确认</el-button>
        </footer>
      </section>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { IconClockHour4, IconMinus, IconMovie, IconPalette, IconPlus, IconSparkles, IconUsers, IconUserCircle, IconX } from "@tabler/icons-vue";
import genreWheel from "./genreWheel.vue";
import { audiences, emptySetup, eras, genres, highlights, limits, presets, roles, structures, styles, toScriptSetup, type SetupOption, type SetupValue } from "./scriptSetupCatalog";

const visible = defineModel<boolean>({ default: false });
const emit = defineEmits<{ confirm: [payload: { setup: ReturnType<typeof toScriptSetup>; value: SetupValue; extra: string }] }>();
const value = reactive<SetupValue>({ ...emptySetup(), genres: [genres[0]!.label] });
const showPresets = ref(true);
const activePreset = ref("");
const extra = ref("");
const customStyle = ref("");
const custom = reactive<Record<string, string>>({});
type ListKey = "audience" | "roles" | "era" | "highlights";

const genreArt = import.meta.glob<string>("./genreArt/*.webp", { eager: true, import: "default", query: "?url" });
const artUrl = (item: SetupOption) => genreArt[`./genreArt/${item.label}.webp`];
const describeGenre = (item: SetupOption) => `${item.label} · ${item.hint}`;
const noFusion = { label: "无融合", hint: "仅使用主题材" };
const mainGenre = computed(() => genres.find(item => item.label === value.genres[0])!);
const fusionGenre = computed(() => genres.find(item => item.label === value.genres[1]));
const fusionAction = computed(() => fusionGenre.value ? "取消融合" : "添加融合题材");
const mainOptions = computed(() => genres.filter(item => item.label !== value.genres[1]));
const fusionOptions = computed(() => [noFusion, ...genres.filter(item => item.label !== value.genres[0])]);
const nextFusion = computed(() => genres[(genres.indexOf(mainGenre.value) + 1) % genres.length]!.label);
function selectMain(label: string) {
  value.genres = fusionGenre.value ? [label, fusionGenre.value.label] : [label];
}
function selectFusion(label: string) {
  value.genres = label === noFusion.label ? [mainGenre.value.label] : [mainGenre.value.label, label];
}
// 同步清除手动编辑后的高亮，应用预设时再在所有字段填充完成后选中。
watch(value, () => { activePreset.value = ""; }, { flush: "sync" });

const auto = (items: string[]) => items.length ? items.join("、") : "自动";
const fields: { key: ListKey | "style" | "structure"; label: string; icon: unknown; limit?: number; options?: SetupOption[]; summary: () => string }[] = [
  { key: "audience", label: "目标受众", icon: IconUsers, limit: limits.audience, options: audiences, summary: () => auto(value.audience) },
  { key: "roles", label: "角色设定", icon: IconUserCircle, limit: limits.roles, options: roles, summary: () => auto(value.roles) },
  { key: "era", label: "时代背景", icon: IconClockHour4, limit: limits.era, options: eras, summary: () => auto(value.era) },
  { key: "highlights", label: "核心看点", icon: IconSparkles, limit: limits.highlights, options: highlights, summary: () => auto(value.highlights) },
  { key: "style", label: "画风", icon: IconPalette, summary: () => value.style || "自动" },
  { key: "structure", label: "剧本结构", icon: IconMovie, summary: () => `${value.episodes} 集 · ${value.structure}` },
];
function toggle(key: ListKey, label: string) {
  const list = value[key];
  if (list.includes(label)) { value[key] = list.filter(item => item !== label); return; }
  const limit = limits[key];
  value[key] = list.length >= limit ? [...list.slice(1), label] : [...list, label];
}
function addCustom(key: string) {
  const label = custom[key]?.trim();
  if (!label) return;
  toggle(key as ListKey, label.slice(0, 20));
  custom[key] = "";
}
function useCustomStyle() {
  if (!customStyle.value.trim()) return;
  value.style = customStyle.value.trim().slice(0, 60);
  customStyle.value = "";
}
function applyPreset(label: string) {
  const preset = presets.find(item => item.label === label);
  if (!preset) return;
  Object.assign(value, structuredClone(preset.value));
  activePreset.value = label;
}
const payload = computed(() => {
  const plain = JSON.parse(JSON.stringify(value)) as SetupValue;
  return { setup: toScriptSetup(plain, extra.value), value: plain, extra: extra.value.trim() };
});
function confirm() {
  emit("confirm", payload.value);
  visible.value = false;
}
</script>

<style lang="scss" scoped>
.setupLayout {
  display: flex;
  gap: 16px;
  min-height: 520px;

  .presetPanel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 220px;
    flex-shrink: 0;

    h3 { margin: 0 0 4px; font-size: 16px; }

    .presetItem {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border: 1px solid var(--el-border-color);
      border-radius: 12px;
      background: var(--el-fill-color-lighter);
      color: var(--el-text-color-primary);
      font: inherit;
      text-align: left;
      cursor: pointer;

      .rank {
        display: inline-grid;
        place-items: center;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: var(--el-fill-color-dark);
        font-size: 12px;
      }

      &:hover, &.active { border-color: var(--el-color-primary); }
      &.active .rank { background: var(--el-color-primary); color: var(--el-color-white); }
    }
  }

  .setupMain {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 16px;
    min-width: 0;

    .setupHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;

      h2 { margin: 0; font-size: 18px; }
    }

    .genreStage {
      display: grid;
      grid-template-columns: minmax(74px, 1fr) minmax(0, 2.4fr) minmax(74px, 1fr);
      align-items: center;
      gap: clamp(10px, 2vw, 26px);
      padding: 8px 0 16px;
      border-bottom: 1px solid var(--el-border-color-lighter);

      .genrePreview {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: clamp(5px, 0.8vw, 12px);
        min-width: 0;

        img, .fusionPreview {
          display: block;
          width: calc(50% - 6px);
          max-width: 158px;
          aspect-ratio: 1;
          border-radius: 50%;
        }

        img {
          object-fit: cover;
          background: var(--el-fill-color-light);
          box-shadow: 0 4px 16px rgb(0 0 0 / 16%);
        }

        .fusionPreview {
          position: relative;
          img { width: 100%; }
          button {
            display: grid;
            place-items: center;
            border-radius: 50%;
            color: var(--el-text-color-regular);
            cursor: pointer;
            &:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); }
          }
          .addFusion {
            width: 100%;
            height: 100%;
            border: 1px dashed var(--el-border-color-dark);
            background: var(--el-fill-color-light);
          }
          .removeFusion {
            position: absolute;
            top: 1%;
            right: 1%;
            width: 28px;
            height: 28px;
            padding: 0;
            border: 1px solid var(--el-border-color);
            background: var(--el-bg-color-overlay);
          }
        }
      }
    }

    .settingCards {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;

      .settingCard {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px;
        border: 1px solid var(--el-border-color);
        border-radius: 12px;
        background: var(--el-fill-color-lighter);
        color: var(--el-text-color-primary);
        font: inherit;
        text-align: left;
        cursor: pointer;

        span { display: flex; flex-direction: column; min-width: 0; }
        small { color: var(--el-text-color-secondary); font-size: 12px; }
        strong { overflow: hidden; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
        &:hover { border-color: var(--el-color-primary); }
      }
    }

    .setupFooter {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: auto;

      .presetSwitch { display: flex; align-items: center; gap: 8px; color: var(--el-text-color-regular); }
      .spacer { flex: 1; }
    }
  }
}

.fieldPopover {
  display: flex;
  flex-direction: column;
  gap: 10px;

  header { display: flex; align-items: baseline; gap: 8px; small { color: var(--el-text-color-secondary); } }
  label { display: flex; flex-direction: column; gap: 4px; color: var(--el-text-color-secondary); font-size: 12px; }
  .tagList { display: flex; flex-wrap: wrap; gap: 6px; }

  .styleList {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 6px;
    max-height: 260px;
    overflow: auto;

    .styleItem {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border: 1px solid var(--el-border-color-lighter);
      border-radius: 8px;
      background: transparent;
      color: var(--el-text-color-primary);
      font: inherit;
      font-size: 13px;
      cursor: pointer;

      .swatches { display: flex; i { width: 10px; height: 18px; } i:first-child { border-radius: 3px 0 0 3px; } i:last-child { border-radius: 0 3px 3px 0; } }
      &.active { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
    }
  }
}

@media (max-width: 820px) {
  .setupLayout {
    flex-direction: column;
    min-height: 0;
    max-height: calc(100dvh - 100px);
    overflow-y: auto;
    overscroll-behavior: contain;

    .presetPanel {
      display: grid;
      grid-template-columns: repeat(8, max-content);
      gap: 6px;
      width: auto;
      padding-bottom: 4px;
      overflow-x: auto;
      h3 { grid-column: 1 / -1; }
      .presetItem { padding: 5px 8px; }
    }
  }
}

@media (max-width: 540px) {
  .setupLayout .setupMain {
    gap: 12px;

    .genreStage {
      grid-template-columns: minmax(68px, 1fr) minmax(64px, 1.2fr) minmax(68px, 1fr);
      gap: 6px;
      .genrePreview {
        flex-direction: column;
        img, .fusionPreview { width: min(100%, 78px); }
      }
    }
    .settingCards {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
      .settingCard { padding: 8px; gap: 6px; }
    }
    .setupFooter { flex-wrap: wrap; }
  }
}
</style>
