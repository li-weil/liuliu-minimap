# 东澳岛 MVP 独立复核报告

> 复核员：mvp-verifier（独立复核，只读）｜复核时间：2026-11-08 18:23（Asia/Shanghai）
> 复核对象快照：语料/CSV/覆盖率报告构建于 18:15:06；`cloudfunctions/dongaoGenerate/index.js` 18:09、`corpus.js` 18:06；前端 diff 为当前工作区。
> 只读约束：本轮仅写本文件；复核期临时脚本（`scripts/_tmp_*`）已删除，未改动任何代码、语料或原始 xlsx。
> 方法：Node v24.21.0（DSH 自带）直接解析 JSON/CSV、`require` 真实 `corpus.js` 跑检索、`git diff` 核对改动面、`node --check`、实际运行 preview 脚本。

## 0. 结论（PASS / FAIL 计数）

- **阻断问题：0；FAIL：0。** 详细检查项 26 项：**PASS 25 项、部分通过 1 项（B-3，非阻断）**。
- 优先 5 项全部通过：① `_index.json` 52 点位片区与 `area-map.json` 完全一致；② 12 份 L1 文件名均在 52 个 `map_name` 内且必填齐全；③ clean CSV 行数 29/29/38/42/4；④ 四个代码文件 `node --check` 全过；⑤ 两次 preview 注入分别为 293 / 154 字符，均 ≤1200。
- 可上线（体验版）前提：云端部署、真实模型 40 条矩阵、真机回归仍需执行（见 §6 未覆盖项）。

### 优先 5 项速览（对应明细行）

| # | 优先项 | 结果 | 明细 |
| --- | --- | --- | --- |
| P1 | `_index.json` 6 片区、52 点位与 `area-map.json` 一致 | PASS | A1-2 / A1-3 |
| P2 | 12 份 L1 文件名在 52 `map_name` 内、必填齐全 | PASS | A2-1 / A2-2 |
| P3 | clean CSV 行数 29/29/38/42/4 | PASS | B-1 |
| P4 | `node --check` 四个代码文件 | PASS | C-1 |
| P5 | preview 婚礼堂 + 听涛步道，注入 ≤1200 | PASS | D-1 / D-2 |

## 1. 逐项检查表

### A. 语料（`东澳岛/data/corpus/`）

| 编号 | 检查项 | 方法 | 结果 | 证据片段 |
| --- | --- | --- | --- | --- |
| A1-1 | `_index.json` 顶层字段齐全 | JSON 解析取 keys | PASS | keys 恰为 `version,audiences,areas,playItems,styleSamples`；`version=2026-11-08`；`audiences=["couple","family","elder","hardcore"]` |
| A1-2 | `areas` 恰 6 个 | 计数 | PASS | 6 个：miyue/nansha/matou/fengche/nanya/beian，id 与 `area-map.json` 顺序一致 |
| A1-3 | 52 点位与 area-map 完全一致（不重不漏） | 三方集合比对 + 逐点片区比对 | PASS | `_index` 平铺 spots=52、unique=52；`area-map.spotToArea`=52；`initDongaoSpots` map_name=52；三方集合完全相等，逐点片区 mismatch=0 |
| A1-4 | `playItems` 无重复文本 | 文本去重 | PASS | 287 条，distinct=287，重复组 0；字段 spot/text/audiences/source 缺失 0；audiences 非法 id 0 |
| A1-5 | `playItems` 无标题/流程类条目 | 与 6 份 docx 的 44 个 Heading 段落比对 + 流程词正则 | PASS | 0 条命中章节标题；`核心项目/填充要点/交付物/内容要求` 等流程词 0 条（少量非动作条目见建议 7） |
| A1-6 | `styleSamples` 8–30 条、非章节标题 | 计数 + docx 标题比对 + 价格/电话正则 | PASS | 27 条（distinct=27）；0 条命中 docx 标题；无 ¥/电话/手机号；前 7 条为 docx 原文句，第 8–27 条来自三级标签 |
| A2-1 | 12 份 L1 文件名 ∈ 52 `map_name` | 集合比对 | PASS | 12/12 命中：婚礼堂、蜜月阁、滨海栈道、南沙湾沙滩、月牙环、风车山、求子泉、万山海洋生物科普馆、万觅书店、铳城、山海经书屋、东澳岛海关遗址 |
| A2-2 | 必填字段齐全 | 逐文件校验 | PASS | `mapName/version/source/audiences/plays` 缺失 0；`source.file/sheet/row/verified` 齐全；`mapName==文件名` 12/12；`version` 均 2026-11-08 |
| A2-3 | `audiences` ⊆ 4 个客群 id | 逐值校验 | PASS | 仅 couple/family/elder/hardcore；非空 12/12；合并表来源的并集（万觅/山海经加 hardcore）在 `raw.合并来源` 有标注 |
| A2-4 | `plays` 1–8 条、无重复 | 计数 + 去重 | PASS | 实测 2–8 条（婚礼堂 6、万觅 8、月牙环 2…），重复 0 |
| A2-5 | 抽查 5 份（实做 12 份）与 `clean/spots.csv` 比对，无编造价格/时长/时段 | 按 L1 `source.row` 回查 CSV 对应行，字段 substring + 数字 token 校验 | PASS | 见下方样例；12/12 的 bestTime/duration/budget/partySize/booking/location 全命中，surroundings 逐项命中，数字 token 0 缺失 |

