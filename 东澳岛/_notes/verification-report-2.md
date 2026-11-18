# 东澳岛二期独立复核报告（住宿/餐饮入库与美食推荐）

> 复核员：mvp-verifier（独立复核，只读；唯一写入为本文件）
> 复核时间：2026-11-10 23:46–23:59（Asia/Shanghai）；**复核快照以磁盘最终产物为准**
> 复核对象快照：`cloudfunctions/dongaoGenerate/corpus.js` mtime 23:50:26（MAX_FOOD_DISHES=12 版）；`index.js` 23:44:11；语料/COV 最终构建 **23:50:52**；设计文档 23:52:36；上传清单 23:57:55。
> 说明：复核期间有两次最终调整+重建（Lead 已同步）：选菜规则（招牌优先→null 优先→低/中/高三段采样）与 `MAX_FOOD_DISHES` 8→12；本报告数字均对最终构建（23:50:52）实测。
>
> **复核后增补（2026-11-11）**：按用户确认，东澳湾海鲜餐厅/海湾海鲜餐厅「无法确认是否同一家，两家都去掉」，已从点位库与语料移除（点位 66→65、L1 26→25、菜单点位 7→6、菜单条目 90→75）。本报告 §1/§2 中的 66 点位、26 份 L1、90 条菜单等数字为增补前快照；最新口径见 `docs/东澳岛AI生成改造说明.md` §4.6 与 §5.4，以及 `东澳岛/data/report/coverage.md`。
> 方法：Node v24.21.0；直接 require `corpus.js`/`index.js`（mock wx-server-sdk/https，不连云不调模型）；`node --check`；实际运行 harness 与 preview；`build_dongao_corpus.py --dry-run` ×2（只读，校验 0 写盘）；解析全部 JSON/CSV 与文档逐项比对。

## 0. 结论（PASS / FAIL / 未复核）

- **阻断项：0。** 未发现会导致生成失败、点位错挂、模式判定错误或回滚失效的问题。
- **功能/数据 FAIL：0。** 功能与数据核验 24 项：**PASS 19、部分通过 5、FAIL 0**。
- **文档口径不一致：9 处（FAIL-doc，非阻断，上线前建议改）。** 其中「菜单 91 条→实际 90 条」「格力 398→实际 364」「26 份 L1 全部待实采→实际 21+5」「酒店菜单已并入→本轮未并入」最易误导验收。
- **未复核：7 类（见 §4）**：真实模型输出、40 条矩阵、真机/开发者工具、云存储真实读取、全量字节级幂等、OCR 图像准确率、wxml 运行时渲染。
- 建议上线前处理：① 上传清单补「重新部署 dongaoGenerate（带 corpus.js）」；② 按磁盘产物修正文档 9 处数字/口径；③ 验收规则「菜名只在 menu.dishes」改为「menu.dishes 或 menu.packages[].items」。

## 1. 功能与数据核验

