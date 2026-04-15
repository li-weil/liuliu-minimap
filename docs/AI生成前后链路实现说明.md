# AI 生成前后链路实现说明

## 1. 文档目的

本文档用于完整说明当前项目里“AI 生成主题与任务”这条链路的真实实现，覆盖：

- 探索页如何触发生成
- 生成前前端如何补齐时间、地点、AOI、POI 与偏好上下文
- 单主题 `generateTheme` 与组合主题 `generateCombinedTheme` 如何组织 prompt
- 云函数如何调用模型、如何返回调试信息
- shared runtime 如何完成归一化、偏好对象筛选、骨架生成与结果收口
- 生成结果如何回流到前端展示、调试面板、单人记录与同行房间

这份文档的目标不是描述理想方案，而是记录“当前线上这版代码实际上怎么跑”。

核心入口文件：

- [探索页](/D:/liuliu-minimap/miniprogram/pages/index/index.js)
- [生成服务层](/D:/liuliu-minimap/miniprogram/services/theme.js)
- [地图服务层](/D:/liuliu-minimap/miniprogram/services/map.js)
- [单主题生成](/D:/liuliu-minimap/cloudfunctions/generateTheme/index.js)
- [组合主题生成](/D:/liuliu-minimap/cloudfunctions/generateCombinedTheme/index.js)
- [共享运行时](/D:/liuliu-minimap/cloudfunctions/shared/generation-runtime.js)
- [单主题 AI 调用](/D:/liuliu-minimap/cloudfunctions/generateTheme/ai.js)
- [地点上下文](/D:/liuliu-minimap/cloudfunctions/getLocationContext/index.js)
- [附近 POI](/D:/liuliu-minimap/cloudfunctions/fetchNearbyPois/index.js)
- [单人漫步落库](/D:/liuliu-minimap/cloudfunctions/createWalk/index.js)
- [同行房间创建](/D:/liuliu-minimap/cloudfunctions/createTeamRoom/index.js)

---

## 2. 当前链路总览

当前 AI 生成链路可以概括为：

`探索页确认探索点 -> 前端并行补齐地点上下文和附近 POI -> 组装 generationContext -> 调用生成云函数 -> shared runtime 处理上下文与结果 -> 返回主题 + 调试元信息 -> 前端展示主题卡片和调试视图 -> 用户进入单人漫步或创建同行房间 -> generationContext 与 themeSnapshot 一起落库`

如果按真正的执行顺序拆开，链路是：

1. 用户在探索页选点
2. 探索页构造 `timeContext`
3. 探索页调用 `getLocationContext`
4. 探索页调用 `fetchNearbyPois`
5. 探索页把地点、时间、附近、用户偏好等内容压成 `generationContext`
6. 探索页调用：
   - `generateTheme`
   - 或 `generateCombinedTheme`
7. 云函数内部：
   - 从 event 归一化地点 / 时间 / 附近 / 偏好
   - 生成 prompt
   - 请求模型
   - 归一化模型 JSON
   - 调用 `finalizeTheme()` 收口
8. 云函数返回：
   - `theme`
   - `validation`
   - `modelRequest`
   - `modelResponse`
   - `runtimeVersion`
9. 前端把这些元信息写回 `generationContext`
10. 前端主题卡片展示结果，调试视图展示本次入模与原始返回
11. 用户点击开始漫步或发起同行
12. `themeSnapshot + generationContext` 被写入单人记录或同行房间

---

## 3. 前端触发链路

### 3.1 探索页的 3 个生成入口

当前探索页有 3 个触发入口，全部在 [index.js](/D:/liuliu-minimap/miniprogram/pages/index/index.js)：

- `handleGenerateTheme()`
  - 正常单主题 / 双主题生成入口
- `handleRandomTheme()`
  - 前端先随机选一个主题，再复用 `generateTheme`
- 主题选择生成
  - 本质上仍然走 `handleGenerateTheme()` 或 `generateCombinedTheme`

实际服务层非常薄，只负责调用云函数：

- [theme.js](/D:/liuliu-minimap/miniprogram/services/theme.js)

包括：

- `generateTheme(payload)`
- `generateCombinedTheme(payload)`

### 3.2 生成前的前端状态控制

探索页在发起生成前，会先做两件事：