A2-5 抽样证据（数字/文字均可在 `spots.csv` 对应 `source_row` 行找到）：

| L1 | 数值/文字 | CSV 对应行原文 |
| --- | --- | --- |
| 婚礼堂 | 14:00-18:30、30分钟、免费 | #2「全天可拍；14:00-18:30日落前1小时光线最佳」「30分钟」「免费」 |
| 南沙湾沙滩 | 15:00-18:00、2-3小时、¥298/10分钟 | #5「15:00-18:00（光线柔和）」「2-3小时」「沙滩免费；水上项目如摩托艇约¥298/10分钟」 |
| 月牙环 | 日落时分、30-45分钟 | #6「日落时分」「30-45分钟」 |
| 蜜月阁 | 9:30-11:00、1-1.5小时 | #3「9:30-11:00」「1-1.5小时（需爬台阶）」 |
| 万觅书店 | 30-60分钟、饮品约¥30-50/人 | #11「30-60分钟」「饮品约¥30-50/人」 |

> 备注：万山海洋生物科普馆 L1 的主来源行是 `source.row=26`（景点表「玩法/博物馆类」行），字段与 CSV 第 26 行完全一致；其玩法另合并自景点表#10、餐饮表#13 等，均可在对应 clean CSV 找到，符合 §2.5 合并口径。

### B. clean CSV（`东澳岛/data/clean/`）

| 编号 | 检查项 | 方法 | 结果 | 证据片段 |
| --- | --- | --- | --- | --- |
| B-1 | 5 份行数 29/29/38/42/4 | 解析后计数 | PASS | spots 29、stays 29、foods 38、shops_activities 42、kids_hotels 4 |
| B-2 | 表头规范化 | 列名正则 + 列数一致性 | PASS | 列名全为 ASCII snake_case；列数 23/21/16/20/16；0 行列数与表头不一致 |
| B-3 | 客群标签归一（只允许 4 个 id） | audiences 列拆分去重 | **部分通过** | spots/stays/foods/shops_activities 的 audiences 仅 {couple,family,elder,hardcore}（非法 0）；**kids_hotels.csv 无 audiences 列，`audience_label` 为「亲子家庭（大众亲子）」等 4 个中文细分标签**，未归一（见建议 1，非阻断） |
| B-4 | 抽 10 行看乱码/分隔/价格格式（附占位值清理） | 抽样打印 + 正则扫描 | PASS | 抽 10 行（spots#1/#9、stays#1/#11、foods#1/#5/#11、shops#1/#6/#21）可读；UTF-8 BOM 保留（Excel 友好）；替换字符/乱码 0；全角冒号时间 0；价格保留原文（`100-116/人`、`¥300-500/晚`、`¥1000-2500/晚`）；「营业时间未设置/未知」6 条已清空；全表 0 个电话号码 |

### C. 代码

