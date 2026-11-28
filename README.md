# Lum · 影纪

Lum 把剧本写作、分镜和三维白模预演放在同一套创作工具中。写作者可以按章节组织场次与对白，导出交稿文档，也可以把文稿带入画布，安排人物、机位与拍摄。AI 功能使用创作者在设置中配置的模型与密钥。

[使用教程](docs/user-guide.md) · [反馈与联系](docs/contact.md) · [设备互联](docs/device-link.md) · [插件投稿](marketplace/README.md) · [画布作品库](canvas-gallery/README.md) · [仓库统计](docs/repository-stats.md)

## Windows 安装包

Lum 1.0.13 · Windows x64。可在画布左上角切换项目，也可在「设置 → 关于」检查更新、下载安装包并重启安装。

- [下载 1.0.13 安装包（GitHub）](https://github.com/ZxzZhao6668/Lum-OpenSource/releases/download/v1.0.13/Lum-Setup-1.0.13-x64.exe) · [查看版本说明](https://github.com/ZxzZhao6668/Lum-OpenSource/releases/tag/v1.0.13)

## 从源码运行

Windows 开发环境需要 Node.js、pnpm 和 Bun。画布工作区使用 Bun 1.4.3。克隆本仓库后，在根目录的 PowerShell 中执行以下命令。首次构建需要下载依赖。

```powershell
pnpm --dir app install --frozen-lockfile
pnpm --dir app run build
Set-Location vendor/lum
bun install --frozen-lockfile
Set-Location ../..
node tools/buildCanvas.mjs
.\启动Lum.cmd
```

启动器会打开写作首页。写作端默认使用本机 5178 端口，画布服务使用 5181 端口。首次启动后到设置中添加自己的模型供应商。Windows 桌面版的构建步骤、Blender 与 FFmpeg 的路径设置见 [桌面构建说明](desktop/readme.md)。

## 源码目录

| 目录 | 用途 |
| --- | --- |
| [app](app) | 写作编辑器、项目管理、文稿导出与画布入口 |
| [vendor/lum](vendor/lum) | 画布前端、本地服务、节点、工具与三维预演 |
| [desktop](desktop) | Windows 桌面程序及构建脚本 |
| [marketplace](marketplace) | 插件目录、插件包和投稿说明 |
| [skills](skills) | 随源码提供的创作技能及来源说明 |

开发者可在构建写作端时设置 `VITE_LUM_HOME_VIDEO` 和 `VITE_LUM_HOME_POSTER` 来指定自己的背景素材，在构建画布前端时设置 `VITE_LUM_WECHAT_QR` 来显示自己的联系二维码。值为可由前端访问的资源 URL。

## 开源许可与署名

Lum 自有代码使用 [MIT 许可证](LICENSE)。画布基于 HBAI-Ltd 的 Toonflow，保留[上游 MIT 许可证](vendor/lum/LICENSE)。创作技能涉及的上游作者与许可见 [LICENSES.txt](skills/cover-and-creative/LICENSES.txt) 和 [SOURCES.txt](skills/cover-and-creative/SOURCES.txt)。白模人物动作数据保留 Quaternius 的 CC0 来源说明。第三方依赖和素材各自适用其随附许可证。
