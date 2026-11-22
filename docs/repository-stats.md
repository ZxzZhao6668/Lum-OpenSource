# Lum 仓库统计

Lum 不采集或上报软件内使用数据，也不生成用于统计的安装或会话标识。项目维护者只查看 GitHub 提供的仓库流量和发布文件下载次数。

## 仓库访问与克隆

登录有推送权限的 GitHub 账号，进入仓库的 **Insights → Traffic**。页面提供最近 14 天的浏览量、独立访客数、完整克隆次数和独立克隆者数，也可查看访问来源和热门页面。数据按 UTC 日期展示。[打开 Lum 的 Traffic 页面](https://github.com/ZxzZhao6668/Lum-OpenSource/graphs/traffic) · [GitHub 流量统计说明](https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/viewing-traffic-to-a-repository)

## 发布文件下载

在 Releases 找到目标版本，记下版本标签和发布附件的文件名。在 GitHub 的发布 API 返回结果中找到对应的 `tag_name`，再按 `assets[].name` 找到文件，读取该附件的 `download_count`。每个附件单独计数，同一人可以重复下载，因此这些数字无法用来推算独立安装数或软件活跃用户数。[Lum 发布版本](https://github.com/ZxzZhao6668/Lum-OpenSource/releases) · [Lum 发布 API](https://api.github.com/repos/ZxzZhao6668/Lum-OpenSource/releases) · [GitHub 发布附件字段说明](https://docs.github.com/en/rest/releases/assets)
