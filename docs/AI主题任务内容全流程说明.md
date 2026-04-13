# AI 主题任务内容全流程说明

## 1. 文档目的

本文档用于说明当前项目里“AI 生成主题与任务内容”这条链路已经如何工作，覆盖从探索页选点、上下文组装、云函数生成、结果展示，到开始单人漫步 / 创建同行房间 / 后续记录复用主题快照的完整流程。

这份文档重点回答 6 件事：

- 现在用户是从哪里触发 AI 生成的
- 生成前到底给模型传了什么上下文
- `generateTheme` 与 `generateCombinedTheme` 两条主生成链路分别做什么
- shared runtime 如何统一处理 prompt 上下文、任务骨架和结果收口
- 生成结果如何进入单人记录和同行房间
- 当前如何调试、部署和排查这条链路

对应代码入口：

- [探索页](/D:/liuliu-minimap/miniprogram/pages/index/index.js)
- [探索页视图](/D:/liuliu-minimap/miniprogram/pages/index/index.wxml)
- [主题服务层](/D:/liuliu-minimap/miniprogram/services/theme.js)
- [共享生成运行时](/D:/liuliu-minimap/cloudfunctions/shared/generation-runtime.js)
- [单主题生成](/D:/liuliu-minimap/cloudfunctions/generateTheme/index.js)
- [单主题 RAG](/D:/liuliu-minimap/cloudfunctions/generateTheme/rag.js)
- [组合主题生成](/D:/liuliu-minimap/cloudfunctions/generateCombinedTheme/index.js)
- [RAG 优化具体实现](/D:/liuliu-minimap/docs/AI主题任务RAG优化具体实现.md)
- [单人记录落库](/D:/liuliu-minimap/cloudfunctions/createWalk/index.js)
- [同行房间创建](/D:/liuliu-minimap/cloudfunctions/createTeamRoom/index.js)

---

## 2. 全链路概览

当前 AI 主题任务内容的主链路可以概括为：

`探索页设定探索点 -> 前端补齐时间/地点/附近上下文 -> 调用生成云函数 -> shared runtime 收口输出 -> 页面展示主题卡片 -> 用户开始单人漫步或发起同行 -> 主题快照与 generationContext 落库 -> 后续记录页 / 房间页继续围绕这套任务执行`

如果拆成产品动作，完整流程是：

1. 用户在探索页确认探索点
2. 页面获取或补齐附近 POI 与地点语境
3. 页面根据当前时间、地点、天气、偏好、主题选择，构造 `generationContext`
4. 页面调用两个生成云函数入口之一；随机生成会先在前端选主题，再复用 `generateTheme`
5. 云函数结合本地知识、上下文和 AI 生成主题与任务
6. shared runtime 压标题、压描述、压任务长度，并做必要的任务去重与兜底
7. 主题卡片展示结果
8. 用户点击“开始这次漫步”或“发起同行漫步”
9. 单人模式写入 `walkRecords`，同行模式写入 `teamWalkRooms`
10. 记录页或团队记录页后续继续消费这份 `themeSnapshot + generationContext`

---

## 3. 功能板块与页面职责

### 3.1 探索页

对应页面：

- [index.js](/D:/liuliu-minimap/miniprogram/pages/index/index.js)

职责：

- 选择当前位置、搜索地点或手动确认探索点
- 加载附近 POI
- 获取地点语境
- 生成单主题、随机主题、组合主题
- 展示本次传给 AI 的调试上下文
- 把生成结果用于单人开始漫步或同行房间创建

### 3.2 记录页 / 团队记录页

对应页面：

- [record.js](/D:/liuliu-minimap/miniprogram/pages/record/record.js)
- [team-record.js](/D:/liuliu-minimap/miniprogram/pages/team-record/team-record.js)

职责：

- 基于探索页生成出来的主题快照执行任务
- 记录任务素材、文字和打卡内容
- 在单人模式下继续使用 `createWalk`
- 在同行模式下围绕房间任务提交个人贡献

### 3.3 云函数层

对应目录：

- [cloudfunctions](/D:/liuliu-minimap/cloudfunctions)

职责：

- 处理 AI 主题生成
- 统一后处理主题结果
- 把生成结果持久化到单人记录或同行房间
- 在后续核验、成就、历史页中继续复用生成快照

---

## 4. 生成入口与模式划分

探索页当前有 3 个生成操作入口：

1. `generateTheme`
2. 前端随机挑主题后调用 `generateTheme`
3. `generateCombinedTheme`

服务层入口在：

- [theme.js](/D:/liuliu-minimap/miniprogram/services/theme.js)

