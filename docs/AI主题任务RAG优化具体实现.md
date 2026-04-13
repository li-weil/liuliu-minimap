# AI 主题任务 RAG 优化具体实现

## 1. 文档目的

本文档用于记录当前 RAG 优化方案已经落地到代码里的具体实现，结构参考 [AI主题任务RAG优化方案.md](/D:/liuliu-minimap/docs/AI主题任务RAG优化方案.md)，但重点不是继续提出方案，而是说明：

- 当前生成链路到底从哪里取上下文
- 随机生成和选择生成是否已经统一
- RAG 如何检索、排序、生成计划和调试信息
- 纯粹模式与进阶模式如何共用同一套校验机制
- 前端调试面板里每类字段具体代表什么
- 后续排查“为什么像 fallback / 为什么不贴题 / 为什么一直像样例”时应该先看哪里

对应核心文件：

- [探索页上下文组装](/D:/liuliu-minimap/miniprogram/pages/index/index.js)
- [探索页调试面板](/D:/liuliu-minimap/miniprogram/pages/index/index.wxml)
- [主题服务层](/D:/liuliu-minimap/miniprogram/services/theme.js)
- [接口映射层](/D:/liuliu-minimap/miniprogram/services/api.js)
- [单主题云函数](/D:/liuliu-minimap/cloudfunctions/generateTheme/index.js)
- [单主题 RAG prompt](/D:/liuliu-minimap/cloudfunctions/generateTheme/rag.js)
- [组合主题云函数](/D:/liuliu-minimap/cloudfunctions/generateCombinedTheme/index.js)
- [共享生成运行时](/D:/liuliu-minimap/cloudfunctions/shared/generation-runtime.js)
- [共享检索运行时](/D:/liuliu-minimap/cloudfunctions/shared/generation-rag-runtime.js)
- [运行时同步脚本](/D:/liuliu-minimap/scripts/sync_cloud_generation_runtime.js)

---

## 2. 当前总状态

当前 AI 主题任务生成已经从“三个后端生成云函数”收敛为：

1. `generateTheme`
   - 单主题生成
   - 纯粹模式随机生成
   - 纯粹模式选择生成
   - 进阶模式单主题生成

2. `generateCombinedTheme`
   - 进阶模式双主题组合生成

3. 前端随机入口
   - 只负责从主题池随机挑一个主题
   - 然后调用 `generateTheme`
   - 不再有独立 `generateRandomTheme` 云函数

已清理的旧内容：

- `cloudfunctions/generateRandomTheme`
- `miniprogram/services/api.js` 里的 `generateRandomTheme` endpoint
- `scripts/sync_cloud_generation_runtime.js` 里的旧随机云函数同步目标
- 文档中部署 `generateRandomTheme` 的旧说明

仍然保留的“随机”代码是前端产品入口，不是旧后端：

- `pickRandomThemeCategory()`
- `handleRandomTheme()`
- WXML 里的“随机生成”按钮

当前单主题运行时版本：

- `2026-04-13-validation-r2`

---

## 3. 生成入口如何统一

### 3.1 随机生成

探索页 `handleRandomTheme()` 的流程是：

1. 校验探索点是否已经确认
2. 从 `randomCategories` 随机挑一个 `category`
3. 转成 `selectedThemes`
4. 调用 `buildGenerationPayload()`
5. 调用 `generateTheme()`
6. 把 `rag+ai` / `rag-fallback` 显示归一成 `random+ai` / `random-fallback`

这意味着随机生成和选择生成在后端上的差异已经消失，差异只剩：

- 随机生成：主题由前端随机挑
- 选择生成：主题由用户选择

### 3.2 选择生成

探索页 `handleSelectedThemeGenerate()` 的流程是：

1. 读取 `combineSelections`
2. 纯粹模式只保留 1 个主题
3. 进阶模式最多保留 2 个主题
4. 如果是单主题，调用 `generateTheme()`
5. 如果是进阶双主题，调用 `generateCombinedTheme()`

### 3.3 AI 生成按钮

探索页 `handleGenerateTheme()` 的流程是：

1. 读取当前选择状态
2. 如果进阶模式且选了两个主题，调用 `generateCombinedTheme()`
3. 否则调用 `generateTheme()`
4. 如果没有显式主题，则前端先随机补一个主题再生成