| # | 检查项 | 结果 | 证据（关键数字/命令输出） |
| --- | --- | --- | --- |
| 1 | 66 点位三方一致：`initDongaoSpots` / `area-map.json` / `_index.areas` | PASS | 66 / 66 / 66，unique=66，双向差集为空；`spotToArea`=66；`areas`=6；无重复归属 |
| 2 | 14 个二期新点位（5 stay + 8 food + 1 shop）分类与片区 | PASS | `initDongaoSpots` 带 category 14 条；`area-map.spotCategory` 14 条 `_index.spotCategories` 14 条，三处映射**完全相等**；片区分布 10/10/16/10/4/16=66 |
| 3 | 14 个新点位坐标/高德名/片区与设计文档 §2.2 表一致 | PASS | 文档表 14 行与 `SPOTS_DATA` 逐项比对：坐标 mismatch=0、分类 mismatch=0、片区 mismatch=0；12/14 可在 `Temp/amap_around.json`（122 POI）找到且坐标一致，东发/游客中心为 `place/text` 单查（文档已说明） |
| 4 | 26 份 L1、14/14 新点位有 L1、schema 合规 | PASS | 26 个 L1 文件（27 JSON = 26+`_index`）；文件名 26/26 ∈ 66；必填字段 0 缺失；plays 1–8；audiences 合法；`category` 仅 14 个新点位有，52 景点无 |
| 5 | L1 事实字段来源可追溯（food 营业时间/人均、菜单菜名/套餐） | PASS | 8 个 food L1 的 `openHours/avgPrice` 与 `clean/foods.csv` 对应 `source_row` 完全一致（0 处差异）；L1 菜单 90 条（81 dishes+9 packages）全部可在 `data/menus/*.json` 找到（0 编造）；`menu.source` 指向正确目录（东澳湾合并 2 目录） |
| 6 | 菜单源数据规模 | PASS | `data/餐厅菜单` 16 目录 / 56 PDF（find 实测）；16 个 menus JSON 合计 packages=33、dishes=707、uncertain=68、sources=56，与设计文档 §3.1/§3.2 一致 |
| 7 | 菜单可用点数（8 有 JSON / 7 可用 / 4 待补 / 11 预期） | PASS | `clean/menus.csv` 9 行；`MENUS_BY_POINT` 8 个点位；7 个 `mode=food`，潮汐咖啡 menu 不可用退化为 spot；coverage `menuStats` 8/7/11/4 与磁盘一致 |
| 8 | 「菜单 91 条（82+9）」是否仍成立 | **部分通过** | 最终构建后实际 **90 条（81 dishes + 9 packages）**（万觅 11+3、东澳湾 12+3、聚鲜楼 10+3、东发/是旦/是旦有愉/精致拾光各 12+0）。数据自洽，但设计文档 §3.3/§5 的 91/82 已过时 |
| 9 | 选菜规则（招牌/特色/必点/推荐 → 价格 null → 低/中/高三段采样） | PASS | 读码 build_dongao_corpus.py:942-1073 与产物一致；价格段覆盖实测：东发 3/5/4（低/中/高）、是旦海鲜 1/4/7、万觅 3/4/4；东澳湾 2/7（招牌优先占多数，仍非清一色最高价） |
| 10 | 模式判定：7 餐饮走 food、潮汐退化 spot、菜单缺失退化 spot | PASS | 66 点位遍历：general 下 food=7、spot=59；潮汐咖啡 `category=food` 但 menu 无用 → `mode=spot`（228 字符）；`menu=null`/无菜单合成用例 → spot |
| 11 | food 上下文质量：是否会把片区玩法当成「这家店的特点」 | **部分通过** | **是旦有愉食堂** L1 仅 1 条玩法，`corpus.js:257` 用 `collectPlayCandidates(spot, area)` 又从片区补 3 条：注入「人文遗迹寻踪/海岛探秘/环岛观光（徒步/电瓶车）」，与标题「这家店的特点」语义不符，存在事实归属风险（其余 6 家 L1 玩法≥4 条，未被片区补位） |
| 12 | food 分支防御：菜名为空是否会让模型拿到编不出菜的上下文 | **部分通过** | 合成用例：`category=food` + `menu.dishes=[{name:""}]`（或空名套餐）→ `mode=food`、menuChars=0、picks=[]，prompt 仍要求「菜名必须来自【餐厅档案】」→ 模型可能编菜。**当前磁盘数据无此情况**（构建已过滤空名；0 个空菜名/空套餐）。建议 isFood 增加 formatMenu/picks 非空守卫 |
| 13 | `index.js` 兜底：AI 抛异常/非法 JSON/空 JSON/空 mission 均非空 mission | PASS | mock 实测：food 抛异常/非法 JSON/空 JSON → mission=「在聚鲜楼点一份椒盐虾，再来一份九菜花炒花甲肉」（复述 menu picks，2-3 菜）；spot 抛异常/空 JSON → 通用兜底文本；均 usedFallback=true |
| 14 | `mode` 透传：云函数 → `api.js` normalize → 页面卡片/wxml/开始漫步分类 | PASS | index.js 返回 `mode`（成功/兜底两路径一致）；api normalize 实测：`food→food`、缺失/未知/null→`spot`；page `card.mode`、themeCategory「东澳岛美食/东澳岛景点」、wxml 两处标签条件均正确（wxml 仅静态审查，运行时未复核） |
| 15 | 回归：52 个老景点仍 `mode=spot` + spot prompt | PASS | 遍历 52 老点位 general 全部 mode=spot；harness 用例2 婚礼堂 → 漫步任务 prompt、系统角色为「漫步任务助手」、含【点位档案】；住宿 5 家/服务点 1 家亦 mode=spot |
| 16 | 回归：`DONGAO_CORPUS_ENABLED=0` 完全走旧逻辑 | PASS | 重新加载模块实测：callFunction 0 次、`dongao-corpus/*` 下载 **0 次**；mode=spot、走 v1 prompt（无【点位档案】/【餐厅档案】）；此路径下餐饮点位也退回旧任务 prompt（符合回滚预期） |
| 17 | 向后兼容：`_index` 缺字段 / 旧 52 点格式 / `_index` 缺失 | PASS | 旧格式（52 片区、无 spotCategories）：婚礼堂仍 spot+蜜月山片；聚鲜楼靠 L1 category+menu 仍 food；格力 stay 仍 spot。`_index` 缺失：L1 可用点位正常（聚鲜楼 food 296 字符），全缺失则 v1 |
| 18 | 注入上限与清洗（66 点位 × 5 偏好） | PASS | 最大注入 **375 字符**（珠海东澳岛安麓酒店，general）；food-mode 7 家 **250–374**（聚鲜楼 343、万觅 333、东澳湾 374、东发/是旦 280、精致拾光 269、是旦有愉 250）；潮汐（spot）228；全部 ≤1200；L1/餐厅档案块最大 267 ≤600；0 电话/手机号、0 菜价（¥+数字）、0 营销【】标签 |
| 19 | `node --check` 全部相关 JS | PASS | corpus.js、index.js、api.js、services/dongao.js、page/dongao.js、initDongaoSpots、preview：7/7 OK（node v24.21.0） |
| 20 | 本地端到端 harness `Temp/food_test/run.js` 4 用例 | PASS | 用例1 聚鲜楼 mode=food/【餐厅档案】/无【点位档案】/注入 343；用例2 婚礼堂 mode=spot/spot prompt；用例3 听涛步道 hit=L2/154；用例4 模型空返回 → usedFallback=true、mission=「在聚鲜楼点一份椒盐虾，再来一份九菜花炒花甲肉」；harness 内 cf 副本与生产文件 SHA 一致 |
| 21 | 三条 preview 命令 | PASS | 聚鲜楼：mode=food/343/餐厅档案；格力东澳大酒店：category=stay→mode=spot/364；潮汐咖啡：category=food→mode=spot/228（退化符合预期）；三者 prompt 结构完整 |
| 22 | 构建只读检查（dry-run）与产物计数 | PASS | `--dry-run` 连续 2 次：exit 0、输出完全一致、clean/corpus/report 目录 **0 文件被改写**；自检 66/26/14/14/287/27/4；产物计数 35（6 clean CSV + 27 corpus JSON + 2 report）与文档一致 |
| 23 | 上传清单可执行性（27 文件 + initDongaoSpots 重跑） | **部分通过** | 已写明 27 个 JSON（1+26）与「先补点位库」；**仍缺「重新部署 dongaoGenerate（带 corpus.js）」步骤**（设计文档 §6 第 3 步有）；照清单执行会保留旧云函数 → food 功能不生效且不报错 |
| 24 | 验收校验规则是否与数据模型一致 | **部分通过** | 设计文档 §6 与清单 §7.3「推荐菜名必须都在 `menu.dishes`」过严：万觅 16 个套餐 items 中 14 个不在 dishes、东澳湾 22/22 不在；而 prompt 允许从套餐 items 推荐 → 按该规则会误判失败。应改为「dishes 或 packages[].items」 |

