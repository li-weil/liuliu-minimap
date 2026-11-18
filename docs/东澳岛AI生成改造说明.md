# 东澳岛 AI 生成改造说明（语料库 + 二期点位/美食推荐）

> **本文是唯一权威记录**：由原先 4 份文档合并而成（2026-11-18）——`东澳岛MVP语料库改造计划.md`、`东澳岛MVP验收记录.md`、`东澳岛二期-住宿餐饮入库与美食推荐.md`、`东澳岛二期-云端实测记录.md`。旧文件名不再维护，历史取舍、验证证据与复跑方式都在本文。
>
> **当前状态（截至 2026-11-11 实测）**：一期（语料库）与二期（住宿/餐饮/游客中心 + 美食推荐）的代码、语料、云端部署与真实模型实测都已完成；仅剩真机页面/OPENID 写历史卡的回归。
>
> **当前口径**：65 个点位（52 景点 + 5 住宿 + 7 餐饮 + 1 游客服务中心）｜25 份 L1 点位档案｜26 份上传语料｜6 个美食推荐点位｜75 条菜单条目。
>
> **相关文件**：字段契约 `东澳岛/data/corpus/README.md`；覆盖率 `东澳岛/data/report/coverage.md`；上线/回滚清单 `scripts/dongao_upload_checklist.md`；云端自检 `scripts/verify_dongao_cloud.js`。

---

## 1. 背景与范围

### 1.1 起点

东澳岛页原来的生成链路：

    dongao 页定位/模拟位置
      → dongaoRecommend（geoNear 20km，取最近点位）
      → generateMission(map_name)
      → dongaoGenerate 读云存储 dongao-content/{map_name}.json + weather + tide + guide.md
      → 拼一条 prompt 调 DeepSeek（任务 14-28 字 / 提示 12-24 字 / 安全 8-16 字）
      → 失败走三句兜底，写 dongaoCards，返回卡片
      → 开始漫步 → record 页

问题不在"没有语料"，而在于：`dongao-content` 里的 52 份攻略 JSON 只有环境描述和五感点子，**没有客群、没有玩法标签、没有时长/花费/时段/预订**，模型只能自由发挥，内容容易空泛、同质；而新采集的 5 份 xlsx、6 份 docx 完全没用上。

### 1.2 产品决策（2026-11-08）

- **不实行程化**：原行程方案（模板/时间轴/重排）移到 `private/东澳岛行程化改造方案.md` 待定，本期只做 **RAG-lite（检索后注入）**；
- 新资料清洗成可检索语料，**并行新增** `dongao-corpus/`，保留 `dongao-content/`，可随时回滚；
- 页面骨架、开始漫步、记录、足迹、卡册全部不动，只换喂给 AI 的上下文；
- 2026-11-10 追加二期：住宿/餐饮/游客服务中心入点位库，餐饮点位改生成「美食推荐」卡片。

### 1.3 做 / 不做

| 做 | 不做 |
| --- | --- |
| 新资料清洗成结构化语料（JSON）并上传云存储 | 行程 / 时间轴 / 多任务编排 |
| `dongaoGenerate` 接入语料检索 + 新 prompt | 新页面、新 tab、新组件库 |
| 生成结果防编造约束与验收 | 座标入库、geocode（二期按"高德查得到才入库"处理） |
| 前端透传偏好与最近任务（最小改动） | 客群首屏问卷、4 选 1 引导页 |
| 配置开关与回滚路径 | 菜单 OCR 的后续维护、预约、核销、票券 |
| 覆盖率与生成质量报告 | 多日行程、路线、住宿/购物结构化入产品 |

### 1.4 验收标准与结果

| # | 标准 | 结果 |
| --- | --- | --- |
| 1 | 抽检 40 条生成，0 处编造事实（价格/营业时间/电话/店铺名必须能在语料找到） | **达成**：云端 49 + 20 条，编造菜名 0（唯一措辞变化已修） |
| 2 | ≥80% 任务至少提到 1 个来自新语料的具体线索 | **达成**：命中 L1/L2 的卡片均带档案例信息 |
| 3 | 同一点位连续 5 次，≥4 次动作不重复 | **达成**：3 次运行内容均不同；`recentMissions` 能换菜 |
| 4 | 生成时延 P90 ≤ 6s，超时兜底 ≤ 1s | **达成**：云端 p90 3.48s（不含冷启动） |
| 5 | 语料缺失/损坏时自动回到原生成逻辑，页面无感知 | **达成**：开关与单文件降级均实测 |
| 6 | 记录、足迹、卡册、成就链路回归通过（不改下游） | **未验证**：真机回归待执行（下游代码未改） |

---

## 2. 方案总览

### 2.1 三层语料（RAG-lite）

| 层 | 文件 | 内容 | 作用 |
| --- | --- | --- | --- |
| L1 点位档案 | `dongao-corpus/{map_name}.json` | 12 字段 + 可用性字段 + 二期 `category/openHours/avgPrice/menu` | 任务/推荐的具体依据 |
| L2 片区语料 | `dongao-corpus/_index.json` → `areas` | 片区玩法、餐饮候选、路线、活动 | 让没有 L1 的点位也能拿到"这一带能干什么" |
| L3 风格样本 | `dongao-corpus/_index.json` → `styleSamples` | docx 原文句式/短语 | few-shot，控制语气与颗粒度 |