| 编号 | 检查项 | 方法 | 结果 | 证据片段 |
| --- | --- | --- | --- | --- |
| C-1 | `node --check` 四个文件 | DSH 自带 node v24.21.0 | PASS | `cloudfunctions/dongaoGenerate/index.js`、`corpus.js`、`miniprogram/services/dongao.js`、`miniprogram/pages/dongao/dongao.js` 全部 OK |
| C-2 | `DONGAO_CORPUS_ENABLED=0` 回退原 prompt | 读码 + 纯函数实测 | PASS | index.js:12 `CORPUS_ENABLED = process.env.DONGAO_CORPUS_ENABLED !== "0"`；关闭时两个 loader 直接返回 null；仅 `if (corpusContext.text)` 才启用 v2（index.js:374），否则用原 v1 prompt |
| C-3 | 语料缺失 / JSON 解析失败降级 | 读码 + 实测降级分支 | PASS（附偏差说明） | `loadFile` 内 try/catch，下载失败与 `JSON.parse` 失败均返回 null；实测 spot=null,index=null → `text=""`、`stats.hit="none"` → 原 prompt。**偏差**：单文件损坏时用剩余语料走 v2（与计划 §4.4 字面不一致，见建议 4） |
| C-4 | 注入 ≤1200 字符 | 代码常量 + 52 点位 × 5 偏好遍历 | PASS | `MAX_CORPUS_CHARS=1200` 且 `.slice(0,1200)`；实测最大 293（婚礼堂，general/couple），覆盖 52×5 组合 |
| C-5 | prompt 含事实纪律 | 读码 + 实际渲染 | PASS | systemPrompt：「事实纪律：只能使用用户提供的资料；资料没有写的价格、营业时间、预订方式、店铺名一律不要出现；不得声称现在营业中、有票、可预约…」；生成要求第 4 条「不得编造资料中不存在的事实」 |
| C-6 | 无新增硬编码密钥 | git diff + 7 文件密钥正则扫描 | PASS | 无密钥行；`getAiConfig` 只取 `process.env.DEEPSEEK_API_KEY/AI_API_KEY` 或 `fileConfig.apiKey`；`config.json` 的 `apiKey` 为空串；扫描 `sk-`/Bearer/AKID 0 命中 |
| C-7 | 前端只透传 preference/recentMissions，未改页面结构/walkMode/themeSnapshot | `git diff` | PASS | 仅 4 文件改动（+109/−12）；页面 diff 仅新增 `preference:"general"`、错误文案、两处 `generateMission(..., {preference, recentMissions})`；`walkMode`/`themeSnapshot` 未出现在 diff；services 透传并 `slice(0,3)`；`api.js`/`cloud.js` 未改，参数经 `callCloud(name,data)` 原样到达云函数 |

### D. 联调预览（`node scripts/preview_dongao_prompt.js`）

| 编号 | 检查项 | 结果 | 证据片段 |
| --- | --- | --- | --- |
| D-1 | 婚礼堂 `--pref=couple` | PASS | `hit=L1`、`area=蜜月山片`、`injectedChars=293`；corpus 文本含【点位档案】+4 条玩法+1 条片区餐饮+2 条语气参考；prompt 结构完整（系统事实纪律/环境/安全守则/生成要求/JSON） |
| D-2 | 听涛步道 `--pref=general` | PASS | `hit=L2`、`area=北岸东片`、`injectedChars=154`；L1 缺失按预期只走 L2+L3；prompt 结构完整 |
| D-3 | 无标题类样本混入 + general 安全过滤 | PASS | 两次 preview 的语气样本均为 docx 原文句，无章节标题；52 点位 general 注入的 `- ` 玩法行中 hardcore/水上关键词 0 条（但 L1「花费」文本仍含摩托艇字样，见建议 3）；追加 `--recent` 实测去重生效（6 条玩法剔除 2 条剩 4 条） |

### E. 上传清单

| 编号 | 检查项 | 结果 | 证据片段 |
| --- | --- | --- | --- |
| E-1 | `scripts/dongao_upload_checklist.md` 含语料一节 | PASS | 新增「七、语料文件」：目录/文件表（`_index.json` + `{map_name}.json`×N）、上传步骤、`debug.modelInput.corpus` 校验、`DONGAO_CORPUS_ENABLED=0` 回滚 |

## 2. 发现的问题分级

### 阻断（0 条）

无。未发现会导致生成失败、语料错挂、事实越界或回滚失效的阻断问题。

### 建议（7 条，均非阻断）

1. **`kids_hotels.csv` 客群标签未归一**：`audience_label` 为「亲子家庭（大众亲子）」等 4 个中文细分标签，`stays.kids_tag` 同源；其余 4 表 `audiences` 均为 4 个 id。该列不参与生成检索，风险低；建议补一列归一 id 或明确该字段为展示用细分标签。
2. **L1 的 `待实采` 未进入 prompt**：12/12 份 L1 的 `source.verified` 均为「待实采」，但 `corpus.js` 的 `formatSpotBlock` 只注入 duration/bestTime/budget/partySize/booking/location/surroundings，模型看不到哪些信息待实采，systemPrompt 的「资料里标注待实采的信息只能弱表述」无对应标记。建议在点位档案块加一行「核验状态：待实采，仅作参考」。
3. **`general` 安全过滤只覆盖玩法候选**：南沙湾沙滩 general 的 L1 花费仍注入「水上项目如摩托艇约¥298/10分钟」，与「general 剔除水上项目（安全审核未过）」的意图不完全一致。建议 general 下对 L1 事实块做关键词脱敏。
4. **单文件语料损坏时的降级与计划字面不一致**：计划 §4.4 写「L1/L2 读取失败 → 走现有 prompt」，实现为「跳过错的那份，其余语料仍走 v2」。可用性不受影响，建议把计划/验收记录的降级矩阵改为实际行为。
5. **构建自检注入估算偏小**：`coverage.json.selfCheck.maxEstimatedInjection=257`，实测为 293（差 36 字符 = 估算漏算 3 个分节标题修饰）。验收记录 §2 仍引用 257，建议改为实测 293（均 ≤1200，不影响验收）。
6. **L3 风格样本区分度弱**：27 条中 20 条直接复用三级标签文本，且每次固定注入前 2 条（`styleSamples.slice(0,2)`），语气参考恒定。不违反契约 8–30；建议后续补 docx 句式、随机取 2 条。
7. **`playItems` 含少量非动作/商品条目**：「《东澳岛观星指南》（规划发布）」「亲子住宿（酒店/民宿）」「图书7折」「近南沙湾沙滩」等；不属标题/流程类，但作为「玩法」语义偏差。另注：当前云函数检索未直接使用 `playItems`（L2 用 `area.plays`），与计划 §2.3 一致，属索引层产物。

