# 成就系统 PRD（当前 V1）

## 1. 文档信息
- 项目：liuliu-miniapp（微信小程序）
- 模块：足迹页 -> 成就
- 文档版本：v1.1
- 日期：2026-04-26
- 关联页面：
  - `miniprogram/pages/history/history.wxml`
  - `miniprogram/pages/history/history.js`
  - `miniprogram/pages/achievement-detail/*`

## 2. 背景与目标
足迹页已经有“纪念卡册 / 成就”两个模块。成就系统现在采用 V1 方案：云端统一计算，结果写入 `userAchievements`，前端只负责展示。

V1 目标：
- 在足迹页“成就”标签展示成就墙（已解锁 / 未解锁 / 进度）。
- 基于用户可见的单人和同行记录自动计算成就，无需用户手动操作。
- 将成就结果持久化到云数据库 `userAchievements`，前端通过 `listMyAchievements` 读取。
- 支持历史数据回算。成就快照缺失或规则数量变化时，云函数会重新计算并写入快照。

## 3. 范围定义
### 3.1 In Scope（V1）
- 成就列表展示（12 个成就）。
- 成就解锁判定（云端统一计算）。
- 成就进度展示（如 3/5、7/10）。
- 成就详情页与分享入口。
- 当前佩戴成就展示。
- 首次解锁反馈（前端本地缓存比对后轻提示）。
- 成就结果持久化到 `userAchievements`，支持跨端展示一致。
- 成就素材使用透明背景 PNG，并通过微信云存储 `cloud://fileID` 引用。

### 3.2 Out of Scope（V1 不做）
- 成就分享海报生成。
- 成就排行榜 / 社交比拼。
- 多级成就（铜银金）与隐藏成就。
- 后台可视化配置成就标题、描述、排序和图片资源。
- 服务端同步“新解锁已提示”状态。

## 4. 用户故事
- 作为普通用户，我希望看到哪些成就已经解锁，知道自己还差多少能解锁下一个。
- 作为连续使用用户，我希望过去的漫步记录能够自动回算成就，不需要重新打卡。
- 作为新用户，我希望第一次触发成就时有明确反馈，感受到成长。
- 作为多设备用户，我希望不同设备看到的成就结果一致。

## 5. 成就清单
当前 V1 使用 12 个成就，统一采用透明背景 PNG 版本：

1. `几何大师：解锁形状漫步`
2. `喵氏马拉松：单次漫步里程 >= 5 公里`
3. `我喵都不喵你：5 次漫步未上传图片`
4. `掌量世界：在 10 个不同地点进行漫步`
5. `猫步探春：解锁春季第一次漫步`
6. `猫步逐夏：解锁夏季第一次漫步`
7. `猫步踏秋：解锁秋季第一次漫步`
8. `猫步寻冬：解锁冬季第一次漫步`
9. `一起喵喵：完成第一次同行漫步`
10. `圆满喵周：连续 7 天坚持漫步`
11. `开罐有奖：每完成一次漫步按稳定 5% 概率掉落`
12. `给你点颜色喵：完成第一次色彩漫步`

## 6. 成就判定口径
统一口径：按“当前登录用户可见的历史记录”计算。云端回算时读取该用户的 `walkRecords` 和仍可见的 `teamWalkRooms`；前端展示数据来自 `listMyAchievements`。

### A1 几何大师
- 判定：存在至少 1 条已完成记录满足 `themeCategory` 或 `themeSnapshot.category` 包含“形状”。
- 进度：0/1。

### A2 喵氏马拉松
- 判定：存在至少 1 条已完成记录满足 `routeStats.distanceMeters >= 5000`。
- 进度：取最大单次里程，展示为 `当前米数/5000m`。

### A3 我喵都不喵你
- 判定：累计 5 次“无图片漫步”。
- 无图片定义：单人记录 `photoList` 为空，且 `missionAssetMap` 下各任务 `photoList` 均为空；同行记录以 `teamStats.photoCount` 判断。
- 进度：`count/5`。

