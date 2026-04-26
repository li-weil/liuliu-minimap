# AI 主题任务内容全流程说明

本文档说明小程序现在如何生成 AI 主题和任务。

现在的方案已经去掉早期的主题 RAG、AI 二次验证和 AI 改写循环。流程更简单：前端整理基础上下文，云函数生成完整 prompt，模型直接返回主题卡片 JSON。云函数只做结构检查；模型失败或任务数量不足时，再用本地 fallback 补齐。

## 1. 方案总览

主流程是：

1. 用户在探索页选择生成方式。
2. 前端确认探索点、时间、天气、模式、主题、偏好和附近 AOI 等上下文。
3. 前端通过 `services/theme.js` 调用 `callApi()`；默认云开发模式下落到云函数 `generateTheme` / `generateCombinedTheme`，Web 模式且 endpoint 可用时走 `/api/v1/ai/themes/generate` / `/api/v1/ai/themes/combine`。
4. 云函数或 Web 后端根据上下文构造模型输入，包括 system prompt、固定协议、生成规则、策略输入、动态上下文、上下文摘要和返回格式。
5. 模型直接生成主题内容 JSON。
6. 云函数或 Web 后端解析 JSON，做轻量结构检查。
7. 如果模型返回任务数量不足或请求失败，用本地 fallback 补足。
8. 前端展示主题卡片；调试开关打开时，可以查看模型输入和原始返回。

不再使用：

- 主题 RAG 检索。
- AI 二次验证。
- AI 改写循环。
- finalize AI。
- dominantScene / sceneId 场景体系。
- 将 POI 作为主要约束输入给模型。

仍然保留：

- 偏好对象逻辑中的轻量 instruction。
- 本地结构检查。
- 任务不足或模型失败时的 fallback。
- 调试面板中的完整模型输入、模型输出、结构检查和关键上下文。

## 2. 前端入口

主要代码在：

- `miniprogram/pages/index/index.js`
- `miniprogram/services/api.js`

### 2.1 主题方向与随机选项

探索页现在只有一个生成入口：

```js
handleSelectedThemeGenerate()
```

行为：

- 用户必须先设定探索点。
- 用户必须先选择主题方向；“随机”只是一个主题选项。
- 选择“随机”时，前端会从形状、色彩、声音、数字、气味中抽一个真实主题，然后继续调用单主题生成。
- 后端只接收确定后的主题，不再提供独立随机主题接口。

source 标签保持云函数返回值：

- `ai-direct-raw`
- `ai-direct-partial-fallback`
- `ai-direct-fallback`
- `combined-direct-raw`
- `combined-direct-partial-fallback`
- `combined-direct-fallback`
- `combined-direct-error`

### 2.2 选择生成

入口函数：

```js
handleSelectedThemeGenerate()
```

行为：

- 用户必须先选择主题。
- 如果没有选择主题，前端直接提示 `请先选择主题`，不会再自动随机选择。
- 纯粹模式下只允许单主题生成。
- 进阶模式下：
  - 选择一个主题时，通过 service 调用单主题生成链路。
  - 选择多个主题时，通过 service 调用组合主题生成链路。

## 3. 生成等待状态

前端使用全局 `generationStage` 做阶段式 loading。

阶段顺序：

1. `正在读取探索点附近的街区信息`
2. `正在整理时间、地点和主题线索`
3. `正在生成今天的任务票据`

展示规则：

- 阶段切换用连续进度条，不做生硬跳段。
- 前置阶段会优先复用已经准备好的探索点、附近地点和时间上下文。
- 如果等待超过轻量阈值，会显示：

```text
66 正在加速赶来，请耐心等待
```

失败时统一显示：

```text
66 迷路啦，请再次尝试生成
```

## 4. 前端上下文

核心函数：

```js
buildGenerationPayload(basePayload)
```

它负责把页面状态整理成云函数入参。主要包括：