---

## 4. contextPacket 如何生成

所有生成入口都会先调用 `buildGenerationPayload()`。它会并行补齐：

- `ensureGenerationLocationContext()`
- `ensureGenerationNearbyPlaces()`

然后组装统一的 `generationContext` 和 `contextPacket`。

### 4.1 location

`contextPacket.location` 包含：

- `name`
  - 当前探索点名称
- `address`
  - 当前探索点地址
- `latitude`
  - 当前探索点纬度
- `longitude`
  - 当前探索点经度
- `sceneTag`
  - `getLocationContext()` 返回的地点语境，或页面已有 `locationContext`

### 4.2 time

`contextPacket.time` 来自 `buildTimeContext()`，包含：

- `localTime`
  - 当前本地时间
- `hour`
  - 当前小时
- `timePhase`
  - 当前时间段
- `weekdayType`
  - 工作日 / 周末
- `timeHints`
  - 当前时间段下适合生成任务的空间、人流、感官线索

当前时间段包括：

- 凌晨
- 清晨
- 上午
- 午后
- 黄昏
- 夜间

### 4.3 weather

`contextPacket.weather` 包含：

- `label`
- `season`

纯粹模式的特殊规则：

- `weather.label` 置空
- `season` 根据当前日期推断
- 不额外请求天气接口
- 生成时不依赖具体天气

### 4.4 userState

`contextPacket.userState` 包含：

- `mood`
- `preference`
- `selectedThemes`
- `walkMode`
- `generatedThemeCategory`
- `generatedThemeTitle`

纯粹模式的特殊规则：

- `mood` 置空
- `preference` 置空
- `selectedThemes` 仍然保留
- `walkMode` 仍然保留
- `season` 仍然保留在 `weather.season`

这样纯粹模式不会被进阶模式里的情绪、偏好、天气选项影响，但仍然能知道季节和主题。

### 4.5 nearby

`contextPacket.nearby` 来自 `buildNearbySummary()`，包含：

- `poiNames`
- `poiTypes`
- `dominantScene`
- `dominantSceneId`
- `sceneCandidates`
- `activityHints`

这些字段不是从模型生成出来的，而是由前端根据附近 POI、地点语境和当前时间段计算出来。

---

## 5. POI、dominantScene、activityHints 的来源

### 5.1 poiNames

`poiNames` 来自 `nearbyPlaces` 中的 POI 名称。

当前策略：

- 最多取 8 个
- 去空
- 去重

这些 POI 由 `fetchNearbyPois()` 返回，探索页会在生成前通过 `ensureGenerationNearbyPlaces()` 确保它们存在。

### 5.2 poiTypes

`poiTypes` 来自每个 POI 的类型字段。

优先顺序是：

1. `typeSecondary`
2. `typePrimary`
3. `type`

当前策略同样会去空、去重，并限制数量。

### 5.3 dominantScene

`dominantScene` 不是地图接口直接返回的字段，而是本地规则推断结果。

核心规则在探索页的 `NEARBY_SCENE_RULES`：

- 历史景区游览带
- 文博展览停留带
- 城市地标与广场游览带
- 公园或滨水慢行带
- 校园与教育生活带
- 居民街区生活带
- 商业办公停留带
- 餐饮与市井烟火带
- 交通换乘流动带
- 医院与民生服务带

评分依据包括：

- `sceneTag` 是否命中场景关键词
- 附近 POI 名称、地址、类型是否命中场景关键词
- POI 距离远近
- POI 在列表中的排序位置

因此如果 `dominantScene` 和实际感觉不搭，优先检查：

- `poiNames` 是否偏少或偏了
- `poiTypes` 是否太粗
- `sceneTag` 是否不准
- `sceneCandidates` 的第一名和第二名分差是否很小
- 是否需要扩充 `NEARBY_SCENE_RULES`

### 5.4 sceneCandidates

`sceneCandidates` 是前 3 个有分数的候选场景。

字段含义：

- `id`
  - 场景内部 ID
- `label`
  - 场景中文名
- `score`
  - 根据 POI、距离和 sceneTag 算出来的场景分

它用于排查“为什么 chosenScene 和实际情况不搭”。

### 5.5 activityHints

`activityHints` 来自三层合并：

1. 命中场景规则里的 `activityHints`
2. POI 文本触发的补充线索
3. 当前时间段的 fallback 线索