1. `ensureExplorePointReadyForGeneration()`
   - 保证当前已经有可用探索点
   - 没有探索点则不进入生成

2. `this.setData({ isGenerating: true })`
   - 前端进入生成中状态
   - 当前等待体验主要依赖这个布尔值

---

## 4. 生成前上下文组装

### 4.1 `buildGenerationPayload()`

生成前的核心组装入口在：

- [index.js](/D:/liuliu-minimap/miniprogram/pages/index/index.js)

方法：

- `buildGenerationPayload(basePayload = {})`

这一步会并行准备两类外部信息：

- `ensureGenerationLocationContext()`
- `ensureGenerationNearbyPlaces()`

对应代码就是：

```js
const [locationContextResult, nearbyPlaces] = await Promise.all([
  this.ensureGenerationLocationContext(),
  this.ensureGenerationNearbyPlaces(),
]);
```

也就是说，地点上下文和附近 POI 已经是并行拉取，不是串行。

### 4.2 `ensureGenerationLocationContext()`

这个方法最终会调用：

- [map.js](/D:/liuliu-minimap/miniprogram/services/map.js)
  - `getLocationContext(payload)`
- [getLocationContext/index.js](/D:/liuliu-minimap/cloudfunctions/getLocationContext/index.js)

当前实现基于高德逆地理编码：

- 接口：`/v3/geocode/regeo`
- 参数：`extensions=all`

返回后会整理出：

- `context`
- `formattedAddress`
- `district`
- `primaryAoiName`
- `primaryAoiType`
- `primaryAoiTypecode`
- `nativeContext`
  - `aois`
  - `businessAreas`
  - `pois`
  - `roads`
  - `addressComponent`

这条链的意义是给生成提供：

- AOI
- 商圈
- 道路
- 附近 POI
- 更接近高德原生语义的地点文案

### 4.3 `ensureGenerationNearbyPlaces()`

这个方法最终会调用：

- [map.js](/D:/liuliu-minimap/miniprogram/services/map.js)
  - `fetchNearbyPois(lat, lng)`
- [fetchNearbyPois/index.js](/D:/liuliu-minimap/cloudfunctions/fetchNearbyPois/index.js)

当前实现基于高德周边搜索：

- 接口：`/v3/place/around`

云函数返回原始 POI 列表，字段包括：

- `name`
- `address`
- `district`
- `city`
- `type`
- `typecode`
- `distance`
- 经纬度

探索页后续会把这份原始结果整理成 `nearbySummary` 和页面上的 `nearbyPlaces`。

### 4.4 `timeContext`

探索页会在本地直接构造时间上下文。

对应方法：

- [index.js](/D:/liuliu-minimap/miniprogram/pages/index/index.js)
  - `buildTimeContext()`

当前字段包括：

- `localTime`
- `hour`
- `timePhase`
- `weekdayType`
- `timeHints`

当前 `timePhase` 使用的是一组业务时间段：

- 清晨
- 上午
- 午后
- 黄昏
- 夜间
- 凌晨

### 4.5 `generationContext`

探索页内部会把这些内容统一组装进 `generationContext`。

对应方法：

- [index.js](/D:/liuliu-minimap/miniprogram/pages/index/index.js)
  - `buildGenerationContext(pageData)`

当前 `generationContext` 的核心组成包括：

- 用户侧字段
  - `mood`
  - `weather`
  - `season`
  - `preference`
- 地点侧字段
  - `locationName`
  - `locationAddress`
  - `locationContext`
  - `sceneTag`
  - `locationContextResponse`
- 时间侧字段
  - `timeContext`
- 附近侧字段
  - `nearbySummary`
  - `nearbyPlaces`
- 上一轮生成结果元信息
  - `generatedThemeCategory`
  - `generatedThemeTitle`
- 原文透传包
  - `contextPacket`

`contextPacket` 是当前调试和后续复用的关键容器，后端和前端都围绕它做读写。

---

## 5. 模式与输入差异

### 5.1 `walkMode`

当前有两种生成模式：

- `pure`
- `advanced`

影响如下：

- `pure`
  - 只生成 1 条任务
  - 只允许 1 个主题
  - `mood / weather / preference` 在输入中会被置空
  - 季节仍保留
- `advanced`
  - 生成 3 条任务
  - 支持单主题和组合主题
  - 心情、天气、偏好参与生成