- 当前探索点。
- 当前时间段。
- 天气和季节。
- 用户心情。
- 用户偏好。
- 当前选择主题。
- 漫步模式。
- 附近 AOI 信息。
- 历史生成任务。
- 调试用 `contextPacket`。

### 4.1 时间

前端会生成 `timeContext`，包括：

- 当前时间段。
- 日期类型。
- 适合当前时间段的时间线索。
- 与天气组合后的时间骨架。

时间骨架不直接生成主题，只描述当前时段可能出现的城市线索，例如“谁还在运转”“哪里开始收摊”“哪里显得更安静”。

### 4.2 地点

地点信息主要来自高德逆地理结果，不依赖普通周边 POI 检索。

前端仍会整理地点上下文，重点字段包括：

- `location.name`
- `location.region`
- `nearby.aoi`
- `nearby.aoiList`
- `nearby.aoiTypes`
- `nearby.businessAreas`

处理方式：

- 这些字段保留在前端上下文、调试视图和 fallback 可用信息中。
- `location.name` 不进入模型 prompt。它太具体，容易让任务被某个建筑、食堂、店铺或入口限制住。
- `location.region` 会进入 prompt，提供省市区这类粗粒度地区语境。
- `nearby.aoi`、`nearby.aoiList`、`nearby.aoiTypes`、`nearby.businessAreas` 仍会进入 prompt，作为轻量场域参考。
- 不再把 `location.sceneTag` 传给模型。
- 不再把 `nearby.nearbyScene` 传给模型。
- 不再向模型强调“附近语境以某某为主”。
- 不再把 POI 列表作为主要 prompt 约束。
- 现在的生成更依赖主题、时间、天气、偏好、任务骨架、省市区和 AOI 语境，避免被具体点位名带偏。

### 4.3 `contextPacket` 的作用

`contextPacket` 是前端整理出的结构化上下文包，主要用来：

- 给云函数提供原始上下文。
- 给调试视图展示前端传入的基础信息。
- 方便排查模型输入之前的上下文是否正确。

但它不是最终直接提交给模型的完整内容。

真正提交给模型的是云函数生成的：

```js
modelRequest.request.messages
```

两者关系：

- `contextPacket` 是原料。
- 云函数把 `contextPacket` 和其他 event 字段重新组织成 prompt。
- `modelRequest.request.messages` 才是最终模型输入。

## 5. 云函数入口

单主题云函数：

```text
cloudfunctions/generateTheme/index.js
```

组合主题云函数：

```text
cloudfunctions/generateCombinedTheme/index.js
```

共享运行时：

```text
cloudfunctions/shared/generation-runtime.js
```

同步后的运行时副本：

```text
cloudfunctions/generateTheme/runtime.js
cloudfunctions/generateCombinedTheme/runtime.js
```

同步脚本：

```text
scripts/sync_cloud_generation_runtime.js
```

当修改共享规则、骨架、fallback、上下文构造逻辑后，需要运行：

```powershell
node scripts\sync_cloud_generation_runtime.js
```

然后重新部署：

- `generateTheme`
- `generateCombinedTheme`

## 6. 云函数生成流程

### 6.1 单主题生成

核心流程：

```js
normalizeSelectedThemes()
buildPreparedRuntimeContext()
buildDirectPrompt()
chatJsonWithMeta()
ensureThemeMissions()
summarizeStructureCheck()
```

返回字段包括：

- `theme`
- `source`
- `structureCheck`
- `runtimeVersion`
- `modelRequest`
- `modelResponse`
- `reason`

### 6.2 组合主题生成

核心流程：

```js
normalizeCategories()
buildPreparedRuntimeContext()
buildPrompt()
chatJsonWithMeta()
ensureThemeMissions()
summarizeStructureCheck()
```

组合主题要求至少两个主题。如果主题数量不足，会返回 `combined-direct-error`。

返回字段包括：

- `theme`
- `source`
- `combinedCategories`
- `structureCheck`
- `runtimeVersion`
- `modelRequest`
- `modelResponse`
- `reason`