## 3. 与《东澳岛 MVP 验收记录》的交叉核对

复核期间读到 `docs/东澳岛MVP验收记录.md`（18:21 生成；该文件已于 2026-11-18 合并进 `docs/东澳岛AI生成改造说明.md`）。交叉核对结果：

- 一致：L1 12/52、片区 6、playItems 287、styleSamples 27、clean 行数、三个 preview 数值（293 / 262 / 154，我独立重跑全部一致）。
- 差异 1 处：验收记录 §2「预估最大注入 257」沿用构建自检估计值，实测 293（见建议 5）。
- 未独立复现：验收记录 §3.2 的 7 项单元断言、§3.3 mock 云存储/模型的离线端到端、§3.4 构建幂等 SHA 比对。原因：只读复核不重跑构建（会写文件），mock 端到端超出本轮范围；但 §3.2 中 L1 命中/general 过滤/去重/L2 降级/空语料回退/prompt 内容/归一化 7 项，我已用直接 require `corpus.js` 的等价检查独立复现并通过。

## 4. 复核快照（便于复现）

| 文件 | 大小 | sha256 前 16 位 | mtime |
| --- | --- | --- | --- |
| `东澳岛/data/corpus/_index.json` | 160,546 B | `335f112f30c67115` | 18:15:06 |
| `东澳岛/data/area-map.json` | 4,207 B | `9fbe6df38da7623b` | 17:54:31 |
| `东澳岛/data/report/coverage.json` | 24,320 B | `850a8867ef237bac` | 18:15:06 |
| `cloudfunctions/dongaoGenerate/index.js` | 16,106 B | `795574ffb38bb54a` | 18:09:06 |
| `cloudfunctions/dongaoGenerate/corpus.js` | 8,511 B | `583a777d21991f00` | 18:06:24 |
| `miniprogram/services/dongao.js` | 490 B | `7358c93e550ab783` | — |
| `miniprogram/pages/dongao/dongao.js` | 18,572 B | `f3beda6854169342` | — |

> 说明：复核开始时构建方正于 18:15:06 重跑一次构建（与 18:13 版本相比仅换行符 CRLF→LF，内容一致：`婚礼堂.json` 1567→1516 B 恰为 51 个 `\r`，`_index.json` 167896→160546 B 恰为 7350 个 `\r`）。本报告所有数据均按 18:15:06 快照执行。

## 5. 复跑命令

```bash
# 语法
node --check cloudfunctions/dongaoGenerate/index.js
node --check cloudfunctions/dongaoGenerate/corpus.js
node --check miniprogram/services/dongao.js
node --check miniprogram/pages/dongao/dongao.js

# 语料命中与注入长度
node scripts/preview_dongao_prompt.js 婚礼堂 --pref=couple
node scripts/preview_dongao_prompt.js 听涛步道 --pref=general
```

## 6. 未覆盖项（如实记录）

| 项 | 原因 |
| --- | --- |
| 云端部署 / 云存储真实读取 / `DONGAO_CORPUS_ENABLED` 环境变量线上行为 | 无云环境凭证，只做本地代码与纯函数验证 |
| 真实模型调用、40 条生成矩阵（编造/具体性/多样性/字数/时段合理性） | 无 DeepSeek API Key，无法调用 |
| 微信开发者工具与真机回归（record/history/卡册/窄屏/弱网） | 需微信开发者工具与真机 |
| 生成时延 P90 ≤6s | 需部署后实测 |
| 构建脚本复跑幂等（21 个产物 SHA 一致） | 只读复核约束，不能重跑写文件的构建脚本；采信构建方自报，未独立复现 |
| Web 后端共用接口模式下的东澳岛生成 | `api.js` 未给 `dongaoGenerate` 配 web 端点（本次未改、既有行为），Web 模式仍走不通；非本次改动引入，未纳入回归 |

---

> 本报告为独立复核结论；PASS 表示在所列方法下未发现问题，不等于已完成云端与真机验收。
