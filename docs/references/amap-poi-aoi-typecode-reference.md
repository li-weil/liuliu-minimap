# 高德 POI / AOI 官方编码参考

## 官方来源

- 官方分类编码表下载：<https://a.amap.com/lbs/static/amap_3dmap_lite/amap_poicode.zip>
- 项目内保存副本：[amap_poicode_official.xlsx](D:/liuliu-minimap/docs/references/amap_poicode_official.xlsx)

## 说明

- POI 的官方分类编码字段是 `typecode`。
- AOI 在高德逆地理编码返回里走的是另一条字段名：官方分类编码在 `aois[].type`，不是 `aois[].typecode`。
- 但 AOI `type` 的编码值仍然使用这份官方分类编码表里的同一套编码体系，所以项目里的 `aoiTypecodePrefixes` 也应按这份官方表来配置。
- 项目内已经把 AOI `type` 统一归一到 `nearbySummary.aoiTypecodes / primaryAoiTypecode`，再和 `aoiTypecodePrefixes` 做前缀匹配。
- 实际使用时，项目会同时参考：
  - `poiTypecodes`
  - `aoiTypecodes`
  - `primaryAoiTypecode`
  - `poiTypes / aoiNames / businessAreaNames / poiNames`

## 本项目当前重点使用的官方前缀

### 自然景观

- `1101`：风景名胜 > 公园广场
- `1102`：风景名胜 > 风景名胜
- `0605`：购物服务 > 花鸟鱼虫市场
- `1203`：商务住宅 > 住宅区
- `1412`：科教文化服务 > 学校

### 人文历史

- `1102`：风景名胜 > 风景名胜
- `1202`：商务住宅 > 楼宇
- `1401`：科教文化服务 > 博物馆
- `1402`：科教文化服务 > 展览馆
- `1404`：科教文化服务 > 美术馆
- `1405`：科教文化服务 > 图书馆
- `1408`：科教文化服务 > 文化宫
- `1409`：科教文化服务 > 档案馆
- `1412`：科教文化服务 > 学校

### 市井烟火

- `05`：餐饮服务
- `0503`：餐饮服务 > 快餐厅
- `0504`：餐饮服务 > 休闲餐饮场所
- `0505`：餐饮服务 > 咖啡厅
- `0506`：餐饮服务 > 茶艺馆
- `0508`：餐饮服务 > 糕饼店
- `0509`：餐饮服务 > 甜品店
- `06`：购物服务
- `0602`：购物服务 > 便民商店/便利店
- `0604`：购物服务 > 超级市场
- `0607`：购物服务 > 综合市场
- `0610`：购物服务 > 特色商业街
- `07`：生活服务
- `0705`：生活服务 > 物流速递
- `15`：交通设施服务
- `1502`：交通设施服务 > 火车站
- `1505`：交通设施服务 > 地铁站
- `1507`：交通设施服务 > 公交车站
- `1509`：交通设施服务 > 停车场
- `20`：公共设施

## 代码位置

- 共享映射：[generation-runtime.js](D:/liuliu-minimap/cloudfunctions/shared/generation-runtime.js:538)
- 单主题映射：[runtime.js](D:/liuliu-minimap/cloudfunctions/generateTheme/runtime.js:538)
- 组合主题映射：[runtime.js](D:/liuliu-minimap/cloudfunctions/generateCombinedTheme/runtime.js:538)