例如：

- 景区、票务、入口命中时，会补“排队入场、找入口或核验”
- 餐饮、菜市场命中时，会补“找吃的、短暂停留或边走边选”
- 黄昏时段会补“回程、等人和顺路停一下会叠在一起”

---

## 6. RAG 检索如何工作

统一检索入口是：

- `buildUnifiedRetrievalContext()`

它位于：

- [generation-rag-runtime.js](/D:/liuliu-minimap/cloudfunctions/shared/generation-rag-runtime.js)

两个生成云函数都会使用它：

- `generateTheme` 通过 `retrieveContext()`
- `generateCombinedTheme` 通过 `buildCombinedReferenceContext()`

### 6.1 检索输入

RAG 会综合：

- 地点名
- `locationContext`
- `sceneTag`
- 用户偏好
- 天气
- 心情
- 季节
- 已选主题
- `nearbySummary.dominantScene`
- `nearbySummary.poiNames`
- `nearbySummary.poiTypes`
- `nearbySummary.activityHints`
- `timeContext.timePhase`
- `timeContext.weekdayType`
- `timeContext.timeHints`

### 6.2 场景评分

场景评分由 `scoreScene()` 完成。

分数项包括：

- `keyword`
  - 场景关键词命中
- `category`
  - 场景支持的主题命中
- `time`
  - 场景适配当前时间段
- `nearby`
  - 是否命中 `dominantSceneId` 或候选场景
- `activity`
  - 活动线索命中
- `preference`
  - 用户偏好命中

前端调试面板里的 `sceneCoverage.scoreBreakdown` 就来自这里。

### 6.3 模板评分

任务模板评分由 `scoreTemplate()` 完成。

分数项包括：

- `category`
  - 是否命中目标主题
- `cue`
  - 模板线索是否命中上下文
- `anchor`
  - 锚点类型是否命中附近 POI / 类型
- `scene`
  - 模板适配场景
- `time`
  - 模板适配时间段
- `mode`
  - 模板适配纯粹 / 进阶模式
- `nearby`
  - 模板线索是否命中附近信息
- `diversity`
  - 是否有助于角度差异
- `penalty`
  - 是否触发反例扣分

### 6.4 referenceMissions

`referenceMissions` 是 RAG 召回出来的参考任务资产。

它包含：

- `id`
- `category`
- `angle`
- `cues`
- `sceneFit`
- `timeFit`
- `anchorTypes`
- `antiPatterns`
- `diversityTags`
- `retrievalScore`
- `scoreBreakdown`

注意：

- 任务模板库里仍有 `samples/templates`
- 但当前传给模型的 `ragModelInput` 已移除样例原句
- 模型只能看到角度、线索、锚点、反例和分数
- 这样是为了降低“照着 sample 改写”的问题
- `angle` 现在优先使用可读角度，不再优先暴露模板内部 id
- `antiPatterns` 现在已经覆盖五个单主题，不再只集中在形状 / 数字

单主题额外补充：

- `ragModelInput.scenes[].missionHints` 会按已选主题过滤。
- 如果场景里已经有明确命中主题的提示，就优先只保留这类提示。
- 这一步是为了解决“模板没串味，但 scene hints 把模型带偏”的问题。

fallback 仍可能使用模板样例作为兜底素材，因此看到 `source=rag-fallback` 时，要把它和 `source=rag+ai` 区分开看。

---

## 7. generationPlan 与 ragDebug

### 7.1 generationPlan

`generationPlan` 是 RAG 给模型的生成计划。

单主题常见字段：

- `targetThemes`
- `chosenScene`
- `sceneId`
- `recommendedAngles`
- `primaryAnchors`
- `antiPatterns`
- `supportingScenes`

组合主题还会包含：

- `focusThemes`
- `dominantScene`
- `timePhase`
- `angleDigest`
- `categoryPlans`
- `missionBlueprints`

它的作用是：

- 告诉模型本次必须命中的主题
- 告诉模型主场景是什么
- 给模型推荐角度和锚点
- 告诉模型哪些写法不要碰
- 让同地点重复生成时能通过 `generationSeed` 拉开动作、锚点或角度

### 7.2 ragDebug

`ragDebug` 是排查用字段。

主要包含：