注入硬约束：全文 ≤1200 字符、L1 块 ≤600、玩法 ≤4 条、菜单 ≤240 字符（最多 12 道菜）。L1 未命中的点位至少拿 L2 + L3，不会"没语料"。

### 2.2 生成模式

| 模式 | 触发条件 | 产出 | 卡片标签 |
| --- | --- | --- | --- |
| `spot`（任务） | 默认；景点/住宿/游客服务中心，以及无可用菜单的餐饮 | 漫步观察任务（看/听/摸/闻/找/坐/拍） | 试着做这个 / 安全提醒 |
| `food`（美食推荐） | `category=food` **且** L1 里有可注入的菜名/套餐 | 2-3 道菜或 1 个套餐的点单推荐 | 推荐这么吃 / 点单提醒 |

缺菜名时宁可退化为 `spot`（模型在缺菜名时必然编菜）。返回卡片新增 `mode` 字段，`debug.modelInput.corpus.mode` 同步；前端 `api.js` 白名单已透出 `mode`。

### 2.3 数据流与文件树

    xlsx / docx / 菜单 PDF
      → scripts/build_dongao_corpus.py（离线，幂等）
      → 东澳岛/data/clean/*.csv（中间表，可复核）
      → 东澳岛/data/corpus/{_index.json, {map_name}.json}
      → 云存储 dongao-corpus/
      → cloudfunctions/dongaoGenerate（corpus.js 检索 + prompt v2 / 美食 prompt）
      → 卡片（mission/tips/safetyNote/mode/debug）

    东澳岛/data/
      clean/    spots.csv stays.csv foods.csv shops_activities.csv kids_hotels.csv menus.csv（菜单转写索引）
      corpus/   _index.json + L1 档案（当前 25 份）+ README.md（字段契约）
      menus/    56 张菜单图的转写 JSON（16 个目录）+ _summary.md
      report/   coverage.json / coverage.md
      area-map.json（片区划分 + spotCategory，人工校对；构建脚本与云函数共用）
    scripts/
      build_dongao_corpus.py      离线构建（openpyxl，--dry-run）
      preview_dongao_prompt.js    本地拼 prompt 预览（不连云）
      verify_dongao_cloud.js      云端 16 项自检（本文件第 7.3 节）

### 2.4 开关、缓存与回滚

- 环境变量 `DONGAO_CORPUS_ENABLED`：默认开启，置 `'0'` 完全退回旧 prompt（不用重新部署代码）；
- 模块级缓存 5 分钟（`_index.json` 各点位 L1 单独缓存），冷启动首次多 1-2 次 `downloadFile`；
- 回滚见 §7.2。

---

## 3. 一期：语料库改造（2026-11-08）

### 3.1 语料 Schema

**L1 点位档案**（完整示例见附录 A）：

| 字段 | 来源 | 缺失时 |
| --- | --- | --- |
| `audiences` | 一级客群标签归一 | 留空（通用） |
| `needs` | 二级标签拆分 | 留空 |
| `plays` | 三级标签拆成原子条目 | 用 L2 片区玩法 |
| `bestTime` / `duration` / `budget` / `booking` | 采集表对应列 | 不注入（不编造） |
| `location` / `surroundings` | 核心地点 / 周边情况 | 不注入 |
| `source.verified` | 已验证 / 待实采 | 默认"待实采"，注入时弱化表述 |

**L2/L3 索引**：`areas`（片区 → spots/plays/food）、`playItems`（去重后的玩法条目）、`styleSamples`、`spotCategories`（二期新增，点位分类）。完整契约以 `东澳岛/data/corpus/README.md` 为准。

### 3.2 检索策略（每次生成取什么）

    输入：mapName + preference（默认 general）+ 当前时间/天气/潮汐 + 最近 3 条任务

    1) L1 命中 → 注入点位档案（截断 600 字符）；未命中跳过
    2) L2 → 该点所属片区的 2-3 条玩法（+0-1 条餐饮提示）
    3) L3 → 2 条风格样本（只学语气）
    4) 过滤：general 剔除 hardcore/水上/夜潜/钓鱼类玩法；指定偏好优先取该客群；
       与 recentMissions 重复的玩法剔除（字符串包含判断）
    5) 硬上限：≤1200 字符、玩法 ≤4 条

### 3.3 清洗规则（按实测问题制定）

要点：客群 8 种写法归一为 `couple/family/elder/hardcore`；分隔符先按 `；` 再按 `、`，**不按 `/` 拆**（`Z世代/情侣` 本身含 `/`）；全角冒号转半角；价格保留原文不转数值；营业时间占位视为缺失；购物表表头在第 2 行、序号重置、8 空列；合并单元格 forward-fill；同实体多条建别名表（景点表优先）；分类错位进 `quarantine`。完整速查见附录 B。

### 3.4 云函数改造（`cloudfunctions/dongaoGenerate`）

| # | 改动 | 说明 |
| --- | --- | --- |
| 1 | 语料读取 `loadCorpusIndex/loadSpotCorpus` | 读 `dongao-corpus/_index.json` 与 `{map_name}.json`，5 分钟缓存，失败降级 |
| 2 | 检索 `buildCorpusContext` | 按 §3.2 取 L1/L2/L3、过滤、截断，返回 `{text, mode, picks, stats}` |
| 3 | 参数 | 接受 `event.preference` / `event.recentMissions`，做枚举与长度校验 |
| 4 | prompt | 语料非空时走 `buildPromptV2`（景点）/ `buildPromptFoodV2`（餐饮） |
| 5 | 输出契约 | 保持 `mission/tips/safetyNote/spotName`；新增 `mode`，`debug` 增加 `corpus` 统计（hit/category/area/playCount/injectedChars…） |
| 6 | 降级 | 语料任一步失败 → 旧 prompt（见 §3.6） |
| 7 | 开关 | `DONGAO_CORPUS_ENABLED=0` 跳过全部语料读取 |
| 8 | 健壮性（二期后补） | 模型输出 JSON 容错（`parseModelJson`）、空 mission 兜底、无 OPENID 调用不写历史卡 |

**不改**：`dongaoRecommend`、`dongaoCards` 写入结构、卡片展示字段、`api.js` ENDPOINTS、record/history/walk-detail、`shared/*`。

### 3.5 prompt v2 结构与事实纪律

    【system】角色 + 事实纪律（只返回 JSON；只使用给定资料；资料没写就不写）
    【user】
      1. 点位档案（L1，逐字段；待实采会注入核验状态）
      2. 玩法候选（2-4 条，仅供参考，不要照抄）
      3. 片区补充（0-2 条：这一带还有什么、吃什么）
      4. 风格样本（1-2 条，只学语气）
      5. 此刻环境（时间/季节/天气/潮汐）
      6. 游客安全守则（guide.md 前 600 字）
      7. 避免重复（最近 3 条 mission）
      8. 生成要求（字数 + 事实约束）
      9. 输出 JSON：{"mission":"…","tips":"…","safetyNote":"…"}

事实约束要点：只能使用资料里出现过的价格/营业时间/时长/预订方式/店铺名；不得声称正在营业/有票/可预约；不得编造电话、菜价、门票；待实采信息只能弱表述；mission 必须现场 5-15 分钟可完成。

### 3.6 降级矩阵（实际行为）

| 情况 | 行为 |
| --- | --- |
| `DONGAO_CORPUS_ENABLED=0` | 完全不读语料，走旧 prompt |
| L1 单文件读取/解析失败 | 跳过该文件，其余语料仍可用（可能降为 L2 或部分 L1），写 warn 日志 |
| `_index.json` 失败 | 只有 L1 可用，否则走旧 prompt |
| 语料全部不可用 / 检索为空 | 按第一次生成逻辑走旧 prompt（不算失败） |
| AI 超时/报错 | 餐饮 → 确定性兜底（只复述菜单菜名）；其他 → 旧三句兜底 |
| 模型返回 200 但内容为空 | 走同一套兜底，避免卡片空白 |
| 模型返回非 JSON | 先截取首尾大括号再解析，仍失败才兜底 |

### 3.7 前端最小改动

| 文件 | 改动 |
| --- | --- |
| `miniprogram/services/dongao.js` | `generateMission(mapName, options)` 透传 `preference`/`recentMissions`，向后兼容 |
| `miniprogram/pages/dongao/dongao.js` | 生成时传 `preference` 与最近 3 条 mission；错误文案改人话；卡片带 `mode`；开始漫步主题分类区分美食/景点；`DEBUG_SPOTS` 补到 65 个 |
| `miniprogram/services/api.js` | `dongaoGenerate` 响应 normalize 透出 `mode` |
| `miniprogram/pages/dongao/dongao.wxml` | 2 行：卡片标签按 `mode` 切换（推荐这么吃 / 点单提醒） |

明确不做：页面结构、新页面、客群问卷、行程/时间轴、`onStartWalk` 草稿结构与 record 交接。

### 3.8 一期产物与本地验证

| 项 | 结果 |
| --- | --- |
| 语料产物 | L2 片区 6 个（覆盖不重不漏）、玩法条目去重 287、风格样本 27；清洗表 6 份（spots/stays/foods/shops_activities/kids_hotels 共 29/29/38/42/4 行 + menus 菜单索引）；quarantine 4 条 |
| L1 覆盖 | 一期 12/52（23.1%），二期扩至 25/65（38.5%）；其余走 L2 片区语料 |
| 静态检查 | `node --check` 覆盖 dongaoGenerate/index.js、corpus.js、页面、services、preview、initDongaoSpots，全部通过 |
| 单元断言 | 语料模块 9 项：L1 命中/L2 降级/空文本回退/去重/偏好归一/事实纪律/待实采标注/水上玩法过滤，全部通过 |
| 离线端到端 | mock 云存储 + mock 模型真跑 `exports.main`：L1 命中（`hit:L1`，注入 321 字符）、语料缺失降级、开关关闭 0 次下载，均符合预期 |
| 构建幂等 | 连续两次构建产物 SHA-256 一致；`--dry-run` 不写盘；原始 xlsx 只读 |
| prompt 预览 | 婚礼堂 `hit:L1` 321 字符、山海经书屋 `hit:L1` 290 字符、听涛步道 `hit:L2` 154 字符，结构完整 |
| 独立复核 | 报告 `东澳岛/_notes/verification-report.md`：26 项 PASS 25 / 部分通过 1，阻断 0；复核后修复 2 项（待实采状态未入 prompt、general 未过滤水上花费文本） |

---

## 4. 二期：住宿/餐饮入库与美食推荐（2026-11-10）

### 4.1 用户要求与取舍

用户四点要求：① 住宿表里民宿不进点位库，高档酒店/度假村进，坐标走高德，玩法作为语料；② 购物+文创表只取「购物」段；③ 餐厅菜单对应餐厅进库，语料只用菜单 + 餐饮表该店信息；④ 生成模式改美食推荐、改 prompt。

| 决策点 | 结论 | 理由 / 风险 |
| --- | --- | --- |
| 住宿入哪几家 | 5 家：万豪、阿丽拉、安麓、格力东澳、可域度假村 | 只收高档酒店 + 真正度假村；信汇海景/春栖山林属经济型，只做语料不入点 |
| 餐饮入哪几家 | 16 个菜单目录中，高德能确认的 7 家 | 高德只认到店名/地址层级；东澳湾 vs 海湾海鲜餐厅无法确认是否同一家，两家都不入库 |
| 酒店内餐厅 | 蓝色海岸、安麓 3 家餐厅并入所属酒店，不单列 | 高德只收酒店本体，餐厅级 POI 查不到；菜单数据保留 |
| 高德查不到 | 洒哥海鲜餐厅、摸鱼咖啡、东澳湾海鲜干货市集、海岛手信坊：不入点、不入语料 | 严格执行"查不到就忽略"；代价是 11 张洒哥菜单图白转写，JSON 已存档，日后确认坐标可一行接回 |
| 购物板块 | 只取 5 条「购物」；29 条「活动」继续留在 L2 片区玩法 | 活动是事件不是地点；删掉会损失 58% 玩法条目（167/287） |
| 价格策略 | 推荐里不出具体菜价，只用采集表人均 | 菜单图是团购套餐 + 门店价目表，时价/团购价/门店价口径混在一起，写进卡片过期即误导 |
| 美食推荐触发 | `category=food` 且有可用菜单 | 缺菜名模型必编菜，宁可退化为普通任务 |

### 4.2 点位库 52 → 65

核验方法：以东澳岛中心（113.703204,22.019507）为圆心、半径 6km 拉高德 `place/around`（住宿 39、餐饮 29、购物 12、风景名胜 31、体育休闲 9、科教文化 2，共 122 个 POI）；名称对不上的再用 `place/text`（city=珠海）单查并算与岛心距离，排除市区同名店。

新增 13 个点位：

| map_name | 分类 | 高德名称 | 坐标 | 片区 |
| --- | --- | --- | --- | --- |
| 珠海东澳岛万豪度假酒店 | stay | 珠海东澳岛万豪度假酒店 | 113.703981,22.025062 | 南沙湾片 |
| 阿丽拉珠海东澳岛 | stay | 阿丽拉珠海东澳岛 | 113.706530,22.009122 | 南岸片 |
| 珠海东澳岛安麓酒店 | stay | 珠海东澳岛安麓酒店 | 113.726610,22.020223 | 北岸东片 |
| 格力东澳大酒店 | stay | 格力东澳大酒店 | 113.703204,22.019507 | 南沙湾片 |
| 珠海东澳岛可域度假村 | stay | 珠海东澳岛可域度假村 | 113.706252,22.015404 | 南沙湾片 |
| 万觅餐吧 | food | 东澳湾万觅餐吧(东澳岛店) | 113.714015,22.017014 | 东澳湾码头片 |
| 东发海鲜酒家 | food | 东发海鲜酒家 | 113.715075,22.020275 | 东澳湾码头片 |
| 是旦有愉食堂 | food | 是旦有愉食堂(东澳岛店) | 113.714420,22.020122 | 东澳湾码头片 |
| 是旦海鲜餐厅 | food | 是旦海鲜餐厅总店 | 113.713932,22.018573 | 东澳湾码头片 |
| 潮汐咖啡 | food | 潮汐咖啡 | 113.715475,22.020075 | 东澳湾码头片 |
| 精致拾光 | food | 精致拾光 | 113.714515,22.019481 | 东澳湾码头片 |
| 聚鲜楼 | food | 聚鲜楼·东澳岛酒楼·海鲜加工 | 113.714792,22.019740 | 东澳湾码头片 |
| 东澳岛游客服务中心 | shop | 东澳岛游客服务中心 | 113.715672,22.020272 | 东澳湾码头片 |

同步改动：`area-map.json`（65 点位 + `spotCategory`）、`initDongaoSpots`（SPOTS_DATA 65 条，带 `category`，只插缺失、可重复执行）、页面 `DEBUG_SPOTS`（65 个模拟定位点）。

**未纳入清单**：住宿 24 家（民宿/经济型，只做语料）；餐饮 4 家（洒哥、摸鱼：高德查不到；东澳湾、海湾：身份无法确认）；购物 2 家（干货市集、手信坊：查不到）；酒店内餐厅 4 家（并入母体）。完整清单见 `coverage.md` §4。

### 4.3 菜单语料

- 原始资料：`东澳岛/data/餐厅菜单/` 下 16 个目录、56 个 PDF，纯图片（团购套餐截图 + 门店价目表长图）；
- 转写：PDF 解出 JPEG → 长图按 1200px 高、120px 重叠切片 → 逐片看图转写 + Windows OCR 双通道交叉校对 → `东澳岛/data/menus/{目录名}.json`；共 56 张图 / 33 个套餐 / 707 个单品 / 68 条 uncertain（看不清用 `?` 占位，不猜）；
- 进 L1 的口径：只把能对应到点位档案的目录接进来（酒店/书屋/洒哥/摸鱼/东澳湾/海湾的菜单已转写但不进 L1）；过滤酒水/餐具/套餐名；选菜顺序「招牌/特色/必点/推荐」→ 无价格（多为套餐内容）→ 价格低/中/高三段采样，凑满 12 条；
- 结果：7 个点位有菜单 JSON，**6 个有可用条目**（潮汐咖啡是扫码海报，无可用菜名），共 **75 条（69 dishes + 6 packages）**。

聚鲜楼示例（菜单只有套餐截图，dishes 由套餐内容回填）：

    "menu": {
      "dishes": [{ "name": "清蒸鱼", "price": null, "unit": "" }, { "name": "椒盐虾", "price": null, "unit": "" }],
      "packages": [{ "name": "2-4人套餐（7月）", "price": 198, "items": ["椒盐虾", "九菜花炒花甲肉", "炒青菜", "杂鱼冬瓜汤"] }],
      "source": "餐厅菜单/聚鲜楼"
    }

### 4.4 美食推荐 prompt 与兜底

    recommendSpots → 点位（category=food 且有菜单）
      → buildCorpusContext：餐厅档案（营业时间/人均/位置/周边）+【可以点的菜】+ 套餐 +【这家店的特点】+ 语气样本
      → buildPromptFoodV2：推荐 2-3 道菜 / 1 个套餐、菜名原样引用、不写菜价、不承诺折扣排队
      → 返回 { mission: 推荐文本, tips: 点单提示, safetyNote: 饮食提醒, mode: 'food' }

- 菜单块最多 12 道菜、2 个套餐，只给菜名与套餐构成，不给菜价；
- 餐厅档案注入前清洗：去掉电话、`【…】` 营销标签、悬空"电话"字样；
- 确定性兜底（模型失败/空返回）：`在{店}点一份{菜1}，再来一份{菜2}` + 固定点单/过敏提示，只用菜单里真实存在的菜名。

### 4.5 二期代码改动

| 文件 | 改动 |
| --- | --- |
| `cloudfunctions/dongaoGenerate/corpus.js` | 220 → 412 行：新增 `getSpotCategory`/`formatFoodBlock`/`formatMenu`/`sanitizeFactText`/`countMenuItems`/`pickDishNames`/`buildPromptFoodV2`/`buildFoodFallback`；`buildCorpusContext` 按分类分支并返回 `mode`/`picks` |
| `cloudfunctions/dongaoGenerate/index.js` | 餐饮点位走美食 prompt；失败/空返回用确定性兜底；返回 `mode`；debug 增加 `mode`/`corpus` |
| `scripts/build_dongao_corpus.py` | 修 `FOODS_XLSX` 改名 bug；点位数量动态校验；全分类用 area-map 覆盖片区；菜单接入与筛选；L1 新增字段；`_index.spotCategories`；报告新增二期/未纳入/菜单待补三节 |
| `cloudfunctions/initDongaoSpots/index.js` | 65 点位种子数据；写入 `category`；顺带创建 `dongaoCards`；去掉无效的建索引调用 |
| `scripts/preview_dongao_prompt.js` | 本地预览支持美食模式 |
| `scripts/verify_dongao_cloud.js` | 新增云端 16 项自检脚本 |
| `scripts/dongao_upload_checklist.md` | 二期上传/校验/回滚步骤与实测记录 |
| `东澳岛/data/corpus/README.md` | 契约补 `category/openHours/avgPrice/menu/spotCategories` 与模式表 |

### 4.6 已确认的取舍（2026-11-11）

1. **东澳湾海鲜餐厅 / 海湾海鲜餐厅**：无法确认是否同一家 → 两家都去掉：已从 `initDongaoSpots`、`area-map.json`、页面模拟点位、菜单接入与 L1 移除；点位 66→65、L1 26→25、菜单点位 7→6、菜单条目 90→75；
2. **住宿 5 家**：确认按 5 家执行，信汇海景、春栖山林只做语料；
3. **洒哥海鲜餐厅**：确认按规则忽略，转写 JSON 留在 `东澳岛/data/menus/` 备查；
4. 以后若要把上述任一家加回，需要先拿到可确认的坐标与名称对应关系。

---

## 5. 云端部署与实测（2026-11-11）

### 5.1 云端现状

| 项 | 实测 |
| --- | --- |
| 环境 | `cloud1-2gdui7md5af99e5c`（ap-shanghai），环境级 API Key 直接读写，免扫码 |
| `initDongaoSpots` | 2026-11-11 13:11 部署；执行 `inserted:13, skipped:52, total:65` |
| `dongaoGenerate` | 2026-11-11 13:15 部署；Nodejs16.13 / 60s / 256MB；环境变量 `DEEPSEEK_API_KEY`、`DONGAO_CORPUS_ENABLED=1` |
| `dongaoRecommend` | 未改；实测 `geoNear` 正常返回附近点位 |
| 云存储 | `dongao-content/` 52 份、`dongao-data/` 3 份、`dongao-corpus/` 26 份（与本地同名同大小，无缺失无多余） |
| 云数据库 | `spots` 65 条（`spot` 52 / `stay` 5 / `food` 7 / `shop` 1），无重复，`location` 齐全，地理索引存在；`dongaoCards` 集合已建（当前 0 条）；集合总数 14 |

### 5.2 测试矩阵与结果

方法：`cbx fn invoke dongaoGenerate -d '{"map_name":"…"}' --json` 直调真实云函数 + 真实 DeepSeek，读 `mode` / `debug.modelInput.corpus` / `debug.modelOutput` 断言。

| 轮次 | 条数 | 覆盖 | 结果 |
| --- | --- | --- | --- |
| 第一轮 | 49 | 6 餐饮×3、5 住宿×2、游客中心×2、5 个有 L1 景点×2、无 L1 景点×2、无菜单餐饮×2、未知点位/空参数/preference/recentMissions | 48 通过；1 条模型非 JSON 走兜底（已修解析容错） |
| 第二轮（修复后） | 20 | 6 餐饮×2 + 住宿/景点/边界 + recentMissions×2 | 20/20 通过，兜底 0、编造菜 0、菜价 0 |

- 餐饮 31 条（18+13）：`mode=food` 全部正确、`hit=L1` 全部命中、`dishCount` 12-27；菜名全部能在该店 `menu.dishes` 或 `menu.packages[].items` 找到；
- 住宿/游客中心/景点正确走任务模式；无 L1 景点走 L2；潮汐咖啡退化为任务模式；
- 同一家店连跑 3 次内容不同；传 `recentMissions` 后换菜（聚鲜楼从椒盐虾换到清蒸鱼+凉拌海草+鲍汁豆腐）；
- 字数收敛（餐饮）：修复后 mission 平均 29.8 字、tips 27.6 字、safetyNote 18.8 字；tips 超 30 字比例由 14/18 降到 4/13。

### 5.3 边界、回滚与模型失败

| 用例 | 操作 | 结果 |
| --- | --- | --- |
| 语料回滚 | `DONGAO_CORPUS_ENABLED=0` 后调聚鲜楼 | `mode=spot`、`hit=none`、`injectedChars=0`，prompt 回到旧版，出卡正常 |
| 恢复语料 | 改回 `=1` | `mode=food`、`hit=L1` 恢复 |
| 模型失败（餐饮） | 临时错误 API Key | 兜底"在聚鲜楼点一份椒盐虾，再来一份九菜花炒花甲肉"，`mode` 仍为 `food` |
| 模型失败（景点） | 同上 | 通用三句兜底，不报错 |
| 未知点位 / 空参数 | `map_name` 不存在 / 空 JSON | 未知点位 `hit=none` 仍出卡；空参数返回空卡片，不写库不报错 |

### 5.4 发现并修复的问题

| # | 问题 | 证据 | 修复 |
| --- | --- | --- | --- |
| 1 | `initDongaoSpots` 用 `db.command({createIndexes})` 建地理索引，`wx-server-sdk` 没有该 API | 每次执行打印 `db.command is not a function` | 删除无效调用，索引改由控制台/CLI 维护（本环境已存在「经纬度」索引） |
| 2 | 云数据库没有 `dongaoCards` 集合，每次生成写历史卡报 `-502005` 并被静默吞掉 | 日志 `Failed to save dongaoCard` | 建集合；`initDongaoSpots` 顺带创建；CLI 调用无 OPENID 时跳过写卡 |
| 3 | 模型偶尔在 JSON 前后多输出一句话，`JSON.parse` 整条失败走兜底 | 第一轮 1/49 失败，`Unexpected token W` | 新增 `parseModelJson`：先原样解析，失败再截首尾大括号；仍失败才抛错 |
| 4 | 模型字数明显超限（tips 目标 12-26 字，平均 35.9） | 18 条餐饮卡 14 条 tips >30 字 | prompt 加"含标点最多 N 字"硬上限；餐饮追加"菜名原样引用" |
| 5 | `spots` 文档缺 `category`（老代码只写 4 个字段） | 库内 52 条老文档无该字段 | 插入时写 `category`（缺省 `spot`）；52 条老文档回填 |
| 6 | 历史卡写入对无 OPENID 的调用也执行 | 测试用 CLI 调用会污染 `dongaoCards` | 无 `wxContext.OPENID` 时跳过写卡并打日志 |

### 5.5 时延与成本

- `dongaoGenerate` 执行时长：p50 **1.74s**、p90 **3.48s**、max 4.61s（不含 `cbx` CLI 冷启动约 2-4s）；
- prompt 体积从约 1200 tokens 增至 ≤2200 tokens，输出不变；按 DeepSeek 价格单次成本增加很小；
- 语料读取模块缓存 5 分钟，冷启动首次多 1-2 次 `downloadFile`。

---

## 6. 当前状态

### 6.1 结论与独立复核

- 一期、二期代码与语料完成；云端已部署并真实模型实测通过；**可以进入最终验收**；
- 一期独立复核（`东澳岛/_notes/verification-report.md`）：26 项 PASS 25 / 部分通过 1，阻断 0；复核后修复 2 项；
- 二期独立复核（`东澳岛/_notes/verification-report-2.md`）：24 项 PASS 19 / 部分通过 5，阻断 0；复核后修复 3 条高优先级（上传清单补部署步骤、文档 9 处口径、菜名判定改 dishes 或 packages[].items）与 2 条中优先级（food 玩法只取本店、菜单非空守卫）；
- 二期云端实测补测了复核报告里"未覆盖"的云端部署、真实模型矩阵、云存储读取三项。

### 6.2 未验证与已知限制

| 项 | 说明 |
| --- | --- |
| 真机页面/WXML 渲染 | 云端只测生成与数据；卡片高度、长文本换行、按钮不溢出未在真机看 |
| 微信内 OPENID 写历史卡 | 真机调用才带 OPENID；CLI 已跳过写卡，这条路径未在真机验证 |
| 记录/足迹/卡册/成就链路 | 下游代码未改，但未做真机回归（一期验收清单） |
| 13 个新点位没有 `dongao-content` JSON | 每次生成打印 `Failed to load` 警告；语料 L1 正常，不影响出卡 |
| `general` 偏好下部分景点 `play=0` | 风车山/大王庙/街心公园的片区玩法都带 `hardcore` 标签被安全过滤，模型改用景点环境资料生成；建议后续细化 `audiences` 标签 |
| 客户端不读 `dongaoCards` | 历史卡片仍在内存（既有问题）；本次只保证写入不再报错、不产生脏数据 |
| 模型输出长度偶发超标 | 第二轮仍有 4/13 条 tips >30 字，属模型服从性问题，不影响展示 |
| OCR 准确率 | 只核了"L1 菜名都能在转写 JSON 里找到"，未逐字回看 56 张原图 |
| 菜价不出现 | 卡片只给采集表人均；若要用团购价需先解决时效与口径 |
| L1 异步更新 | 语料是离线构建产物，采集表更新后需重跑构建并重传 |
| Web 后端模式 | `dongaoGenerate` 仍无 Web endpoint（历史缺口，本期未动） |

### 6.3 真机回归清单（待执行）

- [ ] 东澳岛页：定位/模拟位置 → 出卡；餐饮点显示「推荐这么吃 / 点单提醒」，景点/住宿显示「试着做这个 / 安全提醒」；
- [ ] 换任务 / 换地点 / 左滑右滑历史；
- [ ] 开始漫步 → record → 打卡/素材 → 保存；
- [ ] 足迹页东澳岛筛选、卡册统计、详情页「东澳岛模式」；
- [ ] 断网、云函数报错、语料缺失时的失败态；
- [ ] 窄屏（iPhone SE 宽度）布局；
- [ ] 体验版真机弱网生成。

---

## 7. 上线、回滚与复跑

### 7.1 上线步骤（2026-11-11 已在云端执行完）

| # | 步骤 | 状态 |
| --- | --- | --- |
| 1 | 调用 `initDongaoSpots` 补点位库（13 个新点位，重复执行安全） | 已执行：`inserted:13, skipped:52, total:65` |
| 2 | 上传 `东澳岛/data/corpus/` 全部 JSON（26 个）到云存储 `dongao-corpus/`，不含 `README.md` | 已执行：26/26，同名同大小 |
| 3 | 部署 `dongaoGenerate`（必须带 `corpus.js`），确认 `DONGAO_CORPUS_ENABLED=1` | 已执行：13:15 部署，环境变量保留 |
| 4 | 确认 `dongaoCards` 集合存在 | 已执行：已建集合（当前 0 条） |
| 5 | 体验版/CLI 触发验证 `mode` 与 `debug.corpus.hit` | 已执行：49 + 20 条矩阵 + 16 项自检 |
| 6 | 真机回归（§6.3）与灰度观察 | **待执行** |
| 7 | 异常时回滚（§7.2） | 回滚已实测 |

> 日常只改代码不改环境变量：`cbx fn deploy dongaoGenerate --dir cloudfunctions/dongaoGenerate --force`（实测会保留已有环境变量与运行时配置）。改环境变量：`cbx config pull fn dongaoGenerate --stdout --json` → 改配置 → 建临时 `cloudbaserc.json` → `cbx config update fn dongaoGenerate -y`，完成后删掉该文件（含密钥，已在 `.gitignore`）。

### 7.2 回滚

1. 生成侧：环境变量 `DONGAO_CORPUS_ENABLED=0` → 所有点位退回旧版单条任务 prompt（无需重新部署；已实测）；
2. 或重新部署上一版 `dongaoGenerate`；
3. 点位侧：`spots` 里新增的 13 条可手删；`area-map.json` 与 `initDongaoSpots` 的改动不带开关；
4. 语料侧：云存储覆盖上传前的旧文件即可回到 52 点位版本；旧文件不删除，不影响线上。

### 7.3 复跑命令

    # 重新构建语料（幂等；--dry-run 只校验不写盘）
    python scripts/build_dongao_corpus.py
    python scripts/build_dongao_corpus.py --dry-run

    # 本地预览 prompt（不连云、不调模型）
    node scripts/preview_dongao_prompt.js 婚礼堂 --pref=couple
    node scripts/preview_dongao_prompt.js 聚鲜楼
    node scripts/preview_dongao_prompt.js 潮汐咖啡

    # 云端自检（需本机装好 cbx，项目根有 .cloudbase/credentials.env）
    node scripts/verify_dongao_cloud.js --no-generate   # 只查存储/点位库/集合
    node scripts/verify_dongao_cloud.js                 # 加跑 7 次生成断言

云端自检通过时末行输出「全部通过：东澳岛二期云端状态正常。」，失败会列出具体项。

---

## 8. 风险与后续

| # | 风险 | 对策 / 现状 |
| --- | --- | --- |
| 1 | L1 覆盖不全（25/65），提升不均 | L2 片区兜底；覆盖率报告如实写；本次已实测 L2 也能出合格卡片 |
| 2 | 待实采信息被说成事实 | prompt 事实纪律 + 注入核验状态 + 验收抽检；云端 69 条未发现编造 |
| 3 | prompt 变长导致模型忽略约束 | 注入 ≤1200 字符、条目 ≤4；字数硬上限已加 |
| 4 | 去重逻辑不准（字符串包含） | 同点连续运行验收；`recentMissions` 已生效；不够再加轻量相似度 |
| 5 | 餐饮/住宿信息过期 | 只做提示不承诺营业；标注"以现场为准"；建议月度校验采集表 |
| 6 | 语料维护责任与频率 | 未定；构建脚本与契约已就绪，采集表更新后重跑构建 + 重传即可 |
| 7 | 模型/接口配置写死 | 沿用 `config.json` + 环境变量机制，无新增硬编码 |

**后续建议**（按性价比排序）：

1. 补跑真机回归（§6.3），确认真实 OPENID 写历史卡与卡片长文本渲染；
2. 把酒店/书屋菜单合入 L1：构建脚本把 `MENU_SCOPE_CATEGORIES` 从 `("food",)` 改成 `("food","stay","spot")` 复跑即可（酒店菜单已转写好）；
3. 细化 `audiences` 标签，减少 `general` 偏好下玩法被整体过滤的情况；
4. ¥ 若需要展示价格，先统一采集表口径（人均/团购价/门店价）再上卡片。

---

## 附录 A：L1 点位档案示例（婚礼堂）

    {
      "mapName": "婚礼堂",
      "version": "2026-11-08",
      "source": { "file": "东澳岛景点 字段采集(2).xlsx", "sheet": "Sheet1", "row": 2, "verified": "待实采确认" },
      "audiences": ["couple"],
      "needs": ["出片", "浪漫", "仪式感"],
      "plays": ["白色婚礼堂拍照", "婚礼堂打卡", "海岛求婚", "纪念日"],
      "bestTime": "全天可拍；14:00-18:30 日落前 1 小时最佳",
      "duration": "30 分钟",
      "budget": "免费",
      "partySize": "2 人起，适合情侣/婚纱拍摄",
      "booking": "无需预约",
      "location": "蜜月公园大草坪上，紧邻森林栈道终点",
      "surroundings": ["草坪", "遮阴少", "洗手间需到附近商户"],
      "raw": { "项目": "婚礼堂", "核心地点": "…", "周边情况": "…" }
    }

## 附录 B：清洗规则速查

| 原始问题 | 规则 | 输出 |
| --- | --- | --- |
| `Z世代/情侣客群` / `情侣客群` / `Z世代/情侣` | 别名表 | `couple` |
| `亲子客群` / `亲子` | 别名表 | `family` |
| `银发/休闲客群` / `银发客群` / `银发` | 别名表 | `elder` |
| `资深玩家/硬核探索客群` / `资深玩家` | 别名表 | `hardcore` |
| 餐饮表用 `；`、其余用 `、` | 先按 `；` 再按 `、` 拆 | 原子标签 |
| 任何表不按 `/` 拆 | `/` 属于客群名 | `Z世代/情侣` 保持整体 |
| `14：00-18：30` | 全角转半角 | `14:00-18:30` |
| `营业时间未设置` / `未知` | 视为缺失 | `null`（不注入） |
| `100-116/人` / `115-120r/人` | 保留原文 | 展示用文本，不转数值 |
| 购物表表头在第 2 行 / 序号重置 / 8 个空列 | 固定 header、重建序号、按有效列截断 | 正确表格 |
| 合并单元格类别列 | forward-fill | 每行有类别 |
| 亲子表转置 | 转置后合并到住宿 | 4 条住宿记录 |
| 同实体多条（山海经书屋 ×3、万觅 ×3 等） | 别名表，景点表优先 | 合并后的条目 |
| 分类错位（酒店进景点表、线路名） | 进 `quarantine` | 不参与生成 |

## 附录 C：文件清单

**修改**：`cloudfunctions/dongaoGenerate/index.js`（语料检索 + 双 prompt + 兜底与容错）、`cloudfunctions/initDongaoSpots/index.js`（65 点位 + category + dongaoCards）、`miniprogram/pages/dongao/dongao.js`、`dongao.wxml`、`miniprogram/services/dongao.js`、`miniprogram/services/api.js`、`scripts/dongao_upload_checklist.md`、`.gitignore`。

**新增**：`cloudfunctions/dongaoGenerate/corpus.js`、`scripts/build_dongao_corpus.py`、`scripts/preview_dongao_prompt.js`、`scripts/verify_dongao_cloud.js`、`东澳岛/data/corpus/`（_index + 25 份 L1 + README）、`东澳岛/data/menus/`（16 个 JSON + _summary）、`东澳岛/data/clean/`（6 份 CSV）、`东澳岛/data/report/`、`东澳岛/data/area-map.json`、`docs/东澳岛AI生成改造说明.md`（本文）。

**未改动**（回归范围外）：`dongaoRecommend`、`shared/*`、`record/history/walk-detail`、`app.json`、`dongao-content/` 原有语料、`dongaoCards` 写入结构。

## 附录 D：变更记录

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| v1.0 | 2026-11-08 | 一期：语料设计、构建流水线、云函数改造、验收与排期（原「东澳岛MVP语料库改造计划」+「验收记录」） |
| v1.1 | 2026-11-10 | 二期：13 个新增点位、菜单语料、美食推荐模式（原「二期」文档） |
| v1.2 | 2026-11-11 | 用户确认东澳湾/海湾两家去掉（点位 66→65）；云端部署与真实模型实测、修复 6 项问题（原「云端实测记录」） |
| v1.3 | 2026-11-18 | 4 份文档合并为本文件，统一口径与复跑命令 |