### A4 掌量世界
- 判定：累计在 10 个不同地点完成漫步。
- 地点去重：优先用 `locationName.trim()`；若为空，回退到坐标四舍五入到 3 位小数形成 key。
- 进度：`distinctLocationCount/10`。

### A5-A8 四季首行
- 判定：存在至少 1 条已完成记录，且 `season` 或 `generationContext.season` 为对应季节。
- 季节以用户生成任务时选择值为准，不依赖系统日期。
- 老数据缺失季节字段时不强行回推。
- 进度：各 0/1。

### A9 一起喵喵
- 判定：存在至少 1 条 `recordType = team` 且 `status = finished` 的可见同行记录。
- 进度：0/1。

### A10 圆满喵周
- 判定：存在连续 7 个自然日均至少完成 1 次漫步。
- 单人漫步与同行漫步均计入，同一天多次只计 1 天。
- 以 `endedAt` 为主，无则回退 `createdAt`。
- 进度：历史最长连续天数 / 7。

### A11 开罐有奖
- 判定：每次完成漫步后，按基于记录唯一信息的稳定 5% 概率判定。
- 同一条记录在任意设备、任意时间下结果保持一致。
- 进度：0/1。

### A12 给你点颜色喵
- 判定：存在至少 1 条已完成记录满足 `themeCategory` 或 `themeSnapshot.category` 包含“色彩”。
- 进度：0/1。

## 7. 数据与状态设计
### 7.1 成就配置
当前成就规则的单一维护源在 `cloudfunctions/shared/achievement-runtime.js`。修改规则或图片 fileID 后，需要执行：

```bash
node scripts/sync_cloud_achievement_runtime.js
```

同步目标：
- `cloudfunctions/createWalk/achievement.js`
- `cloudfunctions/finishTeamWalk/achievement.js`
- `cloudfunctions/listMyAchievements/achievement.js`
- `cloudfunctions/deleteWalk/achievement.js`
- `cloudfunctions/deleteTeamWalk/achievement.js`

前端 `miniprogram/utils/achievements.js` 只保存本地提示缓存 key 和“当前佩戴成就”缓存 key，不再维护成就规则。

### 7.2 计算结果结构
- `id`
- `title`
- `description`
- `asset`
- `unlocked`
- `progress`
- `target`
- `progressText`
- `progressValueLabel`
- `targetValueLabel`
- `unlockedAt`
- `unlockedAtLabel`
- `milestones`

持久化集合：
- `userAchievements`
- 文档 `_id` = 当前用户 `openid`
- 主要字段：`userId`、`achievements`、`summary`、`updatedAt`

## 8. 页面方案
成就 Tab 现在由四部分组成：当前佩戴、最近获得、勋章墙、成就详情页。
- 足迹页顶部展示当前佩戴成就。
- 成就标签展示已点亮数量、总数和完成度。
- 最近获得区横向展示近期解锁成就。
- 全部成就使用紧凑勋章墙。
- 点击勋章进入详情页，展示大勋章、说明、进度、达成路径和分享入口。
- 图片加载失败或未配置时显示文字占位。

## 9. 素材接入规范
- 来源目录：`D:\achievements`。
- 云端目录建议：`achievements/`。
- 文件名使用英文 snake_case，例如 `shape_master.png`、`first_team_walk.png`。
- 当前配置位置：`cloudfunctions/shared/achievement-runtime.js` 中每个成就的 `asset` 字段。
- 成就图需要设置为“所有用户可读”。
- 不建议手工猜测 fileID 路径或使用临时签名 HTTPS 地址作为长期配置。

## 10. 技术实现方案
### 10.1 实现策略
- 采用“云端统一计算 + `userAchievements` 持久化 + 前端只读展示”。
- 前端本地缓存只用于记录“新解锁 Toast 是否已提示”和“当前佩戴成就 id”，不作为成就数据来源。
- `listMyAchievements` 优先读取快照；快照缺失或规则数量变化时，由云端全量回算。

