# 动作数据来源

插件内置12段CMU动作捕捉的白模重定向版本。原始记录来自 Carnegie Mellon University Graphics Lab；BVH采用 Bruce Hahne 的 cgspeed MotionBuilder 2010 转换。

- 数据与现行使用条款：https://mocap.cs.cmu.edu/
- 转换与下载入口：https://sites.google.com/a/cgspeed.com/cgspeed/motion-capture/the-motionbuilder-friendly-bvh-conversion-release-of-cmus-motion-capture-database
- 动作索引：https://sites.google.com/a/cgspeed.com/cgspeed/motion-capture/the-motionbuilder-friendly-bvh-conversion-release-of-cmus-motion-capture-database/bvh-conversion-release-motions-list

原始包通过转换作者提供的MediaFire链接取得，保存于工作区 runtime/motionLibrary/cmuPartOne.zip 和 cmuPartTwo.zip。只提取BVH数据，不安装或运行包内程序。

CMU允许在项目和商业产品中使用这些数据，但禁止将动作数据本身单独转售（包括转换格式）。cgspeed转换作者未增加额外限制。数据来源声明：

The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217.

本地转换：去除首帧T姿势，以其作为骨架校准；按白模骨架重定向世界旋转，移除水平根位移，保留纵向运动并作脚底纠正。较长采集截取前8–12秒。数据是预演用近似动作；不含手指动画、精确接触或物理求解。

内置采集编号：07_01自然行走、07_04慢走、09_01跑步、13_11跳跃、02_05出拳、02_06弯腰、02_07挥剑、13_01坐下起身、13_09喝水、13_27挥手指引、13_14大笑、13_35上台阶。

重新转换入口：`bun tools/convertCmuMotions.ts <BVH目录>`。输出src/previsMotions.json由运行时schema校验，并随插件离线安装；播放动作不调用模型API。
