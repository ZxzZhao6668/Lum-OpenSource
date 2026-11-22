# 在 Lum 画布中配置 APIMart

APIMart 适配器用于图片和视频生成。先准备自己的 APIMart API Key。打开画布的 **设置 → 媒体模型**，在已安装的 **APIMart** 卡片上点 **编辑模型**。

1. 在 **API Key** 中填入密钥。
2. 在 **请求地区** 填 `1` 使用国内线路，或填 `2` 使用海外线路。默认值为 `1`。
3. 点 **保存**。回到画布，在图片生成或视频生成节点中选用 APIMart 提供的相应模型。

可用模型、支持的参考素材和视频时长见[适配器实现](../vendor/lum/packages/providers/src/media/apiMart.ts)。