### 5.2 单主题 vs 组合主题

单主题调用：

- [generateTheme/index.js](/D:/liuliu-minimap/cloudfunctions/generateTheme/index.js)

组合主题调用：

- [generateCombinedTheme/index.js](/D:/liuliu-minimap/cloudfunctions/generateCombinedTheme/index.js)

两条链路共享同一套 shared runtime，但 prompt 文案、任务要求、fallback 主题会各自独立。

---

## 6. 云函数生成链路

### 6.1 模型调用配置

当前模型配置在：

- [generateTheme/config.js](/D:/liuliu-minimap/cloudfunctions/generateTheme/config.js)
- [generateCombinedTheme/config.js](/D:/liuliu-minimap/cloudfunctions/generateCombinedTheme/config.js)

当前使用：

- `baseUrl: https://dashscope.aliyuncs.com/compatible-mode/v1`
- `model: deepseek-v3.2`

所以当前是通过百炼 OpenAI 兼容接口调用 DeepSeek 模型。

### 6.2 真实 AI 请求位置

AI 请求在：

- [generateTheme/ai.js](/D:/liuliu-minimap/cloudfunctions/generateTheme/ai.js)
- [generateCombinedTheme/ai.js](/D:/liuliu-minimap/cloudfunctions/generateCombinedTheme/ai.js)

关键方法：

- `chatJsonWithMeta(systemPrompt, userPrompt)`

当前请求内容：

- `model`
- `temperature`
- `response_format: { type: 'json_object' }`
- `messages`
  - `system`
  - `user`

返回内容包括：

- `parsed`
- `rawText`
- `strippedText`
- `finishReason`
- `responseId`
- `responseModel`
- `usage`

### 6.3 单主题云函数

单主题主入口：

- [generateTheme/index.js](/D:/liuliu-minimap/cloudfunctions/generateTheme/index.js)

流程是：

1. `normalizeSelectedThemes()`
   - 最多保留 1 或 2 个主题
2. `buildDirectFallbackTheme()`
   - 先构造一份本地 fallback
3. `buildDirectPrompt()`
   - 组装当前 prompt
4. `chatJsonWithMeta()`
   - 请求模型
5. `normalizeTheme()`
   - 归一化模型 JSON
6. `finalizeTheme()`
   - shared runtime 收口
7. 返回：
   - `theme`
   - `source: ai-direct`
   - `validation`
   - `modelRequest`
   - `modelResponse`
   - `runtimeVersion`

如果失败，则走：

- `source: ai-direct-fallback`

### 6.4 组合主题云函数

组合主题主入口：

- [generateCombinedTheme/index.js](/D:/liuliu-minimap/cloudfunctions/generateCombinedTheme/index.js)

流程与单主题一致，但在两点上不同：

- `normalizeCategories()` 至少要求 2 个方向
- prompt 里会明确要求主题融合，而不是分别写两个主题

返回：

- `theme`
- `source: combined-direct`
- `combinedCategories`
- `validation`
- `modelRequest`
- `modelResponse`
- `runtimeVersion`

失败时：

- `source: combined-direct-fallback`

---

## 7. 当前 prompt 实际结构

### 7.1 prompt 结构已经改成缓存友好顺序

当前两条生成云函数都把 `user prompt` 调整成四段顺序：

1. `固定协议`
2. `策略输入`
3. `动态上下文`
4. `上下文摘要`

这是为了让固定前缀尽量稳定，方便命中百炼隐式缓存。

### 7.2 `strategyInput`

当前固定或半固定的策略层包括：

- `walkMode`
- `selectedThemes` / `categories`
- `missionCount`
- `generationRules`
- `themeTaskSkeletons`
- `timeTaskSkeletons`

其中：

- `generationRules`
  - 是当前最完整的一组生成约束
- `themeTaskSkeletons`
  - 是主题切入骨架
- `timeTaskSkeletons`
  - 是时间段切入骨架

### 7.3 `dynamicContext`

当前真正变化的现场输入在 `dynamicContext`，包括：

- `mood`
- `weather`
- `season`
- `preference`
- `preferenceGuide`
  - `availableObjects`
  - `blockedObjects`
  - `safeObjects`
  - `objectDetails`
  - `instruction`
- `location`
  - `name`
  - `sceneTag`
