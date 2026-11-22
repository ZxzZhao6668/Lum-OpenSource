<template>
  <button type="button" @click="open">Blender 设置</button>
  <div v-if="visible" class="settingsShade" @pointerdown.stop @click.stop @keydown.stop>
    <section class="settingsPanel" role="dialog" aria-label="Blender 输出设置">
      <h3>Blender 后台输出</h3>
      <p role="status">{{ available ? '已检测到可用 Blender' : '未检测到可用 Blender，请指定 blender.exe' }}</p>
      <label>程序路径<input v-model="blenderPath" placeholder="完整 blender.exe 路径；留空自动检测" /></label>
      <p v-if="detectedPath">自动检测：{{ detectedPath }}</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <div><button type="button" :disabled="busy" @click="detect">重新检测</button><button type="button" :disabled="busy" @click="save">保存并检测</button><button type="button" @click="visible = false">关闭</button></div>
    </section>
  </div>
</template>
<script setup lang="ts">
import { ref } from "vue";
const visible = ref(false);
const busy = ref(false);
const available = ref(false);
const blenderPath = ref("");
const detectedPath = ref("");
const error = ref("");
async function request(save = false) {
  busy.value = true; error.value = "";
  try {
    const response = await fetch(`/api/previs/${save ? "saveSettings" : "settings"}`, { method: save ? "PUT" : "GET", headers: { "Content-Type": "application/json", "x-lum-workspace": "1" }, body: save ? JSON.stringify({ blenderPath: blenderPath.value.trim() }) : undefined });
    const result = await response.json();
    if (!response.ok || result.code !== 200) throw new Error(result.message || "Blender 配置失败");
    if (save) { await refresh(); return; }
    update(result.data);
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "Blender 检测失败"; }
  finally { busy.value = false; }
}
function update(value: { blenderPath?: string; detectedPath?: string; available?: boolean }) { blenderPath.value = value.blenderPath ?? ""; detectedPath.value = value.detectedPath ?? ""; available.value = !!value.available; }
async function refresh() { const response = await fetch("/api/previs/settings", { headers: { "x-lum-workspace": "1" } }); const result = await response.json(); if (!response.ok || result.code !== 200) throw new Error(result.message || "Blender 检测失败"); update(result.data); }
function detect() { return request(); }
function save() { return request(true); }
function open() { visible.value = true; void detect(); }
</script>
<style scoped>
button, input { font: inherit; color: #e3e8f2; border: 1px solid #46516a; border-radius: 6px; background: #242d3d; padding: 6px 8px; }
button { cursor: pointer; } button:disabled { opacity: .5; }.settingsShade { position: absolute; inset: 0; display: grid; place-items: center; background: #0008; z-index: 20; }.settingsPanel { width: min(600px, 80vw); padding: 24px; background: #202a3a; border: 1px solid #7aa9df; border-radius: 12px; box-shadow: 0 10px 35px #0008; }.settingsPanel label { display: flex; flex-direction: column; gap: 10px; }.settingsPanel input { width: 100%; box-sizing: border-box; }.settingsPanel p { overflow-wrap: anywhere; }.settingsPanel div { display: flex; gap: 10px; margin-top: 18px; }
</style>
