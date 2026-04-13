# AI 主题任务生成优化实现说明

## 1. 文档目的

本文档用于说明当前“AI 生成主题与任务内容”优化已经如何落到代码里，并保留后续仍未完成的建议改进部分。

它和下面两份文档的分工是：

- [AI主题任务内容全流程说明.md](/D:/liuliu-minimap/docs/AI主题任务内容全流程说明.md)
  - 讲完整业务链路：探索页、云函数、落库、记录页复用。
- [AI主题任务RAG优化具体实现.md](/D:/liuliu-minimap/docs/AI主题任务RAG优化具体实现.md)
  - 讲 RAG 检索、排序、计划、调试字段和验证机制。
- 本文档
  - 讲“生成优化”本身已经实现了什么，以及下一步还可以继续做什么。

产品价值背景仍然是“附近”的重建：

- [“附近”的重建参考文章](https://www.thepaper.cn/newsDetail_forward_24823590)

核心代码入口：

- [探索页前端逻辑](/D:/liuliu-minimap/miniprogram/pages/index/index.js)
- [探索页调试面板](/D:/liuliu-minimap/miniprogram/pages/index/index.wxml)
- [主题服务层](/D:/liuliu-minimap/miniprogram/services/theme.js)
- [接口映射层](/D:/liuliu-minimap/miniprogram/services/api.js)
- [单主题生成云函数](/D:/liuliu-minimap/cloudfunctions/generateTheme/index.js)
- [单主题 RAG prompt](/D:/liuliu-minimap/cloudfunctions/generateTheme/rag.js)
- [组合主题生成云函数](/D:/liuliu-minimap/cloudfunctions/generateCombinedTheme/index.js)
- [共享生成运行时](/D:/liuliu-minimap/cloudfunctions/shared/generation-runtime.js)
- [共享 RAG 运行时](/D:/liuliu-minimap/cloudfunctions/shared/generation-rag-runtime.js)
- [运行时同步脚本](/D:/liuliu-minimap/scripts/sync_cloud_generation_runtime.js)

---

## 2. 当前实现结论

当前生成系统已经完成以下收敛：

1. 随机生成和选择生成已经统一后端。
   - 随机生成只在前端随机选一个主题。
   - 后端统一调用 `generateTheme`。
   - `generateRandomTheme` 已删除，不再部署。

2. 生成前已经构造统一 `contextPacket`。
   - 包含地点、时间、季节、用户状态、附近 POI、附近场景等。
   - 单主题、前端随机、组合生成都共用这套上下文。

3. 当前时间已经进入生成上下文。
   - 使用 `localTime / hour / timePhase / weekdayType / timeHints`。
   - 时间段覆盖凌晨、清晨、上午、午后、黄昏、夜间。

4. 附近 POI 已经进入生成链路。
   - 生成前会补齐 `nearbyPlaces`。
   - 再压缩成 `nearbySummary`。
   - RAG 和 prompt 都会使用它。

5. 地点语境已进入生成链路。
   - `getLocationContext()` 会在探索点确认和生成前补齐时调用。
   - 结果进入 `contextPacket.location.sceneTag`。

6. 纯粹模式已经和进阶模式区分上下文。
   - 纯粹模式会把 `mood / preference / weather.label` 置空。
   - 纯粹模式仍然根据当前日期推断 `season`。
   - 纯粹模式仍然传入 `selectedThemes` 和 `walkMode`。

7. RAG 已经从“样例参考”升级为“生成计划”。
   - 返回 `ragPlan / ragDebug / ragModelInput`。
   - `ragModelInput` 不再把样例原句直接交给模型。
   - `ragModelInput` 现在只保留最小必要入模信息，如 `targetThemes / time / nearby / sceneCards / themeReferences`。

8. 校验机制已经统一。
   - 纯粹模式、进阶模式、组合模式都走 `summarizeThemeValidation()`。
   - `summarizeThemeValidation()` 现在只做结构预检。
   - 主题是否命中、是否跑偏、是否需要重写，改为每次都由 AI 复核判断。

9. 探索页已经支持生成调试面板。
   - 可查看 `contextPacket`。
   - 可查看 `rag.plan`。
   - 可查看 `rag.debug`。
   - 可查看 `rag.modelInput`。
   - 可查看 `validation` 和 `source`。

10. 五个单主题已经完成一次统一排查与修正。
   - 排查范围覆盖 `形状 / 色彩 / 声音 / 数字 / 气味`。
   - 现在不只修“形状混数字”，而是统一处理“真正串味”和“规则误判”两类问题。
   - 单主题 RAG 会尽量只向模型暴露与当前主题直接相关的 `sceneHints / angles / antiPatterns`。

---

## 3. 生成入口实现

### 3.1 服务层

主题服务层目前只保留三个接口：

- `generateTheme(payload)`
- `generateCombinedTheme(payload)`
- `verifyMission(payload)`

对应文件：

- [miniprogram/services/theme.js](/D:/liuliu-minimap/miniprogram/services/theme.js)

接口映射层只保留两个主题生成 endpoint：

- `generateTheme`
- `generateCombinedTheme`

对应文件：

- [miniprogram/services/api.js](/D:/liuliu-minimap/miniprogram/services/api.js)

已删除旧接口：

- `generateRandomTheme`
- `/ai/themes/preset`

### 3.2 随机生成

探索页 `handleRandomTheme()` 当前流程：

1. 校验是否已确认探索点。
2. 从 `randomCategories` 随机挑一个主题。
3. 转成 `selectedThemes`。
4. 调用 `buildGenerationPayload()`。
5. 调用 `generateTheme()`。
6. 将 source 显示转换为 `random+ai / random-fallback`。

这表示随机生成和选择生成在后端生成逻辑上已经完全统一。

### 3.3 选择生成

探索页 `handleSelectedThemeGenerate()` 当前流程：

1. 读取 `combineSelections`。
2. 按 `walkMode` 限制主题数量。
3. 纯粹模式或单主题时，调用 `generateTheme()`。
4. 进阶模式双主题时，调用 `generateCombinedTheme()`。

### 3.4 AI 生成按钮

探索页 `handleGenerateTheme()` 当前流程：

1. 如果进阶模式选择了两个主题，调用 `generateCombinedTheme()`。
2. 否则调用 `generateTheme()`。
3. 如果没有显式选择主题，前端会先随机补一个主题方向。

---

## 4. contextPacket 实现

统一上下文在探索页 `buildGenerationPayload()` 中生成。

它会先并行补齐：

- `ensureGenerationLocationContext()`
- `ensureGenerationNearbyPlaces()`

然后输出：

- 平铺字段
- `generationContext`
- `generationContext.contextPacket`

### 4.1 location

`contextPacket.location` 包含：

- `name`
- `address`
- `latitude`
- `longitude`
- `sceneTag`

字段来源：

- 探索页当前选点
- 高德逆地理结果
- `getLocationContext()` 的语境结果

### 4.2 time

`contextPacket.time` 来自 `buildTimeContext()`。

字段包括：

- `localTime`
- `hour`
- `timePhase`
- `weekdayType`
- `timeHints`

当前时间段配置在 `TIME_PHASE_CONFIGS`。

每个时间段都有更丰富的描述，例子：

- 凌晨：人少、值守、清扫、补货、亮着的窗口、安全保守。
- 清晨：湿气、晨光、早餐摊、晨练、街道启动。
- 上午：通勤、办事、店铺进入工作状态、短暂停顿。
- 午后：直接光照、找阴凉、午饭午休、体感线索。
- 黄昏：回程、等人、亮灯前后、门口与转角停顿。
- 夜间：招牌、窗口、便利店、夜宵、亮面和声音层次。

### 4.3 weather

`contextPacket.weather` 包含：

- `label`
- `season`

纯粹模式规则：

- `label` 置空
- `season` 由当前日期推断

进阶模式规则：

- `label` 来自用户选择
- `season` 优先来自用户选择，没有则由日期推断

### 4.4 userState

`contextPacket.userState` 包含：

- `mood`
- `preference`
- `selectedThemes`
- `walkMode`
- `generatedThemeCategory`
- `generatedThemeTitle`

纯粹模式规则：

- `mood` 置空
- `preference` 置空
- `selectedThemes` 保留
- `walkMode` 保留

### 4.5 nearby

`contextPacket.nearby` 来自 `buildNearbySummary()`。

字段包括：

- `poiNames`
- `poiTypes`
- `dominantScene`
- `dominantSceneId`
- `sceneCandidates`
- `activityHints`

其中：

- `poiNames` 来自附近 POI 名称，最多保留 8 个去重结果。
- `poiTypes` 来自 POI 类型，优先取 `typeSecondary / typePrimary / type`。
- `dominantScene` 来自本地场景规则评分，不是地图接口直接返回字段。
- `sceneCandidates` 是候选场景前三名。
- `activityHints` 由场景规则、POI 文本和当前时间段共同推断。

---

## 5. 附近场景推断实现

探索页当前维护 `NEARBY_SCENE_RULES`，用于把 POI 和地点语境推断为“附近场景”。

当前覆盖场景包括：

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

评分逻辑：

- `sceneTag` 命中场景关键词会加分。
- POI 名称、地址、类型命中场景关键词会加分。
- 距离越近权重越高。
- 排名越靠前的 POI 权重越高。

如果出现 `dominantScene` 和实际不搭，优先排查：

- 附近 POI 是否足够多。
- POI 类型是否太粗。
- `sceneTag` 是否误导。
- `sceneCandidates` 前几名分差是否很小。
- 当前场景规则是否缺少对应类型。

---

## 6. RAG 生成实现

共享 RAG 入口：

- `buildUnifiedRetrievalContext()`

所在文件：

- [cloudfunctions/shared/generation-rag-runtime.js](/D:/liuliu-minimap/cloudfunctions/shared/generation-rag-runtime.js)

两个云函数都会使用：

- `generateTheme`
- `generateCombinedTheme`

RAG 当前会输出：

- `selectedThemes`
- `requestedCategories`
- `timeContext`
- `nearbySummary`
- `scenes`
- `categories`
- `referenceMissions`
- `generationIntent`
- `generationPlan`
- `ragDebug`

最新补充行为：

- `referenceMissions.angle` 优先使用人类可读角度，不再优先暴露内部模板 id。
- 单主题场景提示会先做主题过滤，再进入 `ragModelInput.scenes[].missionHints`。
- 如果已经存在明确命中主题的场景提示，就不会再混入“中性但容易带偏”的提示。

更多 RAG 细节见：

- [AI主题任务RAG优化具体实现.md](/D:/liuliu-minimap/docs/AI主题任务RAG优化具体实现.md)

---

## 7. Prompt 优化实现

### 7.1 单主题 prompt

单主题 prompt 已经加入：

- 当前地点
- 当前时间段
- 时间线索
- 附近场景
- 附近 POI
- 附近活动线索
- 任务骨架
- RAG 入模内容
- RAG 计划
- 变化种子 `generationSeed`

关键约束：

- 必须明显体现地点语境、时间段和附近场景。
- 如果用户选了主题，任务必须命中主题。
- 未选声音时，不要把声音当任务重点。
- 未选色彩时，不要把颜色、色块、反光、色温当核心动作。
- 未选气味时，不要把闻味道、香气、热气、潮气当核心动作。
- 数字主题必须直接涉及数字形状、数量统计、数字变体或数字行动线索。
- 形状主题允许借光影帮助看清轮廓，但重点仍必须落在形状。
- 数字主题允许出现“像数字的形状”，但重点必须落在数字判断，而不是只谈形状本身。
- 任务要短、清楚、可执行。
- 同一地点重复生成时，要根据 `generationSeed` 改变动作、锚点或观察角度。
- 不要复用知识库样例句。

### 7.2 组合主题 prompt

组合主题 prompt 已经加入：

- 组合方向
- 统一上下文块
- RAG 参考上下文
- 组合生成计划
- categoryPlans
- missionBlueprints
- antiPatterns
- 变化种子 `generationSeed`

关键约束：

- 两个主题要真正融合，不要各写各的。
- 不要引入第三个无关主题。
- 三个任务切入角度尽量不同。
- 至少一个任务要呼应附近 POI 或活动线索。
- 至少一个任务要体现两个方向交集。
- RAG 只提供结构、角度、线索和锚点，不要照抄样例句。

---

## 8. 输出收口实现

共享收口逻辑在：

- `finalizeTheme()`

所在文件：

- [cloudfunctions/shared/generation-runtime.js](/D:/liuliu-minimap/cloudfunctions/shared/generation-runtime.js)

它会处理：

- 标题长度
- 描述长度
- 任务长度
- 任务数量
- 相似任务去重
- fallback 任务补齐
- 主题命中不足时用 fallback 补齐
- 缺少在地锚点时补锚点任务

当前数量规则：

- 纯粹模式：1 条任务
- 进阶模式：3 条任务

当前长度倾向：

- 标题尽量短。
- 描述压到 32 字以内。
- 纯粹模式任务不写成长段落。
- 进阶模式任务尽量短而清楚。

---

## 9. 验证机制实现

统一校验入口：

- `summarizeThemeValidation()`

它当前只做结构预检，不再承担最终主题判定。

预检内容包括：

- 任务条数是否正确。
- 是否存在明显过泛任务。
- 进阶模式任务之间是否过于相似。
- 结构预检分数是否低于参考线。

不再作为硬规则检查的内容：

- 任务里是否直接出现地点表述。
- 是否必须显式带 POI 或场景锚点。
- 是否靠关键词命中来判断最终主题是否正确。

### 9.1 纯粹模式

纯粹模式结构预检倾向：

- 任务条数正确。
- 唯一任务不能泛化。

### 9.2 进阶模式

进阶模式结构预检倾向：

- 任务条数正确。
- 任务之间不能太像。

### 9.3 组合模式

组合模式会传入 `combined: true`。

它在预检阶段主要检查：

- 任务结构是否完整。
- 是否任务过泛。
- 是否任务之间过于相似。

### 9.4 AI 二次复核

现在不是“按需二次复核”，而是每次生成后都跑一次 AI 复核。

AI 复核负责：

- 判断是否真正命中主题。
- 判断是否存在跨主题跑偏。
- 判断任务是否仍然过泛。
- 判断是否需要局部重写。
- 结合上下文和时间段判断内容是否贴题。

二次复核可能返回：

- `aiOk`
- `aiScore`
- `aiReasons`
- `aiShouldRewrite`
- `secondaryValidationUsed`
- `secondaryValidationError`

如果 AI 建议重写，并返回 `rewrittenTheme`，云函数会局部合并后再交给 `finalizeTheme()`。

---

## 10. 前端调试实现

探索页已经加入“生成调试”开关。

对应文件：

- [miniprogram/pages/index/index.wxml](/D:/liuliu-minimap/miniprogram/pages/index/index.wxml)
- [miniprogram/pages/index/index.wxss](/D:/liuliu-minimap/miniprogram/pages/index/index.wxss)
- [miniprogram/pages/index/index.js](/D:/liuliu-minimap/miniprogram/pages/index/index.js)

当前调试面板展示：

- 摘要卡片
- RAG 字段说明
- `rag.plan`
- `rag.debug`
- `rag.modelInput`
- `contextPacket`

关键字段解释：

- `source`
  - 判断是 `rag+ai`、`rag-fallback`、`random+ai`、`random-fallback`、`combined+ai`、`combined-fallback`。
- `validation`
  - 判断结构预检和 AI 复核结果。
- `runtimeVersion`
  - 判断云函数是否是最新部署版本。
- `rag.plan.targetThemes`
  - 判断本次主题是否和用户选择一致。
- `rag.plan.chosenScene`
  - 判断 RAG 主场景是否符合附近。
- `rag.debug.sceneCoverage`
  - 判断候选场景分数和分数来源。
- `rag.modelInput`
  - 判断模型到底看到了哪些 RAG 内容。
- `contextPacket`
  - 判断本次真正传给 AI 的地点、时间、附近和用户状态是否正确。

当前建议重点核对：

- `rag.modelInput.targetThemes`
  - 是否和当前选择主题一致。
- `rag.modelInput.sceneCards`
  - 是否仍混入明显无关场景提示。
- `rag.modelInput.themeReferences`
  - 是否已经只保留当前主题真正有用的角度和 cues。
- `validation.aiReasons`
  - AI 复核给出的失败或重写原因是否合理。

---

## 11. 同步脚本实现

共享源码：

- `cloudfunctions/shared/generation-runtime.js`
- `cloudfunctions/shared/generation-rag-runtime.js`

云函数运行副本：

- `cloudfunctions/generateTheme/runtime.js`
- `cloudfunctions/generateTheme/rag-runtime.js`
- `cloudfunctions/generateCombinedTheme/runtime.js`
- `cloudfunctions/generateCombinedTheme/rag-runtime.js`

同步命令：

```bash
node scripts/sync_cloud_generation_runtime.js
```

当前脚本只同步：

- `generateTheme`
- `generateCombinedTheme`

不会同步：

- `generateRandomTheme`

修改 shared runtime 后，需要：

1. 运行同步脚本。
2. 重新部署 `generateTheme`。
3. 重新部署 `generateCombinedTheme`。

如果云环境中仍有旧 `generateRandomTheme`，需要在云开发控制台或部署工具里手动下线。

---

## 12. 当前已解决的问题

### 12.1 时间和任务不匹配

已解决方式：

- 前端传 `timeContext`。
- 时间段细分为 6 档。
- 每档都有更丰富 `timeHints`。
- RAG 和 prompt 都使用时间上下文。

### 12.2 纯粹模式太受进阶选项影响

已解决方式：

- 纯粹模式 `weather.label` 置空。
- 纯粹模式 `preference` 置空。
- 纯粹模式 `mood` 置空。
- 纯粹模式仍保留季节、主题和模式。

### 12.3 POI 已进入模型

已解决方式：

- 生成前确保附近 POI 存在。
- 构造 `nearbySummary`。
- 进入 `contextPacket.nearby`。
- 进入 RAG 检索和 prompt。

### 12.4 RAG 和实际情况对不上难排查

已解决方式：

- 增加 `sceneCandidates`。
- 增加 `ragDebug.sceneCoverage`。
- 增加分数拆解 `scoreBreakdown`。
- 前端显示 `rag.plan / rag.debug / rag.modelInput`。

### 12.5 生成内容像照着 sample 改

已解决方式：

- `ragModelInput` 去掉样例原句。
- prompt 明确禁止复用样例句。
- `ragModelInput` 进一步瘦身，只保留 `targetThemes / time / nearby / sceneCards / themeReferences`。

### 12.6 随机生成和选择生成后端不一致

已解决方式：

- 删除 `generateRandomTheme`。
- 删除服务层旧 endpoint。
- 同步脚本不再同步旧随机云函数。
- 前端随机选主题后调用 `generateTheme`。

### 12.7 其他主题也存在串味与误判

已解决方式：

- 对 `形状 / 色彩 / 声音 / 数字 / 气味` 五个单主题统一做模板审计。
- 为色彩、声音、数字、气味补齐可读 `angles` 与 `antiPatterns`。
- 单主题场景提示增加主题过滤，减少把别的主题提示喂给模型。
- 场景库里几条天然混双主题的 hint 已拆干净，例如景区数字提示、夜市形状提示、滨水色彩提示。
- 最终主题校验改为 AI 主校验，避免关键词误判。
- 不再因为缺少地点表述就把任务判失败或强制改写。

---

## 13. 仍未完全实现的建议改进

### 13.1 扩充 POI 场景规则

当前 `NEARBY_SCENE_RULES` 已覆盖 10 类场景，但还可以继续增加：

- 夜间餐饮停留带
- 雨天街区反光带
- 旅游服务与排队等候带
- 老旧社区修补带
- 城市边缘混合业态带
- 办公楼下短暂停留带
- 商场内外过渡带
- 学校放学接送带

目标：

- 降低 `dominantScene` 与实际直觉不搭的概率。
- 让 `activityHints` 更像真实附近动作。

### 13.2 扩充主题 angle 库

每个主题还可以继续扩充更多角度。

形状：

- 轮廓
- 弧度
- 重复
- 边界
- 对称
- 临时形状

色彩：

- 色块
- 渐变
- 冷暖
- 反光
- 明暗
- 材质色差

声音：

- 连续背景声
- 突发声
- 回响
- 节奏
- 远近层次
- 被动作触发的声音

数字：

- 像数字的形状
- 数量统计
- 数字变体
- 数字行动线索
- 排号与倒计时
- 楼层、门牌、出口号

气味：

- 来源
- 扩散
- 停留
- 冷热交界
- 气味记忆
- 食物、草木、消毒水、潮气等细分来源

### 13.3 降低 fallback 重复感

当前 AI 成功时已经尽量避免照抄样例，但 fallback 仍可能来自模板样例池。

建议继续改进：

- fallback 也改成“角度 + 锚点 + 骨架”的组合生成。
- fallback 增加 `generationSeed` 参与随机。
- fallback 针对同一地点保留最近输出去重。
- fallback 将样例句拆成动作、对象、观察重点，而不是整句复用。

### 13.4 建 bad case 库

建议维护一份 bad case 表。

字段可以包括：

- 生成时间
- 地点
- 主题
- walkMode
- source
- validation score
- contextPacket
- ragPlan
- ragDebug
- ragModelInput
- 失败原因
- 人工建议修复方向

目标：

- 不靠主观记忆优化 prompt。
- 用实际失败样本反推 RAG 规则和模板库。

### 13.5 增加生成质量埋点

建议后续记录：

- `source`
- `runtimeVersion`
- `validation.ok`
- `validation.score`
- `ragDebug.retrievalQuality`
- `ragPlan.targetThemes`
- `ragPlan.chosenScene`
- 是否用户重新生成
- 是否用户开始漫步

目标：

- 判断优化是否真的提升开始漫步转化。
- 统计哪些主题、场景、时段最容易失败。

### 13.6 进一步优化 AI 二次复核

当前 AI 复核已经改成每次都跑一次。

后续可以继续优化：

- 只让 AI 复核具体失败项，而不是整包复核。
- 把重写限制在失败任务上。
- 将 AI 复核结果写入 bad case 库。
- 对二次复核失败的结果返回更明确 `repairReason`。

### 13.7 Web 后端完全复刻小程序生成能力

当前 Web 共用接口的基础字段能对齐，但如果要完全复刻小程序当前效果，Web 后端需要继续兼容：

- `generationContext.contextPacket`
- `timeContext`
- `nearbySummary`
- `generationSeed`
- `ragPlan`
- `ragDebug`
- `ragModelInput`
- `validation`

否则 Web 模式下可能只能做到“基础生成可用”，但无法完全复刻当前小程序云函数链路的上下文质量和调试能力。

### 13.8 推荐升级为“Grounding -> Plan -> Writing -> Validation”四层流水线

当前已经做过一轮“减少 sample 影响、放宽单主题 RAG”的优化，但从最近表现看，系统仍然会在两种状态之间摇摆：

- RAG 给得偏具体时，输出更稳，但容易反复落回少数句式
- RAG 放得偏自由时，输出更活，但更容易抽象、重复或跑虚

因此后续最推荐的方向，不是继续单纯加 prompt 或继续单纯删 RAG，而是把生成链路升级成四层：

1. `Grounding`
   - 只提供地点、时间、附近、场景、POI、活动线索和安全边界
   - 不再直接给单主题写作层喂任务样例句

2. `Plan`
   - 显式决定这次的 `theme / scene / anchor / actionType / observationAngle / avoidPhrases`
   - 同时读入 `recentMissionHistory`，先在计划层做跨次去重

3. `Writing`
   - 只根据 `missionPlan` 写标题、描述和任务
   - 强制任务落到具体对象和明确动作上

4. `Validation`
   - AI 复核输出稳定的 `score / comment / rewriteAdvice / suggestedRewrite`
   - 失败时尽量只改失败任务，而不是整包重来

这个方向的完整设计见：

- [AI主题任务RAG优化方案.md](/D:/liuliu-minimap/docs/AI主题任务RAG优化方案.md)

如果后续继续做生成质量优化，优先级建议是：

1. 单主题彻底改成 `Grounding + missionPlan` 生成
2. 增加 `recentMissionHistory` 跨次去重
3. 主题动作池与动作冷却机制
4. AI 复核返回结构化分数、评语和建议改写内容

---

## 14. 验收建议

后续验收不应只看文案是否好看，而应按这几类检查。

### 14.1 主题命中

- 数字主题是否明确出现数字形状、数量、变体或行动线索。
- 声音主题是否明确出现声音来源、层次或节奏。
- 气味主题是否明确出现来源、扩散或停留。
- 单主题是否混入未选方向。
- 双主题是否真的融合，而不是各写各的。

### 14.2 时间命中

- 清晨是否像清晨。
- 黄昏是否像黄昏。
- 夜间是否像夜间。
- 凌晨是否更安全、更克制。

### 14.3 附近命中

- 任务是否呼应 POI、活动线索、场景标签。
- `chosenScene` 是否和 `sceneCandidates` 合理。
- `dominantScene` 是否和真实地点直觉一致。

### 14.4 可读性

- 纯粹模式是否一眼能懂。
- 任务是否短而明确。
- description 是否没有重复任务。
- 进阶模式 3 条任务是否角度不同。

### 14.5 调试可解释性

- 前端能否看到 `contextPacket`。
- 前端能否看到 `rag.plan`。
- 前端能否看到 `rag.debug`。
- 前端能否看到 `rag.modelInput`。
- validation 是否返回清楚的原因。

---

## 15. 结论

当前 AI 主题任务生成优化已经从“方案讨论”进入“可调试的实现状态”。

已经落地的核心变化是：

- 不再维护独立随机生成后端。
- 所有生成入口共享结构化上下文。
- 时间、附近 POI、地点语境已经进入生成链路。
- 纯粹模式和进阶模式有明确上下文差异。
- RAG 不再只给模型 sample，而是给精简后的入模上下文和生成计划。
- 结构预检和每次 AI 复核已经统一。
- 前端能看到本次真正传给 AI 的上下文与 RAG 入模内容。

后续最值得继续做的不是继续堆 prompt，而是：

- 扩充场景规则。
- 扩充主题角度库。
- 降低 fallback 重复感。
- 建 bad case 库。
- 做生成质量埋点。

一句话概括：

- 当前版本已经能让 AI 更像是在“此刻、此地、附近”里生成任务。
- 当前版本也已经把五个单主题的串味问题做过一轮统一收敛。
- 下一步要让它更稳定、更丰富，并且能被持续评估。