- `retrievalQuality`
  - 当前是否召回到了参考任务
- `themeCoverage`
  - RAG 最终覆盖的主题
- `sceneCoverage`
  - 场景候选、分数和分数拆解
- `anchorCoverage`
  - 本次可用锚点
- `diversityAngles`
  - 本次可用角度
- `antiPatterns`
  - 本次应避免的写法
- `selectedReferenceIds`
  - 本次召回模板 ID

### 7.3 ragModelInput

`ragModelInput` 是更接近“真正塞进 prompt 的 RAG 内容”的调试字段。

它用于排查：

- 模型到底看到了哪些场景
- 模型到底看到了哪些锚点
- 模型有没有看到样例原句
- 组合模式是否拿到了融合计划

当前实现会在 `ragModelInput` 中加入说明：

- “已移除知识库样例原句，模型只能参考角度、线索和锚点，不应照抄样例句。”

---

## 8. Prompt 如何消费 RAG

### 8.1 单主题 prompt

单主题 prompt 会包含：

- 用户输入
- 主题范围
- 当前变化种子
- `promptContext.text`
- 完整 `ragModelInput`
- 精简后的 RAG 计划

关键约束包括：

- 必须体现地点语境、时间段和附近场景
- 如果用户选择主题，任务必须明显命中主题
- 未选择声音时，不要把声音作为任务重点
- 数字主题必须直接涉及数字形状、数量统计、数字变体或数字行动线索
- 任务要短、清楚、可执行
- 同一地点重复生成时要根据 `generationSeed` 改变动作、锚点或观察角度
- 不要复用知识库样例句

### 8.2 组合主题 prompt

组合主题 prompt 会额外包含：

- `modelReferenceContext`
- `generationPlan`
- `categoryPlans`
- `missionBlueprints`
- 组合反例约束

关键约束包括：

- 两个主题必须真正融合
- 不要各写各的
- 不要引入第三个无关主题
- 三个任务角度尽量不同
- 至少一个任务呼应附近 POI 或活动线索
- 至少一个任务体现两个方向的交集

---

## 9. 结果收口与校验

### 9.1 finalizeTheme

`finalizeTheme()` 位于共享运行时。

它负责：

- 限制标题长度
- 限制描述长度
- 限制任务长度
- 纯粹模式保留 1 条任务
- 进阶模式保留 3 条任务
- 去掉相似任务
- 任务不足时补锚点任务
- 缺少在地锚点时替换泛化任务

### 9.2 规则校验

统一校验入口是：

- `summarizeThemeValidation()`

它会检查：

- 是否命中主题
- 是否有在地锚点
- 是否存在泛化任务
- 是否混入未选主题
- 进阶模式任务之间是否太像
- 规则评分是否达到阈值

最新补充行为：

- 校验会拦真正的跨主题跑偏。
- 校验也会放过少量“服务主主题的合理借词”。

当前已明确允许的例子：

- 数字主题里出现“像数字的形状”
- 形状主题里出现“光影轮廓 / 反光帮助辨认轮廓”

当前仍会严格拦截的例子：

- 形状主题写成“数清、数量统计”
- 色彩主题写成“听广播节奏”
- 气味主题写成“数几个暖色灯箱”

纯粹模式和进阶模式使用同一套函数，但配置不同：

- 纯粹模式
  - 最少 1 个主题命中
  - 最少 1 个锚点
  - 任务差异度按单任务处理

- 进阶模式
  - 最少 2 个主题命中任务
  - 最少 2 个锚点任务
  - 任务之间不能过于相似

组合模式也使用同一套校验，只是传入 `combined: true`，会检查多个主题的整体覆盖。

### 9.3 AI 二次复核

当前不是每次都做 AI 二次复核。

触发条件是：

- 规则校验发现明显问题
- 并且生成函数调用 `summarizeThemeValidation()` 时允许 `allowSecondaryValidation: true`

可能触发的问题包括：

- 主题不命中
- 在地锚点不足
- 任务过于泛化
- 单主题混入未选方向
- 进阶模式任务太像
- 规则评分低于阈值

二次复核会返回：

- `aiOk`
- `aiScore`
- `aiReasons`
- `aiShouldRewrite`
- `secondaryValidationUsed`
- `secondaryValidationError`