### 10.2 代码位置
- `miniprogram/pages/history/history.js`：读取成就结果、处理最近获得、当前佩戴和新解锁提示。
- `miniprogram/pages/history/history.wxml`：展示成就墙和最近获得。
- `miniprogram/pages/history/history.wxss`：成就墙、最近获得、占位兜底样式。
- `miniprogram/pages/achievement-detail/*`：成就详情页与分享入口。
- `miniprogram/services/achievement.js`：封装 `listMyAchievements`。
- `miniprogram/utils/achievements.js`：保存前端缓存 key。
- `cloudfunctions/shared/achievement-runtime.js`：维护 12 个成就配置、判定规则、回算与持久化逻辑。
- `cloudfunctions/listMyAchievements/index.js`：读取或回算当前用户成就。
- `cloudfunctions/createWalk/index.js`：单人记录完成保存后重算当前用户成就。
- `cloudfunctions/finishTeamWalk/index.js`：房主结束同行后为所有成员重算成就。
- `cloudfunctions/deleteWalk/index.js`：删除已结束单人记录后为当前用户重算成就。
- `cloudfunctions/deleteTeamWalk/index.js`：当前用户删除已结束同行记录可见性后，仅为当前用户重算成就。

### 10.3 计算时机
- 单人记录 `status=finished` 保存成功后。
- 同行房间由房主结束并进入 `finished` 后。
- 已结束单人记录删除后。
- 已结束同行记录从当前用户视角删除后。
- 用户进入成就页且 `userAchievements` 快照缺失或规则数量变化时。

## 11. 验收标准（UAT）
- 登录用户进入“足迹 -> 成就”可看到 12 张成就卡。
- 历史记录满足条件时，对应成就正确显示“已解锁”。
- 进度型成就显示正确（无图片 5 次、10 地点、5km）。
- 四季成就按“生成任务时选择的季节字段”判定，不按系统时间判定。
- 首次同行漫步、首次色彩漫步、7 日连续漫步成就判定正确。
- “开罐有奖”对同一条记录的掉落结果稳定一致。
- 删除单人记录后，当前用户成就可回滚重算。
- 删除已结束同行记录后，只影响当前用户成就，不影响其他成员。
- 首次新增解锁有提示，且不会重复刷屏。
- 无登录状态下沿用现有引导文案与跳转逻辑。

## 12. 风险与推荐下一步
### 12.1 当前风险
- 老记录字段不完整（如缺少 `routeStats`、`locationName`、`season`）可能影响判定精度。
- “不同地点”在 V1 采用弱去重策略，存在误判边界。
- 成就图 fileID 和权限仍依赖人工配置。
- 新解锁提示仍依赖前端本地缓存，不同设备之间不会同步提示状态。

### 12.2 推荐下一步实现方案
- 将成就标题、描述、排序和图片 fileID 从云函数代码迁移到服务端配置或数据库配置。
- 把“新解锁提示”从前端本地比对升级为服务端增量返回。
- 增加成就回算日志与资源加载日志，便于定位“未解锁 / 图片不可见 / 规则不一致”。
- 将“不同地点”升级为坐标网格 + POI 聚类规则，提高 `掌量世界` 的去重准确性。
- 之后再评估“解锁时间线”“成就分享海报”“隐藏成就”等长期玩法。

## 13. 里程碑建议
1. 当前 V1 PRD 与实现口径对齐。
2. 素材英文命名整理并上传到云存储。
3. 确认 `cloudfunctions/shared/achievement-runtime.js` 与 5 个云函数副本同步。
4. 成就墙与成就详情页联调。
5. 云文件权限、真机渲染回归与上线。
6. 下一阶段推进成就配置外移与服务端增量解锁提示。
