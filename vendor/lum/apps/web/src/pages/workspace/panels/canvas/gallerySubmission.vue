<template>
  <section class="submission" aria-label="作品投稿">
    <p>提交到 GitHub 后，作品文件、随作品附上的媒体和投稿账户即公开可见。维护者合并 Pull Request 后，作品会出现在分享区。</p>
    <details>
      <summary>用 GitHub 令牌投稿</summary>
      <form class="fields" @submit.prevent="submit">
        <label>本次投稿令牌
          <el-input v-model="token" type="password" autocomplete="off" spellcheck="false" :disabled="busy" placeholder="GitHub personal access token" />
        </label>
        <p>令牌仅在本次投稿时发给 api.github.com。仓库成员可用具有 Contents 和 Pull requests 写权限的令牌。外部投稿者可用 classic 令牌的 public_repo 权限，或直接使用下方浏览器投稿。</p>
        <el-button type="primary" native-type="submit" :loading="busy" :disabled="!token.trim() || !!pullUrl">提交作品并申请审核</el-button>
      </form>
    </details>
    <details>
      <summary>在浏览器中手动投稿</summary>
      <ol class="instructions">
        <li><el-button size="small" @click="download">下载投稿 JSON</el-button>，保留下载时的文件名。</li>
        <li><a :href="repoUrl + '/fork'" target="_blank" rel="noopener noreferrer">在 GitHub 创建自己的 fork</a>，已有 fork 可直接使用。输入你的 fork 仓库名。
          <el-input v-model="manualRepo" placeholder="你的用户名/Lum-OpenSource" aria-label="你的 GitHub fork 仓库" autocomplete="off" />
        </li>
        <li><a v-if="urls" :href="urls.upload" target="_blank" rel="noopener noreferrer">打开 fork 的作品目录并上传文件</a><span v-else>在 fork 的 canvas-gallery/works 目录上传文件</span>。提交时选“创建新分支”，分支名填 <code>{{ prepared.branch }}</code>。</li>
        <li><a v-if="urls" :href="urls.compare" target="_blank" rel="noopener noreferrer">核对改动并创建 Pull Request</a><span v-else>向原仓库的 main 分支创建 Pull Request</span>，核对改动只有本次作品。</li>
      </ol>
    </details>
    <p v-if="status" role="status">{{ status }}</p>
    <p v-if="error" class="errorText" role="alert">{{ error }}</p>
    <a v-if="pullUrl" :href="pullUrl" target="_blank" rel="noopener noreferrer">查看审核请求</a>
    <a v-else-if="compareUrl" :href="compareUrl" target="_blank" rel="noopener noreferrer">在 GitHub 核对已上传文件并继续投稿</a>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import saveFile from "@/lib/saveFile";
import type { GalleryCanvas } from "./galleryCanvas";
import { galleryRepository, manualGalleryUrls, prepareGallerySubmission, submitGalleryWork } from "./galleryGithub";

const props = defineProps<{ work: GalleryCanvas }>();
const repoUrl = "https://github.com/" + galleryRepository;
const prepared = computed(() => prepareGallerySubmission(props.work));
const token = ref("");
const manualRepo = ref("");
const urls = computed(() => manualGalleryUrls(manualRepo.value, prepared.value.branch));
const busy = ref(false);
const error = ref("");
const status = ref("");
const compareUrl = ref("");
const pullUrl = ref("");
let active: AbortController | undefined;

function reset() {
  active?.abort();
  active = undefined;
  busy.value = false;
  token.value = error.value = status.value = compareUrl.value = pullUrl.value = "";
}
watch(prepared, reset, { flush: "sync" });
onBeforeUnmount(reset);

async function download() {
  try {
    const file = prepared.value;
    await saveFile(new Blob([file.json], { type: "application/json" }), file.fileName);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "下载投稿文件失败。";
  }
}

async function submit() {
  if (busy.value || !token.value.trim() || pullUrl.value) return;
  const file = prepared.value;
  const credential = token.value.trim();
  token.value = error.value = "";
  busy.value = true;
  const controller = new AbortController();
  active = controller;
  try {
    const url = await submitGalleryWork(file, credential, controller.signal, message => {
      if (active === controller) status.value = message;
    }, url => {
      if (active === controller) compareUrl.value = url;
    });
    if (active === controller) {
      pullUrl.value = url;
      status.value = "审核请求已提交，合并后作品会出现在分享区。";
    }
  } catch (cause) {
    if (active === controller) {
      status.value = "";
      error.value = cause instanceof Error && !(cause instanceof TypeError) ? cause.message : "无法连接 GitHub。可重新输入令牌重试，或在浏览器中投稿。";
    }
  } finally {
    if (active === controller) {
      active = undefined;
      busy.value = false;
    }
  }
}
</script>

<style scoped lang="scss">
.submission {
  display: grid; gap: 10px; line-height: 1.5; overflow-wrap: anywhere;
  p { margin: 0; font-size: 13px; }
  a { color: var(--el-color-primary); }
  details { border-top: 1px solid var(--el-border-color-lighter); padding-top: 8px; }
  summary { cursor: pointer; font-weight: 600; }
  .fields { display: grid; justify-items: start; gap: 8px; margin-top: 8px; }
  label { display: grid; gap: 4px; width: 100%; }
  .instructions { display: grid; gap: 8px; padding-inline-start: 22px; margin: 8px 0; }
  .errorText { color: var(--el-color-danger); }
  code { user-select: all; }
}
</style>