- `time`
  - `timePhase`
  - `timeHints`
- `nearby`
  - `nearbyScene`
  - `aoi`
  - `aoiList`
  - `businessAreas`
  - `poiTypes`
  - `pois`
- `previousMissions`

### 7.4 `上下文摘要`

现在 `promptContext.text` 已经不再承担主要规则说明，只保留 4 句左右的简短概括：

- 地点
- 当前时间段
- 附近主语境
- 偏好或无偏好说明

这块的作用已经从“承载大量语义”改成“帮助模型快速建立阅读导向”。

---

## 8. shared runtime 的职责

共享运行时在：

- [generation-runtime.js](/D:/liuliu-minimap/cloudfunctions/shared/generation-runtime.js)

它不是一个小工具文件，而是当前生成链路的真正核心。

### 8.1 上下文归一化

shared runtime 统一负责：

- `normalizeLocationSignals(event)`
- `normalizeTimeContext(event)`
- `normalizeNearbySummary(event)`
- `normalizePreference(event)`
- `normalizeRecentMissionHistory(event)`

这样单主题和组合主题不会各自维护一套解释逻辑。

### 8.2 时间摘要

当前 `timeHints` 不再是把前端原始提示直接塞给模型，而是通过：

- `summarizeCoreTimeHints(timeContext)`

整理成更短的“时间段核心特征摘要”。

### 8.3 偏好对象筛选

shared runtime 负责：

- `buildPreferenceContext(event)`

这一步会：

1. 读取当前偏好对象库
2. 收集高德原生证据
   - AOI
   - POI 类型
   - POI 名称
   - 商圈
   - 时间 / 天气 / 季节
3. 对每个对象候选打分
4. 产出：
   - `availableObjects`
   - `blockedObjects`
   - `safeObjects`
   - `objectDetails`
   - `instruction`

### 8.4 任务骨架

当前骨架已经拆分成两类：

- `buildTaskSkeletonGroups(...)`

返回：

- `themeSkeletons`
- `timeSkeletons`

而 `buildPromptContextBlock()` 还会同时保留：

- `skeletonHints`
  - 主要用于内部和调试兼容

### 8.5 结果收口

无论模型输出如何，最终都会经过：

- `finalizeTheme(theme, event, fallbackTheme, options)`

当前主要职责：

- 补任务数量
- 去重
- 避免与上一轮任务过度相似
- 在需要时补 anchored mission 或 fallback mission
- 记录 finalization 元信息

也就是说，前端拿到的 `theme` 不一定等于模型原始 JSON，而是“模型结果 + 本地收口后的最终版”。

---

## 9. 返回给前端的内容

当前生成云函数返回的不只是主题本身，还包括一整套调试元信息。

核心字段包括：

- `theme`
- `source`
- `validation`
- `runtimeVersion`
- `modelRequest`
- `modelResponse`
- `reason`

其中：

- `modelRequest`
  - 展示这次真正发给模型的完整请求
- `modelResponse`
  - 展示模型原始返回和解析结果
- `validation`
  - 当前 direct 模式下仍保留结构化检查摘要

---

## 10. 前端展示与调试视图

### 10.1 主题卡片展示

探索页收到云函数结果后，会先经过：

- `trimTheme(theme, walkMode)`

它只负责：

- 根据 `walkMode` 裁任务条数
- 生成 `displayGlyph`

不会主动改写任务文本。

最终主题卡片展示组件在：

- [theme-card.wxml](/D:/liuliu-minimap/miniprogram/components/theme-card/theme-card.wxml)

### 10.2 调试信息回写

探索页拿到结果后，会调用：

- `applyGeneratedThemeMetaToContext(...)`

把以下内容写回 `generationContext`：

- `generationSource`
- `generationValidation`
- `generationFinalization`
- `generationModelRequest`
- `generationModelResponse`
- `runtimeVersion`
- `contextPacket.modelRequest`
- `contextPacket.modelResponse`

### 10.3 调试面板展示

探索页再通过：

- `buildGenerationDebugState(generationContext)`

把这些元信息转成前端卡片：

- 结果来源
- 运行时版本
- 验证状态
- 检查说明
- Finalize 改写摘要
- 模型完整输入
- 模型原始返回
- `contextPacket`

当前前端还额外展示了缓存命中信息：