同时页面还存在两套模式维度：

- `walkMode`
  - `pure`
  - `advanced`
- `journeyMode`
  - 单人
  - 同行

这两套模式分别影响：

- `walkMode` 决定生成几个任务，以及纯粹模式还是进阶模式的 prompt 约束
- `journeyMode` 决定生成完成后是走 `createWalk({ status: 'active' })` 还是 `createTeamRoom()`

当前主题方向包括：

- 形状
- 色彩
- 声音
- 数字
- 气味

其中：

- 纯粹模式只允许 1 个主题方向
- 进阶模式可生成单主题，也可生成双主题组合
- 纯粹模式下天气、偏好、心情会置空，季节仍按当前日期推断
- 随机生成只是前端随机选一个主题，然后复用 `generateTheme`

---

## 5. 生成前置条件

### 5.1 必须先确认探索点

探索页在真正发起生成前，会先判断是否已经确认探索点。

这一层是必要的，因为后续生成上下文依赖：

- `locationName`
- `latitude`
- `longitude`
- `locationAddress`

如果没有探索点，时间上下文之外的“附近感”就无法成立。

### 5.2 页面会自动补齐地点上下文

探索页在生成前会优先补齐两类与“附近”有关的信息：

1. `locationContext`
   - 通过 [getLocationContext](/D:/liuliu-minimap/miniprogram/services/map.js)
   - 用来把经纬度提炼成“校园边缘商业街 / 居民街区 / 商业中心 / 河岸步道”之类的场景标签

2. `nearbyPlaces`
   - 通过 [fetchNearbyPois](/D:/liuliu-minimap/miniprogram/services/map.js)
   - 用来获取真实附近 POI 列表

相关前端补齐逻辑在：

- [index.js](/D:/liuliu-minimap/miniprogram/pages/index/index.js)

关键方法包括：

- `ensureGenerationLocationContext()`
- `ensureGenerationNearbyPlaces()`

---

## 6. 前端上下文组装

### 6.1 `timeContext`

探索页会根据当前本地时间构造 `timeContext`。

对应方法：

- `buildTimeContext()`

当前会包含：

- `localTime`
- `hour`
- `timePhase`
- `weekdayType`
- `timeHints`

时间段会被整理成更适合任务生成的节点，例如：

- 清晨
- 上午
- 午后
- 黄昏
- 夜间
- 凌晨

这一步的意义是把“此刻”显式传给模型，而不是让模型自己猜现在是白天还是夜里。

### 6.2 `nearbySummary`

探索页不会把原始 POI JSON 直接塞给模型，而是先压成一个可读摘要。

对应方法：

- `buildNearbySummary()`

当前摘要结构包括：

- `poiNames`
- `poiTypes`
- `dominantScene`
- `dominantSceneId`
- `sceneCandidates`
- `activityHints`

这样做的好处是：

- prompt 更稳定
- 不容易把无关字段一并带进模型
- 更接近“附近画像”而不是“地图接口回包”

字段来源说明：

- `poiNames` 来自附近 POI 名称，最多保留 8 个去重结果
- `poiTypes` 来自 POI 类型，优先取 `typeSecondary / typePrimary / type`
- `dominantScene` 来自本地 `NEARBY_SCENE_RULES` 对 POI、距离和 `sceneTag` 的综合打分
- `sceneCandidates` 是场景候选前三名，用于排查主场景为什么会被选中
- `activityHints` 来自命中场景、POI 文本和当前时间段 fallback 线索

### 6.3 `contextPacket`

探索页会把生成上下文组装成统一结构化对象 `contextPacket`。

对应方法：

- `buildGenerationContext()`
- `buildGenerationPayload()`

当前 `contextPacket` 主要分为 5 层：

1. `location`
2. `time`
3. `weather`
4. `userState`
5. `nearby`

同时为了兼容旧链路，页面仍会保留部分平铺字段，例如：

- `locationName`
- `locationContext`
- `sceneTag`
- `timeContext`
- `nearbySummary`

也就是说，当前实现已经是“结构化上下文优先，平铺字段兼容回退”的状态。

### 6.4 调试视图

探索页现在已经有“生成调试”面板。

对应：

- [index.wxml](/D:/liuliu-minimap/miniprogram/pages/index/index.wxml)
- [index.wxss](/D:/liuliu-minimap/miniprogram/pages/index/index.wxss)

页面会在每次生成前，把本次真正发给 AI 的 `contextPacket` 存入调试状态：

- `lastGenerationContext`
- `debugContextRows`
- `debugContextLines`

