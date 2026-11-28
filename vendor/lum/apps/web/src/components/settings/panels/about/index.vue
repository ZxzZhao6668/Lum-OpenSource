<template>
  <div class="about">
    <div class="brand">
      <div class="brandMark"><img class="brandLogo" :src="logoUrl" alt="Lum 影纪 Logo" /></div>
      <div class="brandInfo">
        <h3>Lum · 影纪</h3>
        <div class="brandMeta">
          <span v-if="currentVersion">v{{ currentVersion }}</span>
          <el-tag v-if="!embeddedDesktop && (clientBuild?.channel || snapshot?.channel)" type="info" size="small" round>{{ clientBuild?.channel || snapshot?.channel }}</el-tag>
        </div>
      </div>
    </div>

    <el-card v-if="installerState" class="infoCard updateCard" shadow="never">
      <div class="cardHeader">
        <div class="cardLabel">
          <icon-refresh :size="18" aria-hidden="true" />
          <span>版本更新</span>
        </div>
        <div class="updateActions installerActions">
          <el-button size="small" :type="installerState.status === 'idle' ? 'primary' : undefined" :loading="installerChecking" :disabled="installerBusy" @click="runInstallerUpdate('check')">
            检查更新
          </el-button>
          <el-button v-if="installerState.status === 'available' || installerDownloading" size="small" type="primary" :loading="installerDownloading" :disabled="installerBusy" @click="runInstallerUpdate('download')">
            下载安装包
          </el-button>
          <el-button v-if="installerState.status === 'ready'" size="small" type="primary" :loading="installerAction === 'install'" :disabled="installerBusy" @click="runInstallerUpdate('install')">
            重启安装
          </el-button>
        </div>
      </div>
      <dl v-if="installerState.latestVersion" class="installerVersions">
        <div><dt>当前版本</dt><dd>v{{ installerState.currentVersion }}</dd></div>
        <div><dt>最新版本</dt><dd>v{{ installerState.latestVersion }}</dd></div>
      </dl>
      <p v-if="installerStatusText" class="installerStatus" role="status">{{ installerStatusText }}</p>
      <div v-if="installerDownloading" class="installerProgress">
        <p v-if="installerState.status === 'downloading'">
          已下载 {{ formatBytes(installerState.received) }}<template v-if="installerState.total"> / {{ formatBytes(installerState.total) }}</template>
        </p>
        <el-progress
          v-if="installerState.status === 'downloading' && installerState.total > 0"
          :percentage="installerPercentage"
          aria-label="安装包下载进度" />
      </div>
      <p v-if="installerError" class="installerError" role="alert">{{ installerError }}</p>
      <details v-if="installerState.notes" class="installerNotes" open>
        <summary>更新说明</summary>
        <p tabindex="0">{{ installerState.notes }}</p>
      </details>
      <el-button class="installerReleaseLink" tag="a" size="small" plain :href="releasesUrl" target="_blank" rel="noopener noreferrer">
        查看 GitHub 发布版本
      </el-button>
    </el-card>

    <el-card v-else-if="embeddedDesktop || isMobile || !isRemoteConnection" class="infoCard updateCard" shadow="never">
      <div class="cardHeader">
        <div class="updateCopy">
          <div class="cardLabel">
            <icon-refresh :size="18" aria-hidden="true" />
            <span>版本更新</span>
          </div>
        </div>
        <div class="updateActions">
          <el-button v-if="embeddedDesktop || isMobile || !isLocalDesktop" tag="a" size="small" type="primary" plain :href="releasesUrl" target="_blank" rel="noopener noreferrer">
            查看 GitHub 发布版本
          </el-button>
          <template v-else>
            <el-select v-if="customUpdateUrl" :modelValue="updateSource" aria-label="更新源" size="small" :disabled="working || sourceSaving" @change="saveUpdateSource">
              <template #prefix>
                <icon-brand-github v-if="updateSource === 'github'" :size="14" aria-hidden="true" />
                <icon-world v-else :size="14" aria-hidden="true" />
              </template>
              <el-option label="Lum GitHub" value="github" />
              <el-option label="自定义源" value="custom" />
            </el-select>
            <el-badge isDot :hidden="!hasDesktopUpdate">
              <el-button size="small" type="primary" plain :loading="checking" :disabled="sourceSaving" @click="openUpdate">
                {{ snapshot?.installFailure ? "查看更新失败原因" : snapshot?.updateReady ? "更新已就绪" : snapshot?.updating || action === "download" ? "查看更新进度" : "检查更新" }}
              </el-button>
            </el-badge>
          </template>
        </div>
      </div>
      <div v-if="!embeddedDesktop && isLocalDesktop" class="autoUpdateSetting">
        <span>自动更新</span>
        <el-switch :modelValue="desktopAutoUpdate" size="small" :loading="autoUpdateSaving" :disabled="!actualPlatform.isLocalDesktop" aria-label="自动更新" @change="(value) => saveAutoUpdate(value === true)" />
      </div>
      <div v-if="!embeddedDesktop && !isMobile && snapshot?.hash" class="buildInfo">
        <span>构建标识</span>
        <code>{{ snapshot.hash }}</code>
      </div>
      <div v-if="!embeddedDesktop && !isMobile && snapshot?.installFailure" class="installFailureNotice" role="alert">
        <strong>上次更新未成功</strong>
        <p>{{ snapshot.installFailure.message }}</p>
        <p>请前往 GitHub 最新发布页，选择适合当前系统的完整安装包，关闭客户端后重新安装。</p>
        <el-button tag="a" type="primary" size="small" :href="releasesUrl" target="_blank" rel="noopener noreferrer">前往下载页</el-button>
      </div>
    </el-card>

    <el-card class="infoCard repositoryCard" shadow="never">
      <a class="repositoryLink" :href="repositoryUrl" target="_blank" rel="noopener noreferrer" aria-label="Lum GitHub 仓库">
        <icon-brand-github class="repositoryIcon" :size="22" aria-hidden="true" />
        <div class="repositoryInfo">
          <span class="repositoryTitle">Lum GitHub 仓库</span>
        </div>
        <icon-external-link class="externalIcon" :size="16" aria-hidden="true" />
      </a>
    </el-card>

    <el-card v-if="wechatContact" class="infoCard" shadow="never">
      <div class="cardHeader">
        <div class="cardLabel">
          <icon-brand-wechat :size="20" aria-hidden="true" />
          <span>微信交流群</span>
        </div>
        <el-popover trigger="click" placement="top" title="微信扫码联系入群" :width="224">
          <template #reference>
            <el-button size="small" :icon="IconQrcode">展示二维码</el-button>
          </template>
          <img class="contactCode" :src="wechatContact" alt="微信入群联系二维码" />
          <div class="tips">
            扫码添加微信，备注「Lum 入群」。
          </div>
        </el-popover>
      </div>
    </el-card>

    <el-card class="infoCard" shadow="never">
      <div class="cardHeader">
        <div class="cardLabel">
          <icon-shield-lock :size="20" aria-hidden="true" />
          <span>隐私</span>
        </div>
        <el-button size="small" aria-haspopup="dialog" @click="privacyVisible = true">查看</el-button>
      </div>
    </el-card>

    <section v-if="wechatContact" class="sponsorPanel" aria-label="赞助商">
      <h3 class="sponsorTitle">
        <icon-gift :size="20" aria-hidden="true" />
        赞助商
        <el-popover trigger="click" placement="top" title="微信扫码洽谈赞助合作" :width="224">
          <template #reference>
            <el-button class="sponsorContact" size="small" type="primary" link>成为赞助商</el-button>
          </template>
          <img class="contactCode" :src="wechatContact" alt="微信赞助联系二维码" />
        </el-popover>
      </h3>
    </section>

    <el-dialog v-model="privacyVisible" title="隐私" width="min(660px, calc(100vw - 32px))" alignCenter appendToBody destroyOnClose>
      <privacy />
    </el-dialog>

    <el-dialog v-model="resultVisible" title="版本更新" width="min(480px, 92vw)" alignCenter appendToBody>
      <div class="updateResult" aria-live="polite" :aria-busy="working">
        <div class="resultHeader">
          <span class="resultIcon" :class="{ warning: !!updateError, success: !working && !updateError && !snapshot?.updateAvailable }">
            <icon-refresh v-if="working" class="loadingIcon" :size="22" aria-hidden="true" />
            <icon-alert-circle v-else-if="updateError" :size="22" aria-hidden="true" />
            <icon-arrow-up-circle v-else-if="snapshot?.updateAvailable" :size="22" aria-hidden="true" />
            <icon-circle-check v-else :size="22" aria-hidden="true" />
          </span>
          <div class="resultCopy">
            <h3>{{ resultTitle }}</h3>
            <p>{{ resultMessage }}</p>
          </div>
        </div>
        <div
          v-if="!updateError && !snapshot?.installFailure && (action === 'download' || updateProgress || (snapshot?.updateReady && !updateInProgress))"
          class="updateProgress">
          <div v-if="updateInProgress" class="progressHeader">
            <span>{{ updateProgress?.phase === "preparing" ? "正在解压并校验更新包" : "下载进度" }}</span>
            <span v-if="updateProgress && (updateProgress.received > 0 || updateProgress.total)">
              {{ formatBytes(updateProgress.received) }}<template v-if="updateProgress.total"> / {{ formatBytes(updateProgress.total) }}</template>
            </span>
          </div>
          <el-progress
            v-if="updateProgress?.total || (!updateInProgress && snapshot?.updateReady)"
            :percentage="updatePercentage"
            :status="!updateInProgress && snapshot?.updateReady ? 'success' : undefined" />
        </div>
        <div v-if="!checking && !updateError && snapshot?.updateAvailable" class="releaseInfo">
          <div class="versionComparison">
            <div class="versionItem">
              <span>当前版本</span>
              <strong>v{{ currentVersion }}</strong>
            </div>
            <icon-arrow-right class="versionArrow" :size="18" aria-hidden="true" />
            <div class="versionItem latestVersion">
              <span>最新版本</span>
              <strong>v{{ snapshot.latestVersion }}</strong>
            </div>
          </div>
          <div v-if="snapshot.channel || snapshot.latestHash" class="releaseMeta">
            <el-tag v-if="snapshot.channel" type="info" size="small" round>{{ snapshot.channel }}</el-tag>
            <code v-if="snapshot.latestHash" :title="snapshot.latestHash">{{ snapshot.latestHash }}</code>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button size="small" @click="resultVisible = false">关闭</el-button>
        <el-button v-if="updateError && !snapshot?.installFailure && !updateInProgress" tag="a" size="small" :href="releasesUrl" target="_blank" rel="noopener noreferrer">前往下载页</el-button>
        <el-button v-if="snapshot?.installFailure" tag="a" type="primary" size="small" :href="releasesUrl" target="_blank" rel="noopener noreferrer">前往下载页</el-button>
        <el-button v-else-if="snapshot?.updating && !working" size="small" type="primary" @click="runUpdate('read')">重新读取状态</el-button>
        <el-button
          v-else-if="snapshot?.canUpdate && snapshot.updateAvailable"
          size="small"
          :type="snapshot.updateReady ? 'danger' : 'primary'"
          :loading="working"
          @click="runUpdate(snapshot.updateReady ? 'apply' : 'download')">
          {{ snapshot.updateReady ? "重启并更新" : "下载更新" }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { translate, t } from "@lum/i18n/vue";

import { computed, defineAsyncComponent, onMounted, onBeforeUnmount, ref } from "vue";
import axios from "axios";
import { ElMessage } from "element-plus";
import { actualPlatform, isMobile, isLocalDesktop, isRemoteConnection } from "@/lib/platform";
const wechatContact = import.meta.env.VITE_LUM_WECHAT_QR;
import {
  IconRefresh,
  IconBrandGithub,
  IconExternalLink,
  IconAlertCircle,
  IconArrowUpCircle,
  IconCircleCheck,
  IconArrowRight,
  IconGift,
  IconBrandWechat,
  IconQrcode,
} from "@tabler/icons-vue";
const logoUrl = "/brand/lumLogo.png";
import { saveSettings } from "@/stores/settings";
import {
  desktopAutoUpdate,
  desktopUpdateSource as updateSource,
  desktopUpdateCustomUrl as customUpdateUrl,
  desktopUpdateSnapshot as snapshot,
  desktopUpdateError as updateError,
  desktopUpdateAction as action,
  desktopUpdateChecking,
  hasDesktopUpdate,
  runDesktopUpdate,
  startDesktopUpdate,
} from "@/stores/desktopUpdate";
import { useInstallerUpdate } from "./installerUpdate";

const props = withDefaults(defineProps<{ visible?: boolean }>(), { visible: true });
const privacy = defineAsyncComponent(() => import("./privacy.vue"));
const repositoryUrl = import.meta.env.repositoryUrl!;
const releasesUrl = `${repositoryUrl}/releases`;
const clientBuild = ref<{ version: string; channel: string }>();
const {
  embeddedDesktop,
  snapshot: installerState,
  activeAction: installerAction,
  checking: installerChecking,
  downloading: installerDownloading,
  busy: installerBusy,
  error: installerError,
  run: runInstallerUpdate,
} = useInstallerUpdate(() => props.visible);
const currentVersion = computed(() => {
  if (embeddedDesktop) return installerState.value?.currentVersion || "";
  if (actualPlatform.isDesktop && actualPlatform.isRemoteConnection) return clientBuild.value?.version || "";
  return snapshot.value?.version || import.meta.env.appVersion;
});
const installerPercentage = computed(() => {
  const state = installerState.value;
  return state?.total ? Math.min(100, Math.floor(state.received / state.total * 100)) : 0;
});
const installerStatusText = computed(() => {
  if (installerAction.value === "install") return "正在准备重启安装…";
  if (installerChecking.value) return "正在检查更新…";
  if (installerDownloading.value) return installerPercentage.value === 100 ? "正在校验安装包…" : "正在下载安装包，可以继续创作。";
  if (installerError.value) return "";
  if (installerState.value?.status === "ready") return "安装包已通过校验，可以重启安装。";
  if (installerState.value?.status === "available") return "有新版本可用。";
  if (installerState.value?.status === "current") return "当前已是最新版本。";
  return "";
});
const sourceSaving = ref(false);
const autoUpdateSaving = ref(false);
const checking = computed(() => desktopUpdateChecking.value);
const working = computed(() => !!action.value);
const updateInProgress = computed(() => working.value || !!snapshot.value?.updating);
const updateProgress = computed(() => snapshot.value?.updateProgress);
const updatePercentage = computed(() => !updateInProgress.value && snapshot.value?.updateReady ? 100
  : updateProgress.value?.total ? Math.min(100, Math.floor(updateProgress.value.received / updateProgress.value.total * 100)) : 0);
const resultVisible = ref(false);
const privacyVisible = ref(false);
const controller = new AbortController();
const resultTitle = computed(() => {
  if (snapshot.value?.installFailure) return translate("上次更新未成功");
  if (updateError.value) return translate("更新未完成");
  if (checking.value) return translate("正在检查更新");
  if (action.value === "read") return translate("正在读取更新状态");
  if (action.value === "apply") return translate("正在重启并更新");
  if (working.value) return translate("正在准备更新");
  if (snapshot.value?.updateReady) return translate("更新已准备完成");
  return snapshot.value?.updateAvailable ? translate("发现新版本") : translate("暂无更新");
});
const resultMessage = computed(() => {
  if (snapshot.value?.installFailure) return snapshot.value.installFailure.message;
  if (updateError.value) return updateError.value;
  if (checking.value) return translate("正在获取最新版本信息…");
  if (action.value === "read") return translate("正在确认客户端的更新状态，请稍候…");
  if (action.value === "apply") return translate("客户端即将关闭，更新完成后会自动重新打开。");
  if (working.value) return translate("正在下载并校验更新包，可以关闭此弹窗继续使用。");
  if (snapshot.value?.updateReady) return translate("点击“重启并更新”安装新版本，请先完成正在进行的任务。");
  if (!snapshot.value?.updateAvailable) return t`当前已是最新版本 v${currentVersion.value}`;
  return snapshot.value.canUpdate ? translate("有新的版本可用，下载完成后可重启更新。") : translate("当前客户端不支持应用内更新，请下载安装包。");
});

onMounted(async () => {
  if (embeddedDesktop || !actualPlatform.isDesktop) return;
  try {
    if (actualPlatform.isRemoteConnection) {
      const { data } = await axios.get<{ data: { version: string; channel: string } }>("/api/desktop/update", { signal: controller.signal, timeout: 10000 });
      clientBuild.value = data.data;
      return;
    }
    await runDesktopUpdate("read");
  } catch {
    // ACT: 本机版本读取失败不阻塞关于页；远程页面的构建版本不冒充客户端版本。
  }
});
onBeforeUnmount(() => controller.abort());

function openUpdate() {
  resultVisible.value = true;
  if (working.value || snapshot.value?.updateReady || snapshot.value?.installFailure) return;
  void runUpdate("check");
}

async function saveUpdateSource(source: string) {
  if (actualPlatform.isRemoteConnection) return;
  if (source === updateSource.value || sourceSaving.value || working.value) return;
  if (source !== "github" && (source !== "custom" || !customUpdateUrl.value)) return;
  sourceSaving.value = true;
  try {
    await saveSettings(() => ({ desktopUpdateSource: source }));
  } catch (error) {
    ElMessage.error(getUpdateError(error));
  } finally {
    sourceSaving.value = false;
  }
}

async function saveAutoUpdate(enabled: boolean) {
  if (!actualPlatform.isLocalDesktop || autoUpdateSaving.value || enabled === desktopAutoUpdate.value) return;
  autoUpdateSaving.value = true;
  try {
    await saveSettings(() => ({ desktopAutoUpdate: enabled }));
    if (enabled) void startDesktopUpdate().catch(() => {});
  } catch (error) {
    ElMessage.error(getUpdateError(error));
  } finally {
    autoUpdateSaving.value = false;
  }
}

function getUpdateError(error: unknown) {
  return axios.isAxiosError<{ message?: string }>(error) ? error.response?.data?.message || error.message : String(error);
}

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

async function runUpdate(nextAction: "read" | "check" | "download" | "apply") {
  if (working.value || sourceSaving.value) return;
  updateError.value = "";
  try {
    await runDesktopUpdate(nextAction);
    if (snapshot.value?.channel === "dev") updateError.value = "开发版本不提供更新检查，请使用正式桌面客户端。";
  } catch {
    // 错误与交接状态由全局 Store 保留，关闭面板不取消更新观察。
  }
}
</script>

<style lang="scss" scoped>
.about {
  display: flex;
  flex-direction: column;
  gap: 12px;

  .brand {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 4px 0 12px;

    .brandMark {
      display: grid;
      place-items: center;
      flex-shrink: 0;
      width: 142px;
      height: 80px;
      border-radius: calc(var(--ui-radius) * 1.5);
      background: transparent;

      .brandLogo {
        width: 100%;
        height: 100%;
        border-radius: inherit;
        object-fit: contain;

        .dark & {
          filter: none;
        }
      }
    }

    .brandInfo {
      min-width: 0;

      h3 {
        margin: 0 0 8px;
        color: var(--el-text-color-primary);
        font-size: 20px;
        font-weight: 600;
      }

      .brandMeta {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        color: var(--el-text-color-secondary);
        font-size: 12px;
      }
    }
  }

  .infoCard {
    min-width: 0;
    border-radius: calc(var(--ui-radius) * 1);

    :deep(.el-card__body) {
      padding: 14px;
    }

    .cardHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;

      .cardLabel {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--el-text-color-primary);
        font-size: 14px;
        font-weight: 600;
      }
    }

    &.updateCard {
      .autoUpdateSetting {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-top: 8px;
        color: var(--el-text-color-primary);
        font-size: 13px;
      }

      .cardHeader {
        .updateCopy {
          flex: 1;
          min-width: 120px;

          .cardDescription {
            margin-top: 4px;
          }
        }

        .updateActions {
          display: flex;
          align-items: center;
          gap: 8px;

          a {
            text-decoration: none;
          }

          :deep(.el-select) {
            width: 120px;
          }
        }

        .installerActions {
          flex-wrap: wrap;

          :deep(.el-button + .el-button) {
            margin-left: 0;
          }
        }
      }

      .installerVersions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 24px;
        margin: 14px 0 0;
        font-size: 13px;

        div { display: flex; flex-wrap: wrap; gap: 6px; }
        dt { color: var(--el-text-color-secondary); }
        dd { margin: 0; font-weight: 600; }
      }

      .installerStatus,
      .installerProgress,
      .installerNotes {
        margin: 10px 0 0;
        color: var(--el-text-color-regular);
        font-size: 13px;
        line-height: 1.6;
      }

      .installerProgress p { margin: 0 0 6px; }
      .installerNotes summary { cursor: pointer; font-weight: 600; }
      .installerNotes p {
        max-height: 164px;
        margin: 4px 0 0;
        overflow: auto;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      .installerError {
        margin: 10px 0 0;
        color: var(--el-color-danger);
        font-size: 13px;
        line-height: 1.6;
      }

      .installerReleaseLink { margin: 12px 0 0; }
    }

    .buildInfo {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 8px 12px;
      margin-top: 12px;
      color: var(--el-text-color-secondary);
      font-size: 12px;

      code {
        overflow-wrap: anywhere;
      }
    }

    .installFailureNotice {
      margin-top: 14px;
      padding: 12px;
      border-radius: var(--ui-radius);
      background: var(--el-color-danger-light-9);

      strong { color: var(--el-color-danger); }
      p { margin: 8px 0 12px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
    }

    &.repositoryCard {
      transition: border-color 0.2s;

      :deep(.el-card__body) {
        padding: 0;
      }
      &:hover {
        border-color: var(--el-border-color-darker);
      }

      .repositoryLink {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px;
        color: var(--el-text-color-primary);
        text-decoration: none;

        &:focus-visible {
          outline: 2px solid var(--el-color-primary);
          outline-offset: -2px;
          border-radius: calc(var(--ui-radius) * 1);
        }

        .repositoryIcon,
        .externalIcon {
          flex-shrink: 0;
        }
        .externalIcon {
          color: var(--el-text-color-secondary);
        }

        .repositoryInfo {
          display: flex;
          flex: 1;
          flex-direction: column;
          gap: 6px;
          min-width: 0;

          .repositoryTitle {
            font-size: 14px;
            font-weight: 600;
          }
        }
      }
    }
  }

  .sponsorPanel {
    margin-top: 8px;
    min-width: 0;

    .sponsorTitle {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0 0 8px;
      color: var(--el-text-color-primary);
      font-size: 16px;
      font-weight: 600;

      .sponsorContact {
        margin-left: auto;
      }
    }

  }
}