## 2. 文档口径不一致（FAIL-doc，共 9 处，均非阻断）

| # | 位置 | 文档写法 | 磁盘实际 |
| --- | --- | --- | --- |
| D1 | 设计文档 §3.3 L98 / §5 L140 | 菜单 91 条（82 dishes + 9 packages） | **90 条（81 dishes + 9 packages）**；coverage §2 表合计亦为 90 |
| D2 | 设计文档 §5 L143 | 格力东澳大酒店 398 字符 | **364 字符**（其余 聚鲜楼343/万觅333/东澳湾374 正确） |
| D3 | 设计文档 §5 L142 | 兜底示例「清蒸鱼…椒盐虾」 | 当前实测「在聚鲜楼点一份椒盐虾，再来一份九菜花炒花甲肉」 |
| D4 | 设计文档 §4 L120 | build 脚本 2198 → 3013 行 | 当前 **3070/3071 行**（最终调整后） |
| D5 | coverage.md L204 | 26 份 L1 全部标注「待实采」 | **21 份待实采 + 5 份住宿「已验证」** |
| D6 | coverage.md L115–116 | 洒哥/摸鱼「转写结果保留在 clean/menus.csv」 | `clean/menus.csv` 仅 9 行、**不含**这两家；数据保留在 `东澳岛/data/menus/*.json` |
| D7 | coverage.md L117–120 | 酒店内 4 餐厅「已并入所属酒店菜单语料」 | 本轮**未并入**（`MENU_SCOPE_CATEGORIES=("food",)`，stay L1 menu=0，MENUS_BY_POINT 无酒店）；与设计文档 §7 L162 自相矛盾 |
| D8 | coverage.md L133–134 | 南岸片「没有直接采集到的餐饮/住宿/活动」 | 同表 nanya stay=1（阿丽拉珠海东澳岛），注释与数据矛盾 |
| D9 | 设计文档 §2.1 L38 | around 分类：餐饮30/风景32/体育8/文化1 | `Temp/amap_around.json` 122 条实际：住宿39/餐饮**29**/购物12/风景**31**/体育**9**/科教文化**2**（总数 122 一致） |