对应方法：

- `buildGenerationDebugState()`
- `toggleGenerationDebug()`

这样在排查“为什么这次生成得不对”时，可以直接看到：

- 当前时间段
- 场景标签
- 附近 POI
- 活动线索
- 原始 JSON
- RAG 计划 `rag.plan`
- RAG 调试信息 `rag.debug`
- 实际传入模型 prompt 的 RAG 内容 `rag.modelInput`

---

## 7. 生成入口的职责

### 7.1 `generateTheme`

用途：

- 处理“按用户当前主题选择生成”的主链路

特点：

- 支持单主题生成
- 支持基于本地知识和 RAG 场景检索来增强 prompt
- 对单主题结果做“主题对齐”，避免跑偏

核心文件：

- [generateTheme/index.js](/D:/liuliu-minimap/cloudfunctions/generateTheme/index.js)
- [generateTheme/rag.js](/D:/liuliu-minimap/cloudfunctions/generateTheme/rag.js)

内部流程大致是：

1. 从事件里解析 `contextPacket`
2. 检索场景画像 `sceneProfiles`
3. 选出参考任务模板 `missionTemplates`
4. 构造带上下文块的 prompt
5. 调用 AI
6. 如果失败，回退到本地 fallback
7. 对单主题结果做对齐
8. 交给 shared runtime 统一收口

### 7.2 随机生成如何工作

当前探索页的“随机生成”不再使用独立随机云函数，而是：

1. 前端先从主题池里随机挑一个方向
2. 把这个方向作为 `selectedThemes`
3. 直接调用 [generateTheme](/D:/liuliu-minimap/cloudfunctions/generateTheme/index.js)
4. 页面展示层仍可保留 `random+ai / random-fallback` 的来源语义

这样纯粹模式下，随机生成和选择生成只剩“主题是谁”的差异，不再因为两套云函数而分叉。

### 7.3 `generateCombinedTheme`

用途：

- 处理两个及以上方向的组合生成

特点：

- 只服务进阶模式的组合场景
- 核心目标不是简单拼接，而是让任务真正体现两个方向的关系
- 会额外强调“不要引入第三个无关主题”

核心文件：

- [generateCombinedTheme/index.js](/D:/liuliu-minimap/cloudfunctions/generateCombinedTheme/index.js)

---

## 8. shared runtime 的统一作用

当前两个后端生成云函数已经不再各自维护完全独立的上下文和后处理逻辑，而是统一复用 shared runtime；随机生成作为前端入口复用 `generateTheme`。

源码：

- [generation-runtime.js](/D:/liuliu-minimap/cloudfunctions/shared/generation-runtime.js)
- [generation-rag-runtime.js](/D:/liuliu-minimap/cloudfunctions/shared/generation-rag-runtime.js)

部署副本：

- [generateTheme/runtime.js](/D:/liuliu-minimap/cloudfunctions/generateTheme/runtime.js)
- [generateTheme/rag-runtime.js](/D:/liuliu-minimap/cloudfunctions/generateTheme/rag-runtime.js)
- [generateCombinedTheme/runtime.js](/D:/liuliu-minimap/cloudfunctions/generateCombinedTheme/runtime.js)
- [generateCombinedTheme/rag-runtime.js](/D:/liuliu-minimap/cloudfunctions/generateCombinedTheme/rag-runtime.js)

shared runtime 主要解决 6 件事：

1. 统一读取上下文
2. 统一生成 prompt 上下文块
3. 统一检索 sceneProfiles / missionTemplates，生成共享 RAG 上下文
4. 统一提供任务骨架提示
5. 统一压缩标题、描述、任务长度
6. 统一做重复任务去重和附近锚点兜底

这套 shared runtime / shared RAG runtime 在最近一轮里又补了两件关键事：

7. 单主题场景提示按主题过滤后再入模
8. 校验从“关键词规则主判定”改为“结构预检 + 每次 AI 复核”

共享检索运行时还会统一产出：

- `generationIntent`
- `generationPlan`
- `ragDebug`
- `ragModelInput`

其中 `ragModelInput` 已移除知识库样例原句，并进一步瘦身为最小必要入模对象，主要保留：

- `targetThemes`
- `time`
- `nearby`
- `sceneCards`
- `themeReferences`

当前单主题还会额外做：

- `referenceMissions.angle` 人类可读化
- `sceneHints` 主题过滤
- `antiPatterns` 主题化补齐

### 8.1 统一读取上下文

相关方法：

- `getContextPacket()`
- `normalizeLocationSignals()`
- `normalizeTimeContext()`
- `normalizeNearbySummary()`