.contactCode {
  display: block;
  width: 100%;
  height: auto;
}

.tips {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.7;
}

.updateResult {
  padding: 8px 0;

  .resultHeader {
    display: flex;
    align-items: flex-start;
    gap: 12px;

    .resultIcon {
      display: grid;
      place-items: center;
      flex-shrink: 0;
      width: 40px;
      height: 40px;
      border-radius: calc(var(--ui-radius) * 1.25);
      background: var(--el-color-primary-light-9);
      color: var(--el-color-primary);

      &.warning {
        background: var(--el-color-warning-light-9);
        color: var(--el-color-warning);
      }
      &.success {
        background: var(--el-color-success-light-9);
        color: var(--el-color-success);
      }
      .loadingIcon {
        animation: spin 1.2s linear infinite;
      }
    }

    .resultCopy {
      min-width: 0;

      h3 {
        margin: 0 0 6px;
        color: var(--el-text-color-primary);
        font-size: 15px;
        font-weight: 600;
      }
      p {
        margin: 0;
        color: var(--el-text-color-secondary);
        font-size: 13px;
        line-height: 1.6;
        overflow-wrap: anywhere;
      }
    }
  }

  .updateProgress {
    margin-top: 20px;

    .progressHeader {
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 8px;
      color: var(--el-text-color-secondary);
      font-size: 12px;
    }
  }

  .releaseInfo {
    margin-top: 20px;
    padding: 14px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: calc(var(--ui-radius) * 1);

    .versionComparison {
      display: flex;
      align-items: center;
      gap: 16px;

      .versionItem {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 8px;
        min-width: 0;

        span {
          color: var(--el-text-color-secondary);
          font-size: 12px;
        }
        strong {
          color: var(--el-text-color-primary);
          font-size: 18px;
          font-weight: 600;
          overflow-wrap: anywhere;
        }
        &.latestVersion strong {
          color: var(--el-color-primary);
        }
      }

      .versionArrow {
        flex-shrink: 0;
        color: var(--el-text-color-placeholder);
      }
    }

    .releaseMeta {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid var(--el-border-color-lighter);
      color: var(--el-text-color-secondary);
      font-size: 12px;

      code {
        overflow-wrap: anywhere;
      }
    }
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .updateResult .resultHeader .resultIcon .loadingIcon {
    animation: none;
  }
}
</style>
