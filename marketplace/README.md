# Lum 插件市场

Lum 从 `ZxzZhao6668/Lum-OpenSource` 的 `main` 分支读取 `marketplace/catalog.json`，按条目中的路径取包并核对 SHA-256。随软件发布的市场目录包含当时收录的插件包，离线或无法访问仓库时仍可安装这些版本。

## 在 Lum 里制作插件和技能

在「设置 → 插件市场」点击「AI 插件开发」可制作单文件工具插件，点击「AI Skill 制作」可制作写作或工作流技能。选择已配置的文本模型，描述要解决的问题，生成后可以直接编辑，也可以选中一段内容让模型修改。核对源码后，下载文件或点击「安装到本机」，再到「已安装」查看。

工具使用 `.tool.js` 格式，在本机 Lum 服务中运行。技能使用 `SKILL.md`，可以在下载后按文末规则投稿。同名插件会提示修改标识；新建草稿不会覆盖已有版本。

市场包的许可与素材署名见[分发说明](packages/THIRD-PARTY-NOTICES.txt)。

## 投稿

1. 在仓库中创建分支，把可直接安装的文件放入 `marketplace/packages/`。文本文件使用 UTF-8 编码。
2. 编辑 [catalog.json](catalog.json)，在 `plugins` 数组内新增条目。可照着现有的 [剧本交稿校对](packages/scriptDeliveryReview.md) 核对技能的写法。每个插件保留一条当前版本记录。
3. 在仓库根目录按下文校验包的 SHA-256。把插件包与目录改动一并提交，向本仓库的 `main` 发起拉取请求，说明插件的用途、使用方法及本次变化。

| 类型 | 文件名示例 | 条目的 `name` |
| --- | --- | --- |
| `node` 节点 | `imageNode.umd.js` | `imageNode` |
| `tool` 工具 | `colorPicker.tool.js` | `colorPicker` |
| `skill` 技能 | `scriptDeliveryReview.md` | 与技能前言中的 `name` 相同 |
| `ext` 文件扩展 | `ext-image.umd.js` | `ext-image`，保留前缀 |

节点、工具、文件扩展提交 Lum 兼容的构建产物或导出文件。单文件技能直接提交采用 `SKILL.md` 格式的 Markdown。带资源的技能可提交 `.zip`、`.tar`、`.tar.gz` 或 `.tgz` 包。包内仅有一份 `SKILL.md`，其余资源放在该文件所在目录或子目录内。

## 填写目录

目录顶层的 `version` 是格式版本，当前为数字 `1`。每条插件记录使用以下字段。

| 字段 | 含义 |
| --- | --- |
| `type`、`name` | 插件类型及安装标识。同一插件更新时保留两者，大小写与包内标识一致。 |
| `displayName`、`description`、`author` | 用户可见的名称、用途和作者。 |
| `version` | 插件版本，使用完整语义化版本字符串，如 `"1.0.1"`。与包内版本一致。 |
| `file` | 相对 `marketplace/` 的包路径，如 `packages/scriptDeliveryReview.md`。用 `/` 分隔；各段以英文字母或数字开头，可含点、下划线和短横线。 |
| `sha256` | 包文件原始字节的 SHA-256，64 位小写十六进制字符串。 |
| `readme` | 可选，直接写入 Markdown 字符串，供用户查看详细用法。 |

技能前言需有 `name` 和 `description`，在 `metadata` 下填写 `version`、`displayName` 和 `author`。节点、工具、文件扩展保留对应产物的元数据，并同步其中的版本。

## 校验与发布更新

在仓库根目录的 PowerShell 中，以下命令输出可填入 `sha256` 的值。替换其中的包路径即可核算自己的文件。

```powershell
(Get-FileHash -Algorithm SHA256 -LiteralPath 'marketplace/packages/scriptDeliveryReview.md').Hash.ToLowerInvariant()
```

提交前可一次核对目录里的所有包。成功时会逐条打印插件名和版本；找不到文件或摘要不符时，命令会报告对应路径。

```powershell
$catalog = Get-Content -LiteralPath 'marketplace/catalog.json' -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($plugin in $catalog.plugins) {
    $packagePath = Join-Path 'marketplace' $plugin.file
    $digest = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
    if ($digest -cne $plugin.sha256) { throw "SHA-256 不一致：$packagePath" }
    Write-Output "$($plugin.name) $($plugin.version) OK"
}
```

发布更新时，先提高包内版本（如 `1.0.0` 升为 `1.0.1`），再更新原目录条目的 `version` 和 `sha256`。即使只改文案或换行，文件摘要也会变化。目录中的 [Git 属性](.gitattributes) 让 Git 按原始字节保存插件包。拉取请求合入 `main` 后，可在能访问仓库的 Lum 中刷新插件市场并安装新版。离线用户在收到包含新目录的软件版本后可获取新版。

## 在线与离线使用

默认市场来自公开仓库，无需登录即可浏览和下载。网络中断时，Lum 显示随当前版本分发的目录；恢复连接后点击「重试」即可重新读取 GitHub。