- `缓存命中`
- `缓存命中 Token`

它从 `modelResponse.usage` 中提取：

- `usage.cached_tokens`
- 或 `usage.prompt_tokens_details.cached_tokens`

---

## 11. 生成后的落地分支

### 11.1 单人开始漫步

探索页点击“开始这次漫步”时：

- [index.js](/D:/liuliu-minimap/miniprogram/pages/index/index.js)
  - `handleStartWalk()`

它会调用：

- [walk.js](/D:/liuliu-minimap/miniprogram/services/walk.js)
  - `createWalk(payload)`
- [createWalk/index.js](/D:/liuliu-minimap/cloudfunctions/createWalk/index.js)

写入字段包括：

- `themeSnapshot`
- `themeTitle`
- `generationSource`
- `generationContext`
- `walkMode`
- 位置、轨迹、素材、任务完成状态等

也就是说，生成链路的上下文不会在展示后消失，而是跟着整条单人记录一起落库。

### 11.2 发起同行漫步

探索页点击发起同行时，会调用：

- [team.js](/D:/liuliu-minimap/miniprogram/services/team.js)
  - `createTeamRoom(payload)`
- [createTeamRoom/index.js](/D:/liuliu-minimap/cloudfunctions/createTeamRoom/index.js)

落库到：

- `teamWalkRooms`
- `teamWalkMembers`
- `teamWalkActivities`

同样会写入：

- `themeSnapshot`
- `themeTitle`
- `generationContext`
- `walkMode`
- 位置上下文

这意味着当前 AI 生成结果不仅服务于“当下显示”，也会继续支撑：

- 单人记录页
- 同行房间
- 后续任务执行和贡献提交

---

## 12. 当前真实瓶颈位置

如果从前后链路看当前性能，耗时主要分布在 4 段：

1. 生成前准备
   - `getLocationContext`
   - `fetchNearbyPois`
2. prompt 组装
   - 前端 `buildGenerationPayload`
   - 后端 `buildDirectPrompt / buildPrompt`
3. 模型请求
   - `chatJsonWithMeta()`
4. 返回后前端调试数据展示
   - 大 JSON 序列化
   - 调试卡片渲染

当前项目已经做过的优化包括：

- 地点上下文和附近 POI 并行拉取
- prompt 改成固定协议 / 策略输入 / 动态上下文顺序
- 规则集中放入 `generationRules`
- `timeHints` 改为摘要
- `themeTaskSkeletons` 与 `timeTaskSkeletons` 分离
- 前端增加缓存命中调试字段

---

## 13. 当前链路的调试与排查方法

如果要排查一次生成问题，推荐按这个顺序看：

1. 看前端 `模型完整输入`
   - 确认真正传进模型的 `strategyInput / dynamicContext`
2. 看 `模型原始返回`
   - 确认问题出在模型本身，还是后处理
3. 看 `validation / finalization`
   - 确认是不是 `finalizeTheme()` 改了结果
4. 看 `contextPacket`
   - 确认前端组装上下文时有没有漏字段
5. 看 `缓存命中`
   - 判断本次 prompt 重排是否命中百炼隐式缓存

---

## 14. 后续做“优化前后链路”时最该看的点

如果下一阶段要专门优化前后链路，这份文档建议优先关注 4 个节点：

1. 前端生成前上下文准备
   - `ensureGenerationLocationContext()`
   - `ensureGenerationNearbyPlaces()`
2. 后端 prompt 组装
   - `buildDirectPrompt()`
   - `buildPrompt()`
3. 模型请求
   - `chatJsonWithMeta()`
4. 前端调试渲染
   - `buildGenerationDebugState()`

因为当前体感的等待时间，基本都来自这四段的叠加。

---

## 15. 结论

当前 AI 生成链路已经从“单纯调一个模型”演化成一条完整的前后链路系统：

- 前端负责准备时间、地点、AOI、POI、偏好和上一轮上下文
- 云函数负责 prompt 构建、模型请求、结果归一化与 shared runtime 收口
- 调试层完整暴露模型输入与原始返回
- 生成结果会继续流入单人记录和同行房间

所以后面做“优化前后链路”，重点不该只盯模型时延，而应该把这条完整链路当成一个系统去优化：

- 生成前准备
- prompt 大小
- 模型缓存
- 返回后展示
- 落库复用