这一层负责：

- 优先从 `generationContext.contextPacket` 取值
- 回退到旧字段，保证兼容

### 8.2 统一 prompt 上下文块

相关方法：

- `buildPromptContextBlock()`

当前会统一拼出一段包含以下内容的上下文：

- 地点
- 场景标签
- 当前时间
- 时间段
- 日期类型
- 时间线索
- 附近场景
- 附近 POI
- 附近活动线索
- 优先任务骨架

这样单主题、前端随机、组合生成都能共享同一种“此时此地”的描述方式。

### 8.3 任务骨架提示

相关方法：

- `buildTaskSkeletonHints()`

当前骨架类型包括：

- 寻找
- 比较
- 停留
- 等待
- 判断来源
- 对照
- 辨认数字

它的作用不是直接输出任务，而是给模型一个更像“真实任务”的结构参考，降低散文化和重复句式。

### 8.4 结果收口

相关方法：

- `compactMission()`
- `missionsAreSimilar()`
- `buildAnchoredMission()`
- `containsContextAnchor()`
- `finalizeTheme()`

这一层会统一处理：

- 限制标题长度
- 限制描述长度
- 限制任务长度
- 去掉相似任务
- 若任务条数不足，优先补 fallback mission，不够再补 anchored mission

也就是说，最终展示给用户的任务，不完全等于模型原始回包，而是“模型回包 + 共享运行时整理”的结果。

### 8.5 统一验证机制

当前纯粹模式、进阶模式、组合模式都复用 `summarizeThemeValidation()`，但它现在只做结构预检。

结构预检重点包括：

- 任务条数是否正确
- 是否存在明显泛化任务
- 进阶模式任务之间是否过于相似
- 结构预检分数是否低于参考线

不再作为硬规则检查的内容：

- 任务里是否必须直接写出地点名
- 是否必须显式带 POI 或场景锚点
- 是否靠关键词匹配来判定最终主题是否正确

当前 AI 复核改为每次都跑。也就是：

- shared runtime 先做结构预检
- AI 再判断是否真正命中主题、是否跑偏、是否需要重写

这样做是为了避免过去那种“关键词规则误判，但人看其实没问题”的情况。

---

## 9. Prompt 与本地知识如何协同

### 9.1 本地知识来源

`generateTheme` 和 `generateCombinedTheme` 并不是纯裸 prompt，它们还会结合本地知识：

- `sceneProfiles`
- `missionTemplates`
- 主题规则与 fallback 规则

相关文件：

- [generateTheme/knowledge.js](/D:/liuliu-minimap/cloudfunctions/generateTheme/knowledge.js)
- [generateCombinedTheme/knowledge.js](/D:/liuliu-minimap/cloudfunctions/generateCombinedTheme/knowledge.js)

### 9.2 生成逻辑不是完全开放式

当前系统已经有比较强的约束，包括：

- 纯粹模式只生成 1 个任务
- 进阶模式生成 3 个任务
- 单主题不能明显跑偏
- 组合主题不能偷偷混入第三主题
- 任务要短、清楚、可执行
- 任务尽量带附近锚点
- 五个单主题都带有自己的 `angles / antiPatterns / sceneHints` 过滤逻辑

所以当前生成系统更接近：

- “有约束的 AI 生成”

而不是：

- “给大模型自由发挥”

---

## 10. 返回给前端的结果结构

所有生成入口最终都会返回一个统一风格的主题对象，核心字段包括：

- `title`
- `description`
- `category`
- `missions`
- `vibeColor`

前端会进一步做一次主题修剪和展示整理，然后写入：

- `currentTheme`

供探索页主题卡片展示，以及后续开始漫步 / 发起同行使用。

页面展示组件主要依赖：

- [theme-card](/D:/liuliu-minimap/miniprogram/components/theme-card/theme-card.wxml)

---

## 11. 生成后的两条业务落地路径

### 11.1 单人模式

当用户点击“开始这次漫步”时：

1. 页面校验当前已经有 `currentTheme`
2. 页面校验探索点已确认
3. 页面校验用户已登录
4. 页面调用 `createWalk({ status: 'active' })`

云函数：

- [createWalk/index.js](/D:/liuliu-minimap/cloudfunctions/createWalk/index.js)

会落库到 `walkRecords` 的关键内容包括：

- `themeTitle`
- `themeSnapshot`
- `locationName`
- `locationContext`
- `locationAddress`
- `latitude`
- `longitude`
- `walkMode`
- `season`
- `generationContext`
- `status=active`