> 另：coverage.md L231/L232 的「最大 242 / 最大 362，格力东澳大酒店」是构建脚本**估算值**；运行时实测为档案块 267（东澳湾）/注入 375（安麓）。均远低于 600/1200，但建议标注「估算」或改用运行时实测口径。

## 3. 发现的问题（按严重度，含修法）

**阻断：0 条。**

### 高（上线前应修，均非代码阻断）
1. **上传清单缺部署步骤**（`scripts/dongao_upload_checklist.md` §7.2）：4 步中只有「初始化 spots → 建目录 → 上传 27 JSON → 配 env」，**没有「重新部署 `dongaoGenerate`（带 `corpus.js`）」**。修法：把设计文档 §6 第 3 步补入清单，顺序建议「init spots → 部署函数 → 上传 27 JSON → env → 体验版验证」。
2. **文档 9 处口径与最终产物不一致**（§2 D1–D9），按磁盘最新产物修正；尤其 D1/D2/D5/D7 会直接影响验收判断。
3. **验收规则过严**（设计文档 §6 L155、清单 §7.3 L174）：「推荐菜名必须都能在 `menu.dishes` 找到」应改为「`menu.dishes` 或 `menu.packages[].items`」，否则万觅（14 个套餐菜名不在 dishes）、东澳湾（22/22）会被误判为编造。

### 中（建议改，不阻塞上线）
4. **food 分支混入片区玩法**（`corpus.js:257` `collectPlayCandidates(spot, area)`）：`isFood` 时仍从 `area.plays` 补位，导致是旦有愉食堂注入「人文遗迹寻踪/海岛探秘/环岛观光」等景点玩法到「这家店的特点」。修法：food 模式只取 `spot.plays`（或把片区玩法单独成节，改标题为「这一带」）。
5. **food 分支防御缺口**（`corpus.js:241-246`）：`hasMenu` 只看数组长度，不校验 `formatMenu`/`picks` 是否非空；若 L1 菜单所有菜名/套餐名为空 → `mode=food` 但无任何菜名注入，模型可能编菜。修法：`isFood = category === "food" && (formatMenu(spot.menu).trim() !== "" || pickDishNames(...).length > 0)`。当前数据干净（build 已过滤空名），属防御性修复。

### 低（记录/后续）
6. `initDongaoSpots` 新条目的 `category` 只存在于 `SPOTS_DATA`，`collection.add` 未写入 DB（index.js:103-110）；当前无代码读取 DB category，建议补字段或注明「仅种子数据」。
7. README 契约「二期新增字段仅非景点点位写」与 `山海经书屋`（spot）L1 含 `openHours/avgPrice` 不符（由餐饮表合并、spot prompt 不注入，无功能影响）；建议契约加一句说明。
8. 页面 food 模式加载/空状态文案仍为景点口径（`dongao.wxml:35`「读取景点、天气和潮汐线索」、`:64`「观察任务」）；设计声明「其余流程不变」，可后续优化。
9. 住宿点位 spot prompt 仍注入「花费」房价（如格力「¥1000-2500/晚」）：属既有 spot 事实块行为，但与「住宿只做玩法语料」的表述略有张力，建议确认是否保留。

## 4. 未复核项（原因）

