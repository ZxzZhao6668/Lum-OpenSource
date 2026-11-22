<template>
  <section class="virtualStagePage" aria-label="虚拟片场">
    <header class="stageHeader"><div><span class="stageEyebrow">LUM · 虚拟制作</span><h1>虚拟片场</h1><p>保存布景，安排演员与镜头，继续拍摄你的故事。</p></div><button type="button" :disabled="busy" @click="creating = !creating">{{ creating ? '取消新建' : '新建片场' }}</button></header>
    <form v-if="creating" class="stageCreate" @submit.prevent="create">
      <label for="virtualStageName">片场名称</label><input id="virtualStageName" ref="nameInput" v-model="name" maxlength="80" placeholder="例如：东宫墙外梧桐道" :disabled="busy" />
      <button type="submit" :disabled="busy || !name.trim()">{{ busy ? '正在创建…' : '创建并进入' }}</button>
    </form>
    <div v-if="error" class="stageError" role="alert"><span>{{ error }}</span><button type="button" aria-label="关闭片场提示" @click="error = ''">关闭</button></div>
    <div class="stageListHeader"><h2>本项目的片场</h2><button type="button" :disabled="busy || loading" @click="refresh">刷新</button></div>
    <p v-if="loading" role="status">正在读取片场…</p>
    <div v-else-if="stages.length" class="stageList">
      <button v-for="stage in stages" :key="stage.id" type="button" class="stageCard" :disabled="busy || !!stage.error" :title="stage.error" @click="open(stage.id)">
        <span class="stageVisual" aria-hidden="true"><icon-movie :size="36" /></span><strong>{{ stage.name }}</strong><span v-if="stage.error">{{ stage.error }}</span><span v-else>{{ stage.objectCount }} 个物体 · {{ stage.duration }} 秒</span><span class="stageEnter">{{ stage.error ? '文件已保留，请检查或恢复备份' : '进入片场' }} <icon-arrow-up-right v-if="!stage.error" :size="17" /></span>
      </button>
    </div>
    <div v-else class="stageEmpty"><icon-movie :size="40" /><h2>从一个片场开始</h2><p>布景、演员、动作和摄影机保存在当前项目中。</p><button type="button" :disabled="busy" @click="creating = true">新建片场</button></div>
  </section>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { IconMovie, IconArrowUpRight } from "@tabler/icons-vue";
import type { VirtualStageEntry } from "./canvas/virtualStages";

const props = defineProps<{ list: () => Promise<VirtualStageEntry[]>; open: (id?: string, name?: string) => Promise<unknown> }>();
const stages = ref<VirtualStageEntry[]>([]), name = ref(""), error = ref("");
const loading = ref(false), busy = ref(false), creating = ref(false), nameInput = ref<HTMLInputElement>();
watch(creating, async value => { if (value) { await nextTick(); nameInput.value?.focus(); } });
async function refresh() { loading.value = true; error.value = ""; try { stages.value = await props.list(); } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); } finally { loading.value = false; } }
async function open(id?: string) { if (busy.value) return; busy.value = true; error.value = ""; try { await props.open(id, id ? undefined : name.value.trim()); creating.value = false; name.value = ""; await refresh(); } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); } finally { busy.value = false; } }
function create() { if (name.value.trim()) void open(); }
onMounted(() => { void refresh(); window.addEventListener("lum:virtualStageClosed", refresh); });
onBeforeUnmount(() => window.removeEventListener("lum:virtualStageClosed", refresh));
</script>

<style scoped lang="scss">
.virtualStagePage { position: absolute; inset: 0; overflow: auto; box-sizing: border-box; padding: clamp(20px, 4vw, 56px); padding-bottom: 90px; color: var(--el-text-color-primary); background: var(--el-bg-color);
  button,input { font: inherit; color: inherit; border: 1px solid var(--el-border-color); border-radius: 12px; background: var(--el-fill-color-light); min-height: 38px; padding: 8px 14px; }
  button { cursor: pointer; } button:hover:not(:disabled) { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); } button:disabled { opacity: .55; cursor: wait; } button:focus-visible,input:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 3px; }
  h1 { font-size: 28px; margin: 10px 0; } h2 { font-size: 16px; margin: 0; } p { color: var(--el-text-color-secondary); line-height: 1.7; }
  .stageHeader { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-bottom: 28px; .stageEyebrow { color: var(--el-text-color-secondary); font-size: 11px; letter-spacing: 2px; }
    >button { white-space: nowrap; background: var(--lum-accent, var(--el-color-primary)); color: var(--lum-on-accent, var(--el-color-white)); border-color: transparent; font-weight: 600;
      &:hover:not(:disabled) { background: color-mix(in srgb, var(--lum-accent, var(--el-color-primary)) 88%, var(--el-bg-color)); }
      &:active:not(:disabled) { background: color-mix(in srgb, var(--lum-accent, var(--el-color-primary)) 76%, var(--el-bg-color)); }
    }
  }
  .stageCreate { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 20px; border: 1px solid var(--el-border-color); border-radius: 18px; background: color-mix(in srgb, var(--el-fill-color-light) 85%, transparent); backdrop-filter: blur(18px); margin-bottom: 24px; input { flex: 1; min-width: 180px; } }
  .stageError { display: flex; gap: 16px; align-items: center; padding: 12px 16px; border: 1px solid var(--el-color-danger); border-radius: 12px; margin-bottom: 20px; span { flex: 1; overflow-wrap: anywhere; } }
  .stageListHeader { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
  .stageList { display: grid; grid-template-columns: repeat(auto-fill,minmax(230px,1fr)); gap: 18px; }
  .stageCard { display: flex; flex-direction: column; gap: 12px; align-items: stretch; text-align: left; padding: 18px; border-radius: 18px; background: color-mix(in srgb,var(--el-fill-color-light) 88%,transparent); backdrop-filter: blur(18px); strong { font-size: 16px; overflow-wrap: anywhere; } >span:not(.stageVisual) { font-size: 12px; color: var(--el-text-color-secondary); } .stageVisual { display: grid; place-items: center; height: 116px; border: 1px solid var(--el-border-color); border-radius: 12px; background: var(--el-bg-color); color: var(--el-text-color-secondary); } .stageEnter { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--el-border-color); padding-top: 12px; } }
  .stageEmpty { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 300px; gap: 14px; border: 1px dashed var(--el-border-color); border-radius: 20px; text-align: center; padding: 24px; p { margin: 0 0 10px; } }
}
</style>