如果 AI 建议重写并给出 `rewrittenTheme`，云函数会局部合并后再次交给 `finalizeTheme()` 收口。

---

## 10. 前端调试面板

探索页已经有“生成调试”开关。

展示内容包括：

- 摘要卡片
- RAG 字段说明
- `rag.plan`
- `rag.debug`
- `rag.modelInput`
- `contextPacket`

### 10.1 source

`source` 用于判断结果来源：

- `rag+ai`
  - 单主题 AI 生成成功
- `rag-fallback`
  - 单主题 AI 失败后使用 fallback
- `random+ai`
  - 前端随机主题后，`generateTheme` AI 成功
- `random-fallback`
  - 前端随机主题后，`generateTheme` fallback
- `combined+ai`
  - 组合主题 AI 成功
- `combined-fallback`
  - 组合主题 fallback

如果看到 `rag+ai`，说明不是 fallback，但仍可能没有触发 AI 二次复核。

### 10.2 validation

调试面板里的校验状态用于判断生成质量。

典型状态：

- `通过 · 规则校验`
  - 规则校验已通过，没有必要触发 AI 二次复核
- `待修正 · 规则校验`
  - 规则发现问题
- `通过 · AI 复核`
  - 规则触发了二次复核，AI 复核后通过
- `云函数未返回`
  - 当前部署的云函数可能还是旧版本，没有返回 validation

### 10.3 runtimeVersion

当前主题生成运行时版本：

- `2026-04-13-validation-r2`

如果前端调试面板看不到这个版本，或 `validation` 一直显示未提供，优先检查云函数是否重新部署。

### 10.4 rag.plan

重点看：

- `targetThemes`
  - 是否和用户选择主题一致
- `chosenScene`
  - 最终主场景是否符合附近
- `sceneId`
  - 是否和候选场景第一名对应
- `primaryAnchors`
  - 是否有真实 POI 或场景线索
- `recommendedAngles`
  - 是否提供了足够多的任务角度
- `antiPatterns`
  - 是否包含这次应该避开的写法

### 10.5 rag.debug

重点看：

- `retrievalQuality`
  - 是否 high
- `sceneCoverage`
  - 候选场景分数是否合理
- `themeCoverage`
  - 是否命中主题
- `selectedReferenceIds`
  - 是否召回了对应模板
- `scoreBreakdown`
  - 是 POI、时间、偏好、场景标签中的哪一项拉高了分数

### 10.6 rag.modelInput

重点看：

- 是否包含样例原句
- 是否包含正确的 `generationPlan`
- 是否包含正确的 `nearbySummary`
- 是否把错误场景传给了模型
- 组合主题是否包含 `missionBlueprints`

单主题额外建议看：

- `referenceMissions[].angle`
  - 是否是“轮廓节奏 / 天气显色 / 回响层次 / 数字变体 / 来源判断”这类可读角度。
- `scenes[].missionHints`
  - 是否已经是单主题过滤后的结果。

---

## 11. 常见问题排查

### 11.1 为什么不是 fallback，也没有 AI 复核

如果 `source=rag+ai`，但 `validation` 显示“通过 · 规则校验”，这是正常情况。

原因是：

- AI 生成成功，所以不是 fallback
- 规则校验已经通过，所以不会额外触发 AI 二次复核

只有规则发现问题时，才会尝试 AI 二次复核。

### 11.2 为什么同一地点生成几次句子很像

优先检查：

- `generationSeed` 是否每次变化
- `rag.modelInput` 是否仍包含样例原句
- `referenceMissions` 的角度是否太少
- `recommendedAngles` 是否重复
- `primaryAnchors` 是否过度集中在同一个 POI
- 是否命中 fallback

当前已做的处理：

- 前端每次生成会写入新的 `generationSeed`
- prompt 要求同地点重复生成时改变动作、锚点或观察角度
- `ragModelInput` 已移除样例原句
- 模板里引入 `angle / anchorTypes / antiPatterns / diversityTags`

### 11.3 为什么数字主题却显示其他主题

优先检查：

- `contextPacket.userState.selectedThemes`
- `rag.plan.targetThemes`
- `rag.debug.themeCoverage`
- `generatedThemeCategory`
- `generatedThemeTitle`
- 单主题是否混入了未选主题

当前规则：