## 7. 真正提交给模型的内容

模型输入由云函数组装，不是前端直接拼接。

最终结构是 Chat Completions messages：

```js
[
  {
    role: 'system',
    content: '你是遛遛小程序的城市漫步策划助手。只返回合法 JSON，不要输出额外解释。'
  },
  {
    role: 'user',
    content: '完整用户 prompt'
  }
]
```

组合主题使用类似的 system prompt：

```text
你是遛遛小程序的组合主题策划助手。只返回合法 JSON，不要输出额外解释。
```

### 7.1 固定协议

固定协议位于 prompt 前部，用于提高隐式 prompt cache 命中率，也让模型优先看到稳定规则。

固定协议包含：

- `outputContract`
- `rulePriority`
- `contextPriority`
- `conflictPolicy`
- `generationRules`

其中 `generationRules` 是主要约束规则，当前已经从上下文摘要中移出，集中放在固定协议内。

### 7.2 策略输入

策略输入描述这次生成的任务策略：

- `walkMode`
- `selectedThemes` 或 `categories`
- `missionCount`
- `themeTaskSkeletons`
- `timeTaskSkeletons`

`themeTaskSkeletons` 和 `timeTaskSkeletons` 是分开的字段：

- `themeTaskSkeletons`：来自主题骨架。
- `timeTaskSkeletons`：来自时间段和天气组合骨架。

### 7.3 动态上下文

动态上下文包含当次生成变化较大的信息，但不再包含过于具体的当前地点名。

当前进入模型的动态字段主要是：

- `mood`
- `weather`
- `season`
- `preference`
- `preferenceGuide.instruction`
- `region`
- `time.timePhase`
- `time.timeHints`
- `nearby.aoi`
- `nearby.aoiList`
- `nearby.aoiTypes`
- `nearby.businessAreas`
- `previousMissions`

注意：

- 不再传入大量编码类数据给模型。
- 不再把 typecode、matchedNativeCodes 等编码字段塞进 prompt。
- 不再把 `location.name` 这类具体点名塞进 prompt。
- 保留 `region`，让模型知道省市区层面的城市语境。
- AOI 和商圈只作为基本场域参考，不要求模型机械复述。
- 模型主要依据中文文本理解语境。
- `previousMissions` 用于减少连续重复。

### 7.4 上下文摘要

上下文摘要现在只保留很短的任务概括，不再承载完整生成规则。

当前摘要主要说明：

- 当前时间段。
- 偏好情况。
- 任务应该短、真实、可执行。

过去摘要里重复出现的生成要求、地点名、AOI 列表、骨架内容等已经移除或移动到对应 JSON 字段。当前摘要不再写入具体当前位置名称。

## 8. 模型调用

模型调用文件：

```text
cloudfunctions/generateTheme/ai.js
cloudfunctions/generateCombinedTheme/ai.js
```

接口形态：

- 使用 DashScope 兼容 OpenAI Chat Completions 的接口格式。
- 默认 base URL：

```text
https://dashscope.aliyuncs.com/compatible-mode/v1
```

模型配置来源：

1. 环境变量 `AI_CHAT_MODEL`
2. 本地配置文件中的 `model`
3. 代码默认模型

当前代码默认模型：

```text
deepseek-v3.2
```

但模型不是由页面业务逻辑决定的。实际线上使用哪个模型，以云函数环境变量、云端配置和调试面板中的 `modelRequest.request.model` 为准。历史文档里出现过 `qwen3.5-plus` 推荐口径，当前不要把它当成代码默认值。

部署时应通过环境变量或云函数安全配置指定模型与密钥，避免把密钥和敏感配置写入仓库。

关键请求参数：

- `response_format: { type: 'json_object' }`
- 单主题温度偏高，鼓励自然变化。
- 组合主题温度更高，避免组合结果过于模板化。
- 请求超时由环境变量或配置控制。

模型返回后会记录：

