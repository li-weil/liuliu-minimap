# dongao-corpus 语料契约（云函数与构建脚本共用）

> 版本：2026-11-10（二期：住宿/餐饮/购物点位）。本文件是 `scripts/build_dongao_corpus.py` 的输出规范，也是 `cloudfunctions/dongaoGenerate` 的读取契约。改动字段必须先改这里。

## 目录与文件

```
云存储 dongao-corpus/
  _index.json                 # L2 片区语料 + L3 风格样本（全局一份）
  {map_name}.json             # L1 点位档案；文件名必须与 spots.map_name 完全一致
```

本地源：`东澳岛/data/corpus/`（上传前不放进小程序包）。编码 UTF-8 无 BOM。

## L1 点位档案

必填：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `mapName` | string | 必须等于 65 个 `spots.map_name` 之一（52 景点 + 5 住宿 + 7 餐饮 + 1 游客服务中心） |
| `version` | string | 构建日期 `YYYY-MM-DD` |
| `source` | object | `{ file, sheet, row, verified }`；`verified` ∈ `已验证` / `待实采` |
| `audiences` | string[] | `couple` / `family` / `elder` / `hardcore`，至少 1 项 |
| `plays` | string[] | 三级标签拆成的原子玩法，1–8 条，不许编造 |

可选（**缺失就省略字段，不要填空串、不要猜**）：

`bestTime` / `duration` / `budget` / `partySize` / `booking` / `location` / `surroundings`(string[]) / `needs`(string[]) / `raw`(object，原文，便于追溯)

二期新增（仅非景点点位写）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `category` | string | `stay` / `food` / `shop`；52 个景点**不写**该字段（缺省即景点） |
| `openHours` | string | 餐饮表营业时间原文；`营业时间未设置` 视为无 |
| `avgPrice` | string | 餐饮表人均消费原文（如 `100-116/人`） |
| `menu` | object | 仅 `category=food` 及并入酒店的菜单：`{ "dishes": [{ "name", "price", "unit" }], "packages": [{ "name", "price", "items": [string] }], "source" }` |

`menu` 约束：

- `dishes` 最多 12 条，优先招牌/特色、名称具体能点单的；`price` 可为 null，`unit` 为 `例/斤/份/只/条` 等；
- `packages` 最多 3 条，`items` 只放菜名，不放价格；
- 来源是 `东澳岛/data/menus/{餐厅目录名}.json`（人工看图转写），**不得自行编造菜名**；
- 价格只做内部参考，**云函数不会把菜价写进 prompt**（避免过期价格误导）。

约束：

- 只保留表格里真实存在的信息；价格/时长/时段**保留原文**，不要转数值；
- `raw` 里允许保留清洗前的原文；
- 不要写入 GPS、坐标、图片链接（本期不采集）。

## _index.json

```json
{
  "version": "2026-11-08",
  "audiences": ["couple", "family", "elder", "hardcore"],
  "areas": [
    {
      "id": "miyue",
      "name": "蜜月山片",
      "spots": ["婚礼堂", "..."],
      "plays": [ { "text": "蜜月阁俯瞰", "audiences": ["couple"], "needs": ["出片"], "source": "景点表#2" } ],
      "food": [ { "name": "山海经书屋", "note": "轻食/咖啡", "source": "餐饮表#5" } ],
      "stay": [ { "name": "万豪度假酒店", "note": "亲子友好", "source": "住宿表#1" } ],
      "activities": [ { "text": "沙滩篝火晚会", "audiences": ["family"], "source": "购物活动表#8" } ]
    }
  ],
  "playItems": [ { "spot": "婚礼堂", "text": "白色婚礼堂拍照", "audiences": ["couple"], "needs": ["出片"], "source": "景点表#2" } ],
  "styleSamples": ["短语或句子，来自 docx 原文或三级标签的语气样本"],
  "spotCategories": { "聚鲜楼": "food", "格力东澳大酒店": "stay", "东澳岛游客服务中心": "shop" }
}
```

约束：

- `areas` 必须覆盖 65 个点位（与 `东澳岛/data/area-map.json` 完全一致），不重复、不遗漏；
- `spotCategories` 只列非景点点位（住宿/餐饮/服务点），云函数据此判断走「景点任务」还是「美食推荐」；缺失时按景点处理；
- `food` / `stay` / `activities` 可以少于点位数量，允许为空数组；
- `styleSamples` 8–30 条，只做语气参考，不得含具体价格/电话；**宁缺毋滥：章节标题、流程词、填充要点一律不算**；
- 所有条目标注 `source`（来源文件 + 行号），便于回滚核查。

## 覆盖与降级约定

- 云函数按 `map_name` 读 L1；没有 L1 时退回 L2（片区）+ L3；
- `_index.json` 缺失或解析失败时，云函数走旧逻辑；
- 不允许为了"看起来完整"而补造字段。

## 生成模式（二期）

| 点位类型 | 判定方式 | prompt | 返回 `mode` | AI 失败兜底 |
| --- | --- | --- | --- | --- |
| 景点 / 住宿 / 服务点 | 无 `category`，或 `category` 不是 `food` | `buildPromptV2`（观察任务） | `spot` | 「在 X 停下来，看看周围…」 |
| 餐饮 | L1 `category=food`，或 `_index.spotCategories` 标为 `food` | `buildPromptFoodV2`（美食推荐） | `food` | `buildFoodFallback`：只复述 `menu.dishes` 里的菜名，不新增事实 |

小程序端据 `mode` 切换卡片文案：`food` 时「试着做这个」→「推荐这么吃」、「安全提醒」→「点单提醒」；其余流程（开始漫步、记录、卡册）不变。