| 项 | 原因 |
| --- | --- |
| 真实模型输出质量 / 40 条生成矩阵（编造/多样性/字数/时段） | 无 API Key，本地 mock 只验证链路与兜底，不验证生成质量 |
| 微信开发者工具 / 真机卡片渲染、开始漫步→记录→卡册链路、窄屏 | 需开发者工具与真机；wxml 仅静态审查 |
| 云存储上传后的真实读取、线上 env 行为 | 无云环境凭证，未部署 |
| 35 个产物整体 SHA-256 幂等（文档 `25709a43e8f6f294`） | 只读约束不覆盖产物；仅验证 `--dry-run` 两次输出一致且 0 写盘 |
| 56 张菜单图片 OCR 转写准确率 | 本次按「JSON 产物 → L1」核对（菜名 0 编造），未回看原图逐字校对 |
| 生成时延 / 缓存命中率 | 需线上实测 |
| build 脚本最终版全量逻辑评审（3013→3070 行增量） | 只读关键函数（选菜/套餐/校验）；时间受限，其余按 dry-run 自检通过采信 |

## 5. 复核快照（最终产物 mtime / sha256 前 16 位）

| 文件 | mtime | sha256 前 16 位 |
| --- | --- | --- |
| `cloudfunctions/dongaoGenerate/corpus.js` | 23:50:26 | `7fbe4bdfa8af620c` |
| `cloudfunctions/dongaoGenerate/index.js` | 23:44:11 | `c2d162340bd70f2e` |
| `miniprogram/services/api.js` | 23:43:19 | `599856fbb093dd93` |
| `miniprogram/pages/dongao/dongao.js` | 23:29:07 | `4250e53758d77f3c` |
| `miniprogram/pages/dongao/dongao.wxml` | 23:29:17 | `fc3db5d7c3e78c8b` |
| `cloudfunctions/initDongaoSpots/index.js` | 23:27:01 | `7603f28c372834c0` |
| `东澳岛/data/area-map.json` | 23:26:42 | `c96aaee9c8878005` |
| `东澳岛/data/corpus/_index.json` | 23:50:52 | `a528c4fc1e67c060` |
| `东澳岛/data/report/coverage.md` | 23:50:52 | `5ec18f9f9cc851da` |
| `docs/东澳岛AI生成改造说明.md` | 2026-11-18 | 原「二期」设计文档已合并进此文件（内容见该文件 §4） |
| `scripts/build_dongao_corpus.py` | 23:49:43 | `9e5aa428f1bab789` |
| `scripts/dongao_upload_checklist.md` | 23:57:55 | （复核期间被更新，以该时点为准） |

> 复核期间检测到并发修改：语料 23:49:54 → 最终 23:50:52 重建、corpus.js 23:50:26 调整、设计文档 23:52:36 更新、清单 23:57:55 更新；本报告所有结论按上述最终快照执行。

## 6. 复跑命令（只读）

```bash
node --check cloudfunctions/dongaoGenerate/corpus.js cloudfunctions/dongaoGenerate/index.js miniprogram/services/api.js miniprogram/pages/dongao/dongao.js cloudfunctions/initDongaoSpots/index.js scripts/preview_dongao_prompt.js
node Temp/food_test/run.js
node scripts/preview_dongao_prompt.js 聚鲜楼
node scripts/preview_dongao_prompt.js 格力东澳大酒店
node scripts/preview_dongao_prompt.js 潮汐咖啡
python scripts/build_dongao_corpus.py --dry-run
```

> 本报告为独立复核结论；PASS 表示在所列方法下未发现问题，不等于已完成云端/真实模型/真机验收。

## 7. 云端实测补充（2026-11-11）

本报告 §5 列出的「云端部署、真实模型矩阵、云存储读取」在 2026-11-11 已补测（复核之后由开发代理直接执行）：

- 环境 `cloud1-2gdui7md5af99e5c`：26 份语料上传 `dongao-corpus/`（与本地上传集同名同大小）、`spots` 65 条、`dongaoCards` 集合已建、二期 `dongaoGenerate` 已部署；
- 真实模型两轮 49 + 20 条：第一轮 48/49（1 条模型非 JSON 走兜底），修复后第二轮 20/20，编造菜名 0、菜价 0、兜底 0；餐饮卡片全部 `mode=food` + `hit=L1`；
- 修复 5 项：`initDongaoSpots` 建索引 API 误用（`db.command` 不是函数）、`dongaoCards` 集合缺失导致写卡静默失败、模型输出非 JSON 时整条兜底、prompt 字数缺少硬上限、`spots` 文档缺 `category` 并回填 52 条；
- 回滚 `DONGAO_CORPUS_ENABLED=0` 与模型失败兜底均已实测；
- 仍未验证：真机页面/WXML 渲染、微信内 OPENID 写历史卡路径。

完整记录：`docs/东澳岛AI生成改造说明.md` §5；一键自检：`node scripts/verify_dongao_cloud.js`。