- `rawText`
- `strippedText`
- `parsed`
- `finishReason`
- `responseId`
- `responseModel`
- `usage`

这些信息会进入前端调试视图，方便确认“模型到底返回了什么”。

## 9. 任务骨架逻辑

任务骨架由共享运行时生成：

```js
buildTaskSkeletonGroups()
```

当前设计：

- 单主题使用对应主题的骨架库。
- 组合主题不再传单主题骨架，使用组合基础骨架。
- 时间骨架来自时间段和天气组合。
- 骨架会根据 `generationSeed` 做轮转，避免每次固定取前几条。
- 主题骨架和时间骨架分别放进 prompt 的不同字段。

当前不再使用：

```js
buildTaskSkeletonHints()
```

该旧函数已经被移除，避免出现两套骨架入口。

## 10. 偏好逻辑

偏好包括：

- 自然景观
- 人文历史
- 市井烟火

当前 prompt 不再给模型塞完整偏好对象列表，而是保留轻量 instruction。

原因：

- 对象库过多会挤占 prompt。
- 对象库过强会让模型机械套用。
- 当前位置 POI 不稳定时，强绑定对象反而会导致错误任务。

当前偏好主要用于影响任务对象方向，而不是作为硬性验证规则。

纯粹模式没有偏好，prompt 不会强行写入某一类偏好对象。

## 11. 地点信息策略

当前地点策略已经从“POI 强约束”收敛为“去掉具体地点名，保留省市区和 AOI 场域参考”。

### 11.1 为什么不强依赖 POI

高德逆地理 POI 和周边 POI 存在明显偏向：

- 餐饮和生活服务经常排在前面。
- 著名景点、校园、园区等代表性地点不一定靠前。
- 不指定类型时，结果不一定覆盖风景名胜。
- 指定类型时能取到代表性地点，但不适合作为通用生成流程。

因此当前 prompt 不再把 POI 作为核心输入。

### 11.2 AOI 的使用方式

AOI 仍然更适合表达用户所处的范围语境。它会作为轻量参考进入模型 prompt，但不再和 `location.name` 这种具体点名一起限制模型。

当前传给模型：

- `nearby.aoi`
- `nearby.aoiList`
- `nearby.aoiTypes`
- `nearby.businessAreas`

这样做的原因是：AOI 可以提供“这里大概是什么场域”的基本判断，但不会像具体地点名那样把模型锁死在某个建筑、食堂、店铺或入口。

这些信息仍可以在调试面板中查看，用来判断定位和地图上下文是否合理。

### 11.3 地区信息

地区信息会进入 prompt，但只保留省市区这类粗粒度语境，不包含具体点位名。

示例：

```text
广州市番禺区
```

它主要用于调试和后续可能的产品展示，不再要求模型根据地区生成任务。

## 12. 结构检查

当前没有 AI 验证机制。

云函数只做本地轻量结构检查：

```js
summarizeStructureCheck()
```

检查内容包括：

- 任务数量是否满足模式要求。
- 任务是否过于泛泛。
- 多个任务之间是否过于相似。
- 结构分数。
- 简要原因。

它的作用是：

- 给调试视图提供质量参考。
- 帮助判断是否出现明显结构问题。
- 不直接替代模型判断。

它不会：

- 重新把内容发给 AI 审核。
- 使用关键词强行判定主题命中。
- 自动改写模型结果。

## 13. Fallback 机制

fallback 仍然保留，主要处理两种情况：

1. 模型请求失败。
2. 模型返回任务数量不足。

fallback 原则：

- 不依赖偏好对象。
- 不使用旧 RAG。
- 尽量依据主题、时间和基础骨架生成可展示任务；模型失败或数量不足时，fallback 可以轻量参考地点上下文。
- 数量不足时只补足缺失任务，不覆盖模型已经返回的有效内容。

source 标签：

