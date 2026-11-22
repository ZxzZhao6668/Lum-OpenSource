# 开发与扩展指南

[返回 Lum 首页](https://github.com/ZxzZhao6668/Lum-OpenSource) · [文档目录](./readme.md) · [贡献指南](../CONTRIBUTING.md)

本文收录插件开发、源码运行、桌面打包和更新发布的详细说明。首次参与开发，可先阅读贡献指南。

## 🧩 插件与模型扩展

在“设置 → 插件市场”浏览、安装和管理节点、工具与技能。[市场目录与投稿指南](../../../marketplace/README.md)列出了支持的格式、投稿步骤和更新方式。

| 扩展类型 | 用途 | 开发入口 |
| --- | --- | --- |
| 节点 | 为画布增加交互组件、输入输出端口与节点操作。 | [节点脚手架](../packages/nodeScaffold/readme.md) · [内置节点](../packages/nodes/) |
| 工具 | 为 Agent 增加工作区操作、搜索、媒体生成等能力，可附带交互 UI。 | [工具脚手架](../packages/toolScaffold/readme.md) · [内置工具](../packages/tools/) |
| 技能 | 用 `SKILL.md` 和附属资料描述创作流程、方法与操作约定。 | [内置技能](../packages/skills/) |
| 提供方 | 适配不同平台的模型列表、请求参数和媒体返回结果。 | [提供方实现](../packages/providers/src/) |

节点与工具的配置表单统一使用 `@form-create/element-ui` 的规则；有必填项未填写时，配置按钮会显示红点。工具只接收自身配置，宿主不向工具直接传递完整应用设置。

媒体接口包含图片、视频和音频的扩展类型，实际能力由各提供方实现。技能既可以全局安装，也可以放在当前工作区的 `skill/` 目录，同名时优先使用工作区版本。

需要从外部 Coding 工具操作 Lum 时，在“设置 → MCP”开启服务并复制客户端配置，支持 HTTP 与 stdio 连接。画布和节点等界面操作需要保持 Lum 窗口或网页打开，详见 [MCP 接入说明](../packages/mcp/README.md)。

<details>
<summary><strong>通过网页唤起桌面安装插件</strong></summary>

安装桌面客户端后，网页可通过 `lum://install` 请求安装插件。应用会先展示类型、文件名和下载地址，用户确认后再下载与安装。

```ts
const link = new URL("lum://install");
link.searchParams.set("type", "node");
link.searchParams.set("url", "https://example.com/plugins/exampleNode.umd.js");
window.location.href = link.href;
```

| `type` | 文件格式 | 安装位置 |
| --- | --- | --- |
| `node` | `.umd.js` | `data/nodes/` |
| `tool` | `.tool.js` | `data/tools/` |
| `skill` | `SKILL.md`、`.zip`、`.tar`、`.tar.gz`、`.tgz` | `data/skills/<name>/` |
| `provider` | 媒体提供方 `.ts` | `data/providers/` |

下载地址须为 HTTP/HTTPS，文件名来自 URL 路径。同名节点、工具和技能在版本更高时允许更新；覆盖同版本或降级需在开发者选项中使用强制安装，提供方不覆盖同名项。

普通插件与技能包最多 20 MB，技能解压后也受此限制；提供方最多 2 MB。技能包支持 ZIP 和 TAR，须包含带有 `name`、`description` frontmatter 的 `SKILL.md`，附属资源放在其所在目录内。TAR 包使用普通 USTAR 格式，不包含链接及 PAX/GNU 扩展条目。

Windows 安装器负责注册协议；macOS 需要将应用放入 `/Applications` 或 `~/Applications`。普通浏览器开发模式不注册桌面协议。

</details>

---

## 🛠️ 开发与构建

前端、业务服务和桌面端在同一个 Bun Workspaces 仓库中维护。

| 层级 | 技术 |
| --- | --- |
| 运行时与包管理 | Bun 1.4.3、Bun Workspaces |
| 前端 | Vue 3、Vite、TypeScript、Pinia、Element Plus、Vue Flow |
| 服务端 | Bun、Express 5、Zod |
| Agent | Pi Agent SDK、工具插件、Markdown 技能与记忆 |
| 桌面 | Electrobun；Windows 使用 WebView2 和 NSIS 安装器 |
| 3D 与媒体 | Three.js、FFmpeg、可扩展的媒体提供方 |

### 本地开发

先安装 Git 和项目指定版本的 [Bun](https://bun.sh/)，然后执行：

```sh
git clone https://github.com/ZxzZhao6668/Lum-OpenSource.git
cd Lum-OpenSource/vendor/lum
bun install

# 首次开发或修改插件后，构建节点和工具并同步到 data/
bun run dev:plugins

# 同时启动 Web 与业务 Server
bun run dev
```

打开 `http://localhost:5173`。独立 Server 默认监听 `3000`，Web 开发服务会代理 API 请求。`dev` 不会自动构建或同步插件，因此首次启动需要上面的 `dev:plugins` 步骤。

### 常用命令

以下命令在画布工作区 `vendor/lum/` 执行：

| 命令 | 用途 |
| --- | --- |
| `bun run dev:web` | 单独启动 Web 开发服务。 |
| `bun run dev:server` | 单独启动业务 Server。 |
| `bun run dev:plugins` | 构建节点和工具，并同步到开发数据目录。 |
| `bun run dev:desktop` | 同步开发插件、构建 Web，并启动桌面应用。 |
| `bun run build` | 构建工具、Web、Server、MCP，并输出技能和提供方文件。 |
| `bun run build:server` | 构建独立部署所需的节点、工具、Web、Server、MCP、技能和提供方，支持 Linux。 |
| `bun run build:nodes` | 构建节点到 `build/nodes/`，不写入 `data/nodes/`。 |
| `bun run build:tools` | 构建工具到 `build/tools/`，不写入 `data/tools/`。 |
| `bun run start:server` | 运行 `build/server/` 中已构建的服务。 |
| `bun run build:desktop` | 构建当前平台的桌面应用及随包资源。 |
| `bun run package:desktop` | 生成当前平台的 Windows NSIS 安装包或 macOS DMG。 |
| `bun run release:desktop <版本号> --auto` | 生成当前平台安装包、完整更新包，并在存在上一版时生成 patch。 |
| `bun run typecheck` | 单独执行各工作区的类型检查。 |
| `bun run --cwd packages/i18n extract` | 手动抽取中文源文案和来源索引，不生成其他语言的译文。 |

构建与类型检查分别执行。新增、移动或删除业务接口后，在 `apps/server` 执行 `bun run routes` 生成路由。

### 云端渠道

插件市场从 [Lum 市场目录](../../../marketplace/README.md) 读取插件元数据。首页广告的本地入口是 `GET /api/channel/community/getAdvertisements`，接口和实现可在[渠道源码](../apps/server/src/utils/channel/)中查看。

### 多语言维护

语言字典与翻译运行时集中在 [`packages/i18n`](../packages/i18n/readme.md)。Web 的明确展示位置由 Vite 插件在编译时转换，业务源码可继续使用中文；动态文案使用 `t` / `msg` 标签模板。服务端使用请求语言上下文，避免并发请求之间串语言。

修改中文文案后，手动执行上面的 `extract` 命令，再补齐 `packages/i18n/src/locales/` 中各语言的同名键，保留占位符。开发启动和构建不会自动抽取，也不会自动生成译文。翻译仅用于显示，不改变用户数据、模型正文或业务判断值；供应商、tools、nodes、节点脚手架子包及安装器不在翻译范围内。具体用法、语言回退规则和验证记录见[多语言维护说明](../packages/i18n/readme.md)。

<details>
<summary><strong>在本机运行构建后的 Web 与 Server</strong></summary>

首次从源码运行，完成依赖安装后执行：

```sh
bun run build:server
bun run start:server
```

然后打开 `http://localhost:3000`。这套命令使用仓库根目录的默认 `data/`；服务首次启动会从构建产物初始化内置节点、工具、技能和提供方，保留已有插件文件。迁移到其他目录或机器时，需一并处理运行依赖、配置和工作区，不能只复制 `build/` 就视作完整安装。

独立 Server 采用单进程运行。桌面端复用同一个 `createApp`，在主进程监听系统分配的本机端口。目录选择、原生保存与桌面更新等接口仅由桌面宿主提供。

</details>

<details>
<summary><strong>桌面构建准备：Windows 与 macOS</strong></summary>

桌面脚本支持 Windows x64、macOS arm64 和 macOS x64，需要在对应系统与架构上构建。

**Windows x64**

使用 Electrobun 2.0.1。打包需要 NSIS，默认查找 `C:/Program Files (x86)/NSIS/makensis.exe`，可通过 `NSIS_PATH` 指定路径。首次打包会下载并验证微软 WebView2 引导程序。

```sh
bun run build:desktop
bun run package:desktop
```

安装包输出到 `build/desktop/artifacts/lum-<版本>-Setup.exe`。

**macOS**

先安装 Xcode Command Line Tools。Apple Silicon 使用 Electrobun 2.0.1；Intel Mac 使用 `compat/macIntel/` 中的 Electrobun 1.18.1 兼容构建，需先准备其依赖：

```sh
# 仅 Intel Mac 需要
cd compat/macIntel
bun install --frozen-lockfile
cd ../..
```

在对应架构的 Mac 上生成原生启动库，然后构建：

```sh
bun packages/startup/scripts/buildMac.ts
bun run build:desktop
bun run package:desktop
```

启动库脚本会下载固定版本的 ThorVG 源码并校验摘要。产物分别位于 `build/desktop/artifacts/macArm64/` 和 `build/desktop/artifacts/macX64/`。

本机默认生成未做 Developer ID 签名与公证的测试包。对于自己构建且确认来源的测试应用，若被隔离属性拦截，可仅移除该应用的隔离属性，路径按实际位置调整：

```sh
xattr -dr com.apple.quarantine "/Applications/lum.app"
```

**类型检查与 SDK**

若 Windows x64 或 Apple Silicon 在首次构建前单独进行类型检查，先准备 Electrobun SDK：

```sh
bun apps/desktop/node_modules/electrobun/bin/electrobun.cjs prepare
bun run typecheck
```

Intel Mac 在安装兼容 SDK 后，先运行桌面开发或构建命令生成适配文件。类型检查不会隐式安装依赖或编译原生库。

</details>

<details>
<summary><strong>发布、更新与插件同步</strong></summary>

正式版本和可下载的附件见 [Lum Releases](https://github.com/ZxzZhao6668/Lum-OpenSource/releases)。完整的影纪 Windows 桌面版使用[桌面构建说明](../../../desktop/readme.md)中的脚本。下面的命令仅适用于 `vendor/lum/` 的独立画布客户端。

画布客户端通过本仓库的 GitHub Releases 获取更新。开发者也可在设置中指定自定义更新目录。

**Windows 代码签名**

Windows 安装器和自有辅助 EXE 会写入产品、发布者与当前构建版本信息。默认没有签名证书，构建会明确提示产物未签名；版本信息不能代替数字签名，也不代表已通过 Defender 检测。

在有代码签名证书及匹配私钥的 Windows 构建机上，将证书安装到当前用户的 `My` 证书库，安装 Windows SDK 的 SignTool，并在执行现有打包命令前设置：

```powershell
$env:windowsSigningThumbprint = '证书的40位十六进制指纹'
$env:windowsSignToolPath = 'C:\Program Files (x86)\Windows Kits\10\bin\实际SDK版本\x64\signtool.exe'
bun run package:desktop
```

SignTool 已在 PATH 时可省略 `windowsSignToolPath`；指定路径时必须使用绝对路径，避免不同构建阶段的工作目录影响工具选择。未设置 `windowsSigningThumbprint` 才会跳过签名，显式空字符串、空白或无效指纹均报错。签名采用 SHA-256 与 RFC 3161 时间戳，默认使用 `http://timestamp.digicert.com`，可通过 `windowsSigningTimestampUrl` 指定证书服务商的时间戳地址。私钥保留在证书库或提供商的硬件中，不向脚本传递证书密码。

四个自有启动、协议、保存与更新辅助程序在 SDK 生成更新归档、Hash 和补丁前完成签名；安装检测程序、NSIS 内嵌卸载器和最终安装包也会签名并验证。NSIS 打包使用归档中的更新助手，并校验归档内四个辅助程序的版本；启用签名时还校验其签名、证书指纹和时间戳，不能用未签名旧归档只重签外壳。第三方文件保留其原有签名。配置了证书指纹后，证书、时间戳或签名验证失败均中止打包，不回退为未签名产物；最终 EXE 在暂存目录完成签名后才替换产物，失败不覆盖已有安装包。

签名接入与编译通过不等于误报已解除。Defender 已检测的原始文件需结合保护历史记录复核，必要时通过 [Microsoft Security Intelligence](https://www.microsoft.com/en-us/wdsi/filesubmission) 以软件开发者身份提交分析。

**macOS 签名与公证**

如需在自己的工作流中签名，可参阅 [GitHub 的 Xcode 签名说明](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications)。从浏览器下载应用后的安全提示见 [Apple 安全打开应用说明](https://support.apple.com/en-us/102445)。

**本机打包与独立更新服务**

独立更新服务与业务 Server 分开运行，默认地址为 `http://127.0.0.1:8091`。其配置、部署与发布规则见 [更新服务说明](../apps/updateServer/readme.md)。

```sh
bun run start:updateServer

# 本机仅构建当前系统与架构；自动判断是否已有上一版
bun run release:desktop 2.0.0 --auto
bun run publish:update build/desktop/releases/2.0.0

# 服务器保留上一版时，构建并发布下一版本
bun run release:desktop 2.0.1
bun run publish:update build/desktop/releases/2.0.1
```

Mac 发布目录增加 `macX64/` 或 `macArm64/`，例如 `build/desktop/releases/macArm64/2.0.1`。所有 release 模式都会生成安装包；`--auto` 自动判断基线，不带选项要求已有上一版，`--initial` 跳过基线检查且不生成 patch。同一平台、架构和版本不能重复生成快照。普通 `build:desktop`、`package:desktop` 不访问更新服务器。

桌面用户可在“设置 → 关于”检查更新、下载并重启应用。Windows 更新交换程序目录，保留 `data/` 和 `WebView2/`；卸载时也默认保留这些数据，选择“同时删除用户数据”才会一并清理。

内置节点与工具按构建 hash 同步：升级或降级后首次启动会替换同名内置插件；Windows 同版本重装也会触发同步。普通重启不重复覆盖。技能和提供方按首次初始化规则处理，保留已有文件；第三方插件和用户素材不随内置节点、工具的同步被覆盖。

</details>

### 项目结构

```text
apps/
  web/                 Vue 页面、设置、工作区与画布
  server/              业务接口与 Agent 运行时，桌面共享此服务
  desktop/             Electrobun 入口、构建脚本与安装器
  updateServer/        独立更新文件服务器与发布脚本
packages/
  assets/              共享图片与图标
  i18n/                多语言字典、运行时与文案抽取
  nodes/               内置画布节点
  nodeScaffold/        节点开发脚手架与运行时
  tools/               Agent 工具插件
  toolScaffold/        工具开发脚手架与运行时
  providers/           文本与媒体模型提供方
  skills/              Markdown 技能及附属资料
  mcp/                 MCP 服务与协议适配
  ffmpeg/              FFmpeg 能力
  startup/             原生启动窗口与动画
docs/                  项目介绍译版、开发文档与图片
compat/macIntel/       Intel Mac 兼容构建
build/                 构建产物
data/                  本机运行数据，不提交到仓库
```

---
