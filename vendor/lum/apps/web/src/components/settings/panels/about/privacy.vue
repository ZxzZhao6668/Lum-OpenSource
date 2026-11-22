<template>
  <div class="privacy">
    <p>Lum 不收集或上报软件使用数据。项目仅使用 GitHub 提供的仓库访问、克隆及发布文件下载统计。</p>
    <a :href="statsUrl" target="_blank" rel="noopener noreferrer">查看详情</a>
  </div>
</template>

<script setup lang="ts">
const statsUrl = `${import.meta.env.repositoryUrl}/blob/HEAD/docs/repository-stats.md`;
</script>

<style lang="scss" scoped>
.privacy {
  padding: 0 4px 8px;
  font-size: 14px;
  line-height: 1.6;

  p { margin: 0 0 12px; }
  a { color: var(--el-color-primary); }
}
</style>
