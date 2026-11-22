# Lum Windows 桌面版

本目录为 Lum · 影纪的本地桌面壳、服务与安装包构建入口。界面保持现有写作、画布和三维预演实现。

## 使用

从 [GitHub Releases](https://github.com/ZxzZhao6668/Lum-OpenSource/releases/latest) 下载 Windows x64 的 `.exe` 文件，双击按向导安装。安装后可从桌面或开始菜单的“影纪Lum”快捷方式启动。

- 无边框窗口采用轻薄磨砂顶栏，顶部可拖动，右上角提供最小化、最大化/还原、全屏和关闭。F11 切换全屏，Esc 退出全屏。
- 启动时先在桌面显示透明 Logo，再进入主窗口。首页视频独立于界面动效开关，可单独暂停或恢复并记住选择。
- 关闭窗口时显示随主题变化的半透明磨砂确认框，Esc 或“继续创作”返回；未保存内容仍受保存保护。
- 首页“写作”进入项目导航；“无限画布”进入自由画布。
- AI 使用自己配置的 API。在设置中配置供应商、模型与密钥；订阅额度不会自动转换成 API 额度。
- 软件数据位于 `%APPDATA%\Lum`：写作浏览器存储与画布 `data` 均在此目录。卸载默认保留此目录；请定期使用项目备份功能备份重要内容。
- 原开发版浏览器中的项目和密钥不会自动迁入桌面版。可在原版导出项目备份，再到桌面版导入；API 配置需自行填写。
- 安装包包含 Blender、FFmpeg、FFprobe 和 Bun，不要求安装开发环境。模型生成仍需要网络和有效 API 配置。
- 当前安装包未配置代码签名证书，Windows 可能显示“未知发布者”。

## 构建

需要 Windows x64、Node.js 和 Bun。在解压后的源码根目录执行：

```powershell
corepack pnpm --dir app install --frozen-lockfile
bun install --cwd vendor/lum --frozen-lockfile
npm ci --prefix desktop

# 指向本机已准备好的运行组件；FFmpeg 路径为包含 bin/ 的解压根目录。
$env:LUM_BLENDER_ROOT = 'C:\tools\blender'
$env:LUM_MEDIA_TOOLS = 'C:\tools\ffmpeg'
# 若 Bun 不在 PATH，可设置 LUM_BUN_PATH 为 bun.exe 的完整路径。

Set-Location desktop
npm run prepare:app
npm run dist -- --config.directories.output='C:\LumBuild'
```

首次构建不使用 `--reuse-plugins`。该选项仅供插件已全部构建且未变化时重建宿主。`out/writing` 是构建目录，每次准备会清理并重建。

写作端使用随包 `app/pnpm-lock.yaml`；画布使用 `vendor/lum/bun.lock`；桌面使用 `desktop/package-lock.json`。本次交付以 Node 22.20.0 和 pnpm 10.20.0 安装写作依赖，保留这些锁文件以复现版本。请勿把整个 `src/**/runtime` 目录当作运行数据删除；`apps/server/src/agent/runtime` 是必需源文件。

调试启动：`npm start`。独立运行目录由 `npm run pack` 生成。可用 `LUM_USER_DATA_DIR` 指定独立验收数据目录，避免触碰正式数据；用 `LUM_DEBUG_STARTUP=1` 记录本地页面资源加载状态。

宿主监听回环端口 6178，画布服务监听 6181，使用每次启动随机生成的会话凭据。端口被占用时会提示错误并停止本实例。日志为 `%APPDATA%\Lum\logs\desktop.log`。

## 源码与保护边界

后端编译为本地 EXE，前端和宿主使用压缩后的生产文件，安装包不附开发源码目录或 sourcemap。Electron 开启沙箱、上下文隔离和 ASAR 完整性检查，关闭 Node 启动/调试入口。技能和供应商扩展保留其可导入、可编辑的使用方式。

保留各组件随附的 LICENSE/NOTICE：Toonflow（MIT）、Electron、Bun、Blender 与 FFmpeg 各自遵循其开源许可。Blender 许可位于安装目录 `resources/payload/blender/license`，FFmpeg 许可位于 `resources/payload/mediaTools/LICENSE`。