这意味着：

- 后续记录页不是重新向 AI 要任务
- 而是继续围绕探索页这一刻生成出来的主题快照执行

### 11.2 同行模式

当用户点击“发起同行漫步”时：

1. 页面校验 `currentTheme`
2. 页面校验探索点与登录状态
3. 页面调用 `createTeamRoom()`

云函数：

- [createTeamRoom/index.js](/D:/liuliu-minimap/cloudfunctions/createTeamRoom/index.js)

会写入：

- `teamWalkRooms`
- `teamWalkMembers`
- `teamWalkActivities`

房间记录里同样会保存：

- `themeSnapshot`
- `themeTitle`
- `themeCategory`
- `locationName`
- `locationContext`
- `locationAddress`
- `season`
- `generationContext`

也就是说，同行模式复用的不是“另起一套任务系统”，而是探索页已经生成好的主题快照。

---

## 12. 记录执行与任务核验如何复用生成内容

主题一旦进入记录或房间之后，后续页面主要围绕以下内容工作：

- 任务列表 `missions`
- 主题标题与描述
- 生成上下文 `generationContext`

### 12.1 单人记录页

记录页支持：

- 文字
- 图片
- 视频
- 录音
- 路线追踪
- 任务核验
- 贴纸与陪伴文案

相关云函数：

- [verifyMission](/D:/liuliu-minimap/cloudfunctions/verifyMission/index.js)
- [generateSticker](/D:/liuliu-minimap/cloudfunctions/generateSticker/index.js)

### 12.2 保存完成记录

单人模式结束时，页面会再次调用：

- `createWalk({ id, status: 'finished' })`

完成同一条记录的更新。

这时主题快照不会被重新生成，而是延续开始时保存下来的那份生成结果。

---

## 13. 调试与排查建议

当前围绕 AI 生成链路，最重要的排查入口有 4 个：

### 13.1 探索页调试面板

重点看：

- `contextPacket.location.sceneTag`
- `contextPacket.time.timePhase`
- `contextPacket.nearby.poiNames`
- `contextPacket.nearby.activityHints`
- `contextPacket.rag.plan.targetThemes`
- `contextPacket.rag.plan.chosenScene`
- `contextPacket.rag.debug.sceneCoverage`
- `contextPacket.rag.modelInput`
- `contextPacket.validation`

如果这里就不对，后面 prompt 再怎么改也不会准。

新增两个高优先级检查点：

- `rag.modelInput.referenceMissions[].angle` 是否还是内部 id
- `rag.modelInput.scenes[].missionHints` 是否还混入别的主题提示

### 13.2 shared runtime

重点看：

- `buildPromptContextBlock()`
- `buildTaskSkeletonHints()`
- `finalizeTheme()`

如果结果“AI 味重、太长、没附近感”，通常先看这一层。

### 13.3 生成云函数

重点看：

- prompt 是否正确带入上下文
- fallback 是否过强
- 单主题对齐是否误伤

### 13.4 落库链路

重点看：

- `createWalk`
- `createTeamRoom`

如果记录页看到的主题和探索页不一致，通常要检查这里是不是没把 `themeSnapshot` 或 `generationContext` 一起带上。

---

## 14. 部署与运维依赖

当前 AI 主题任务内容全流程依赖至少以下云函数：

- `fetchNearbyPois`
- `getLocationContext`
- `generateTheme`
- `generateCombinedTheme`
- `createWalk`
- `createTeamRoom`

如果修改了 shared runtime 或共享检索层，还需要先执行：

```bash
node scripts/sync_cloud_generation_runtime.js
```

然后重新部署：

- `generateTheme`
- `generateCombinedTheme`

同时需要确认：

- 云函数权限规则允许探索阶段调用 `fetchNearbyPois`、`getLocationContext`、主题生成函数
- AI 相关环境变量已经配置
- 地图相关环境变量已经配置

部署和权限细节可继续参考：

- [云开发环境重建说明.md](/D:/liuliu-minimap/docs/云开发环境重建说明.md)

---

## 15. 当前系统的真实定位

当前这条链路的本质不是“单一 AI 接口”。

它已经是一条完整的业务流水线，包含：

- 探索页选点
- 结构化上下文组装
- 云函数 AI 生成
- shared runtime 统一收口
- 主题展示
- 单人 / 同行落库
- 后续记录执行与核验复用

因此后续无论要继续优化 prompt、接 Web 共用接口、增加埋点，还是调试“为什么今天生成不对”，都应该把它当成一条完整链路来看，而不是只盯着某一个模型 prompt。
