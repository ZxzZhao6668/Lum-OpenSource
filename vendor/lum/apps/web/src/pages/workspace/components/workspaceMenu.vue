<template>
  <div class="workspaceMenu">
    <el-card shadow="never" :bodyStyle="{ padding: '2px 4px' }">
      <div class="menuContent">
        <el-button class="toolButton" text aria-label="退出项目" title="退出项目" @click="exitVisible = true">
          <icon-logout :size="18" aria-hidden="true" />
        </el-button>
        <el-button class="toolButton" text :aria-label="hasDesktopUpdate ? '设置，有新版本可用' : '设置'" title="设置" @click="emit('openSettings')">
          <el-badge isDot :hidden="!hasDesktopUpdate">
            <icon-settings :size="18" aria-hidden="true" />
          </el-badge>
        </el-button>
      </div>
    </el-card>
    <el-dialog v-model="exitVisible" title="退出项目" width="360px" alignCenter appendToBody>
      <span>是否退出当前项目并返回首页？</span>
      <template #footer>
        <el-button @click="exitVisible = false">取消</el-button>
        <el-button type="primary" :loading="leaving" @click="exitProject">退出项目</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { IconLogout, IconSettings } from "@tabler/icons-vue";
import { hasDesktopUpdate } from "@/stores/desktopUpdate";

const emit = defineEmits<{ openSettings: [] }>();
const router = useRouter();
const exitVisible = ref(false);
const leaving = ref(false);

async function exitProject() {
  if (leaving.value) return;
  leaving.value = true;
  try {
    const hostOrigin = URL.canParse(document.referrer) ? new URL(document.referrer).origin : "";
    if (window.parent !== window && ["http://127.0.0.1:5178", "http://localhost:5178", "http://127.0.0.1:6178"].includes(hostOrigin)) {
      // 由 Lum 主界面保存画布和写作内容后统一导航，避免落入画布模块的独立首页。
      window.parent.postMessage({ type: "lum:home" }, hostOrigin);
      exitVisible.value = false;
      return;
    }
    await router.push("/home");
  } finally {
    leaving.value = false;
  }
}
</script>

<style scoped lang="scss">
.workspaceMenu {
  .menuContent {
    display: flex;
    align-items: center;
    gap: 2px;

    .toolButton {
      width: 28px;
      height: 28px;
      margin: 0;
      padding: 0;
    }
  }
}
</style>