- `ai-direct-raw`：模型完整返回，未使用 fallback。
- `ai-direct-partial-fallback`：模型返回可用，但任务数量不足，本地补足。
- `ai-direct-fallback`：模型请求失败或不可用，使用 fallback。
- `combined-direct-raw`：组合主题模型完整返回。
- `combined-direct-partial-fallback`：组合主题任务数量不足，本地补足。
- `combined-direct-fallback`：组合主题模型失败，使用 fallback。
- `combined-direct-error`：组合主题入参不足等前置错误。

## 14. 前端结果处理

前端收到云函数结果后，会做：

```js
normalizeThemeResponse()
trimTheme()
applyGeneratedThemeMetaToContext()
```

主要工作：

- 兼容云函数返回结构。
- 适配直接返回 theme 的情况。
- 修剪标题和任务长度，适配 UI。
- 保存生成来源。
- 保存结构检查。
- 保存模型完整输入。
- 保存模型原始返回。
- 保存本次任务到 `previousMissions`，用于下一次生成避免重复。

注意：

- 如果调试视图看到模型原始返回是完整的，但页面展示被截断，问题通常在前端卡片布局或展示层。
- 如果模型原始返回本身不完整，问题才在 prompt 或模型输出。

## 15. 调试视图

探索页调试开关用于查看本次生成的真实链路。

当前重点展示：

- 结果来源。
- 失败原因。
- 运行时版本。
- 模型名称。
- 探索点经纬度。
- 地点信息。
- 结构检查结果。
- 真正提交给模型的完整输入。
- 模型原始返回。

当前已经移除或弱化：

- RAG 调试卡片。
- AI 验证卡片。
- AI 改写卡片。
- finalize AI 卡片。
- 历史残留的复检信息。
- `contextPacket` 单独卡片。

调试时最重要的是看：

```text
模型完整输入
模型原始返回
```

因为它们分别对应：

- 模型实际看到了什么。
- 模型实际返回了什么。

## 16. 部署和同步

修改共享运行时后，需要同步：

```powershell
node scripts\sync_cloud_generation_runtime.js
```

该脚本会把：

```text
cloudfunctions/shared/generation-runtime.js
```

同步到：

```text
cloudfunctions/generateTheme/runtime.js
cloudfunctions/generateCombinedTheme/runtime.js
```

然后部署云函数：

- `generateTheme`
- `generateCombinedTheme`

如果只改了云函数入口文件，例如：

```text
cloudfunctions/generateTheme/index.js
cloudfunctions/generateCombinedTheme/index.js
```

则不需要运行同步脚本，但仍然需要重新部署对应云函数。

如果改了模型调用配置：

```text
cloudfunctions/generateTheme/ai.js
cloudfunctions/generateCombinedTheme/ai.js
```

也需要重新部署对应云函数。

## 17. 当前流程判断

当前流程相比此前 RAG + AI 验证 + 改写循环更清楚：

- 前端只负责收集上下文和展示调试。
- 云函数负责构造完整 prompt。
- 模型负责一次性生成主题任务。
- 本地只负责结构补齐，不再过度干预内容。
- 调试视图直接展示真实模型输入和真实模型返回。

这套流程的核心取向是：减少具体地点名对模型的过度绑架，把生成自由度还给模型，同时通过省市区、AOI 语境、时间、主题骨架、偏好 instruction 和轻量规则维持基本质量。

## 18. 后续可优化方向

后续如果继续优化，优先考虑：

1. 继续压缩动态上下文，减少无效 token。
2. 将稳定规则尽量放在 prompt 前部，提高隐式缓存命中。
3. 完善不同时间和天气组合下的时间骨架。
4. 继续人工打磨各主题的任务骨架。
5. 继续观察 AOI 质量，必要时补充指定类型 POI 作为旁路调试，不直接强塞进主 prompt。
6. 对前端等待体验做更细腻的进度反馈。
7. 对 fallback 做更自然的任务句式优化。
8. 如果未来模型能力和接口能力允许，再考虑真正的联网 agent 或外部知识增强。