- 单主题会用 `forceThemeAlignment()` 做主题对齐
- 数字主题必须直接涉及数字形状、数量统计、数字变体或数字行动线索
- 校验会检查未选方向混入
- 但“像数字的形状”属于数字主题允许表达，不再按形状跑偏处理

### 11.3.1 为什么其他主题也要查“误判”

这轮排查发现，问题不只在“模型串味”，还在“规则太粗”。

典型例子：

- 形状里的“光影轮廓”以前容易被规则误判成色彩
- 数字里的“像数字的形状”以前容易被规则误判成形状

所以当前判断逻辑已经升级成：

- 真跑偏要拦
- 合理借词要放

### 11.4 为什么 chosenScene 和 sceneId 不对

优先检查：

- `contextPacket.nearby.dominantScene`
- `contextPacket.nearby.dominantSceneId`
- `contextPacket.nearby.sceneCandidates`
- `rag.debug.sceneCoverage`
- `scoreBreakdown.nearby`
- `scoreBreakdown.keyword`

如果附近 POI 明显偏向 A，但 `sceneTag` 或某个高权重 POI 拉向 B，就可能出现场景不符合直觉。

解决方向：

- 扩充 `NEARBY_SCENE_RULES`
- 调整关键词
- 调整距离和排序权重
- 引入更多 POI
- 在调试面板中对比 `dominantScene` 与 `sceneCandidates`

### 11.5 为什么纯粹模式没有天气和偏好

这是有意设计。

纯粹模式下：

- `weather.label` 置空
- `preference` 置空
- `mood` 置空
- `season` 仍然根据日期推断
- `selectedThemes` 仍然传入

目标是让纯粹模式更轻，不被进阶选项污染，但仍保留季节与主题方向。

---

## 12. 运行时同步与部署

共享源码放在：

- `cloudfunctions/shared/generation-runtime.js`
- `cloudfunctions/shared/generation-rag-runtime.js`

云函数实际运行时使用本地副本：

- `cloudfunctions/generateTheme/runtime.js`
- `cloudfunctions/generateTheme/rag-runtime.js`
- `cloudfunctions/generateCombinedTheme/runtime.js`
- `cloudfunctions/generateCombinedTheme/rag-runtime.js`

每次修改 shared 之后，需要运行：

```bash
node scripts/sync_cloud_generation_runtime.js
```

该脚本只同步两个生成云函数：

- `generateTheme`
- `generateCombinedTheme`

它不会再同步 `generateRandomTheme`。

同步后需要重新部署：

- `generateTheme`
- `generateCombinedTheme`

如果旧云环境里曾经部署过 `generateRandomTheme`，本地删除不会自动删除云端函数，需要在云开发控制台或部署工具里手动下线。

---

## 13. 当前实现边界

当前实现已经落地：

- 当前时间段与丰富 `timeHints`
- POI 进入 `nearbySummary`
- 地点语境进入 `sceneTag`
- 纯粹模式 weather / preference / mood 置空
- 纯粹模式仍读取季节
- 随机生成复用 `generateTheme`
- 组合主题复用统一 RAG runtime
- `ragPlan / ragDebug / ragModelInput` 返回前端
- 样例原句不再作为 `ragModelInput` 传给模型
- 统一规则校验与按需 AI 二次复核
- 前端调试面板展示 contextPacket 和 RAG 入模内容
- 五个单主题都补齐了可读 `angles` 与 `antiPatterns`
- 单主题场景提示会按主题过滤
- 校验已经处理“串味”和“误判”两类问题

仍然值得继续优化：

- 扩充更多 POI 场景规则
- 扩充每个主题的 angle 库
- 继续降低 fallback 样例句重复感
- 引入 bad case 库
- 对 `scoreBreakdown` 做更细的可视化
- 将 RAG 质量、生成 source、validation score 做长期埋点统计

---

## 14. 一句话结论

当前 RAG 已经不是“给模型几句 sample”。

它现在更接近一套完整的生成前处理系统：

- 前端组装此时此地的 `contextPacket`
- RAG 根据主题、时间、附近、场景做检索和计划
- prompt 显式要求模型消费计划、锚点和反例
- shared runtime 统一收口结果
- validation 统一判断是否命中主题、是否在地、是否泛化
- 前端把 context、plan、debug、modelInput 全部暴露出来用于排查

这就是当前“附近”的重建在代码里的实际落点。
