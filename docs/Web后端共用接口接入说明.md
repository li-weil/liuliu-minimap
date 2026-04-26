# Web 后端共用接口接入说明

## 1. 目标

本说明用于梳理小程序和 Web 后端共用接口的情况：

- 小程序功能能否对应 `D:\liuliu` 中 Web 前端正在调用的 Spring Boot 接口
- 哪些功能已经能共用 Web 接口
- 哪些功能暂时不能共用
- 小程序接入层已经做了哪些适配
- 下一步如何继续统一前后端逻辑

对齐原则：

- 优先复用 Web 前端实际在调用的 `/api/v1/**`
- 尽量保持请求语义、返回结构和前端使用逻辑一致
- 例外：当前 `syncUser` 的 Web endpoint 仍配置为 `/api/v1/miniapp/auth/sync-user`，它不是 Web 前端同款登录链路，只能视为小程序登录过渡接口

---

## 2. 参考项目与依据

### 2.1 Web 前端调用依据

主要参考了这些文件：

- `D:\liuliu\src\services\apiClient.ts`
- `D:\liuliu\src\services\authApi.ts`
- `D:\liuliu\src\services\themeService.ts`
- `D:\liuliu\src\services\mapApi.ts`
- `D:\liuliu\src\services\fileApi.ts`
- `D:\liuliu\src\services\walkApi.ts`

### 2.2 Spring Boot 后端接口依据

主要参考了这些文件：

- `D:\liuliu\backend\src\main\java\com\liuliu\citywalk\controller\AiThemeController.java`
- `D:\liuliu\backend\src\main\java\com\liuliu\citywalk\controller\MapController.java`
- `D:\liuliu\backend\src\main\java\com\liuliu\citywalk\controller\FileController.java`
- `D:\liuliu\backend\src\main\java\com\liuliu\citywalk\controller\WalkController.java`
- `D:\liuliu\backend\src\main\java\com\liuliu\citywalk\controller\AuthController.java`

---

## 3. 当前已经完成的共用接入

### 3.1 小程序接入层优先对齐 Web 接口

小程序接入层已经做了统一适配，核心改动在：

- [miniprogram/services/api.js](D:/liuliu-minimap/miniprogram/services/api.js)
- [miniprogram/services/map.js](D:/liuliu-minimap/miniprogram/services/map.js)
- [miniprogram/pages/index/index.js](D:/liuliu-minimap/miniprogram/pages/index/index.js)
- [miniprogram/utils/config.js](D:/liuliu-minimap/miniprogram/utils/config.js)

其中：

- Web 接口统一前缀已改为 `/api/v1`
- `apiBaseUrl` 有值时，已配置 Web endpoint 且未被云存储开关强制兜底的接口会优先调用 Web 接口
- 为了不改页面层业务逻辑，接入层对请求体和响应体做了兼容映射

当前默认配置仍是：

- `apiBaseUrl: ''`
- `useCloudWalkStorage: true`
- `useCloudMediaStorage: true`

因此只把 `apiBaseUrl` 改成域名，并不会让所有能力都切到 Web。记录保存、历史、详情、删除、成就列表会受 `useCloudWalkStorage` 影响；媒体上传会受 `useCloudMediaStorage` 影响；同行模式多数接口目前没有 Web endpoint。

### 3.2 已可共用的接口清单

#### 1. AI 生成主题

Web 前端调用：

- `POST /api/v1/ai/themes/generate`

小程序功能：

- 进阶模式 AI 生成主题

结论：

- 可以直接共用
- 已接入

说明：

- 小程序原本就有 `mood/weather/season/preference/locationName/locationContext/walkMode`
- 已补充 `generationContext.contextPacket / timeContext / nearbySummary / generationSeed` 等生成上下文字段
- 与 Web 后端 `GenerateThemeRequest` 的基础字段一致；如果 Web 后端要完全复刻小程序效果，需要继续兼容这些扩展上下文
- 接入层已把响应重新包装成小程序当前页面能直接消费的 `{ theme, source }`
- 页面层要求先确认探索点，再发起主题生成请求
- 主题方向枚举已对齐为：`形状 / 色彩 / 声音 / 数字 / 气味`

#### 2. 随机主题

Web 前端调用：

- 小程序不再依赖独立预设主题接口
- 随机主题由前端先选出 `category`，再复用单主题生成接口

小程序功能：

- 纯粹模式“随机生成”

结论：

- 可以共用单主题生成接口
- 不再需要维护单独的“随机主题 -> 预设主题接口”映射

说明：

- “随机生成”本质是先随机出一个 `category`
- 小程序前端随机选择 `category` 后复用 `generateTheme`，不再经过独立随机生成接口
- 页面层同样要求先确认探索点，再发起随机主题请求
- 随机分类值包含：`数字漫步`

#### 3. 组合主题

Web 前端调用：

- `POST /api/v1/ai/themes/combine`

小程序功能：

- 进阶模式“双主题组合生成”

结论：

- 可以直接共用
- 已接入

说明：

- 小程序传入 `categories/locationName/locationContext/walkMode`
- 与后端 `CombineThemeRequest` 一致
- 进阶模式下也必须先确认探索点，才会发起组合主题请求
- 纯粹模式只允许单主题，因此不会再调用组合接口
- 纯粹模式的“选择生成”统一走 `POST /api/v1/ai/themes/generate`
- 组合分类值已包含：`数字`

#### 4. 地点环境解析

Web 前端调用：

- `GET /api/v1/ai/location/context?lat=...&lng=...`

小程序功能：

- 根据选中的点生成 `locationContext`

结论：

- 可以共用
- 已接入，但当前 `useCloudMediaStorage: true` 时仍会强制走微信云存储

说明：

- 小程序原本更偏向“传对象后拿 context”
- Web 接口是标准 GET 参数形式
- 接入层会自动把小程序的 `latitude/longitude` 转成 `lat/lng`

#### 5. 地点搜索

Web 前端调用：

- `GET /api/v1/map/search?query=...`

小程序功能：

- 探索页地点搜索

结论：

- 可以共用
- 已接入为“Web 模式优先走后端搜索，云模式继续走高德 SDK”

说明：

- Web 模式下，小程序探索页优先调用 `/api/v1/map/search`
- 如果不是 Web 模式，仍然保持高德 SDK 搜索能力
- 这样既保留了当前可用能力，也向 Web 前端逻辑靠拢

#### 6. 文件上传

Web 前端调用：

- `POST /api/v1/files/upload`

小程序当前功能：

- 记录页上传图片、视频、录音

结论：

- 可以共用
- 已接入

说明：

- Web 前端上传接口返回 `fileId/url/contentType/size`
- 小程序当前只需要最终 URL
- 当前接入层已把小程序上传从旧的 `/uploads/media` 逻辑改成对齐 Web 的 `/api/v1/files/upload`
- 只有关闭 `useCloudMediaStorage` 后，才会真正走 Web 上传
- 同时把上传类型映射为：
  - 图片 -> `mission_media`
  - 视频 -> `video`
  - 音频 -> `audio`

#### 7. 保存漫步记录

Web 前端调用：

- `POST /api/v1/walks`

小程序当前功能：

- 记录页完成漫步并保存

结论：

- 可以接，但需要字段映射
- 已接入适配层，但当前 `useCloudWalkStorage: true` 时仍会强制走云函数 `createWalk`

说明：

- 小程序原始 payload 比 Web 前端更丰富
- 当前接入层已把小程序的保存结构映射到 Web `CreateWalkRequest`

主要映射如下：

- `themeSnapshot.title -> themeTitle`
- `themeSnapshot.category -> themeCategory`
- `locationName -> locationName`
- `routePoints -> path`
- `photoList[0] -> photoUrl`
- `videoList[0] -> videoUrl`
- `audioList[0] -> audioUrl`
- `missionsCompleted + missionReviews -> completedMissions`

`recordUnit` 当前采用推断策略：

- 有图片 -> `image`
- 无图片但有轨迹 -> `location`
- 其他情况 -> `event`

#### 8. 我的足迹 / 足迹详情

Web 前端调用：

- `GET /api/v1/walks/me`
- `GET /api/v1/walks/{id}`

小程序当前功能：

- 历史页
- 足迹详情页

结论：

- 基本可以接
- 已做兼容适配，但当前 `useCloudWalkStorage: true` 时仍会强制走云函数
- 小程序当前没有公共列表页，也没有 `listPublicWalks` service/page

说明：

- Web 接口返回的是扁平 `WalkResponse`
- 小程序原本更依赖带 `themeSnapshot`、`missionReviews` 的结构
- 当前接入层已做最小兼容重组：
  - 把 `themeTitle/themeCategory` 重组成 `themeSnapshot`
  - 把 `completedMissions` 转回小程序可读任务数组
  - 缺失字段使用默认值

但这部分只能算“可跑通”，还不是完全等价

---

## 4. 当前不能直接共用的功能

### 4.1 微信登录

Web 前端当前登录链路是：

- `GET /api/v1/auth/wechat/url`
- 跳转网页微信扫码登录
- 回调 `GET /api/v1/auth/wechat/callback`
- 后端重定向回网页并注入 token

小程序当前需要的是：

- `wx.login()`
- 小程序 code 换 openid / session_key
- 小程序本地保存 token 或 session

结论：

- 不能直接共用

原因：

- Web 当前是“网页扫码登录”模型
- 小程序需要“微信小程序登录”模型
- 两者虽然都叫微信登录，但协议入口不同、凭证不同、回调方式也不同

因此：

- 不能直接复用 Web 前端当前这套登录接口流程
- 也不应该强行拿网页扫码登录流程塞进小程序

### 4.2 用户资料同步

小程序当前有：

- `syncUser`

Web 前端当前有：

- `auth/me`
- `auth/login`
- `auth/logout`

结论：

- 不能直接一一对应
- 小程序代码里虽然配置了 `/api/v1/miniapp/auth/sync-user`，但它是过渡接口，不等同于 Web 前端的 `auth/me/login/logout` 链路

原因：

- Web 侧是标准登录态体系
- 小程序目前只是“头像昵称同步”思路
- 这两者语义不同

### 4.3 任务核验

小程序当前有：

- 任务拍照/录像/录音后做 AI 核验

Web 前端当前公开调用中没有：

- 与之完全等价的 `/api/v1/...` 共用接口

结论：

- 不能直接共用

原因：

- Web 前端服务层没有对应接口
- 后端当前可见的共用 Web Controller 里也没有这条标准 Web 前端链路

### 4.4 足迹详情字段完整度

虽然 `GET /api/v1/walks/{id}` 已经能接，但它和小程序详情页期望的数据结构并不完全一致。

差异主要在：

- Web 返回的是扁平字段
- 小程序详情页原本需要：
  - `themeSnapshot`
  - `missionReviews`
  - 更完整的路线、任务和媒体上下文

当前适配层只是做了兼容重组，不代表语义已经完全对齐。

### 4.5 同行模式

同行模式当前主要依赖微信云函数：

- `createTeamRoom`
- `getTeamRoomDetail`
- `joinTeamRoom`
- `startTeamWalk`
- `submitTeamContribution`
- `finishTeamWalk`
- `getTeamWalkDetail`
- `listMyTeamWalks`
- `deleteTeamWalk`
- `updateTeamMemberDraftState`
- `saveTeamMissionCard`

这些 endpoint 在 `miniprogram/services/api.js` 中多数只有 `cloudName`，没有 `web.path`。因此 Web 模式下不能把同行主链路视为已接入。

---

## 5. 当前两个项目的核心差异

### 5.1 AI 生成模块

差异不大，已经基本能统一。

可统一部分：

- 进阶 AI 生成
- 前端随机选主题后复用单主题生成
- 组合主题生成
- 地点环境生成

### 5.2 地图能力

Web 前端主要通过后端接口实现：

- 地点搜索 `/api/v1/map/search`
- 附近 POI `/api/v1/map/pois/nearby`

小程序当前是：

- 地图展示与浏览用微信 `map`
- 搜索和逆地理原本更依赖高德 SDK

当前状态：

- 搜索已经可以切到 Web 后端
- `fetchNearbyPois` 代理能力已经配置了 Web 后端 `/api/v1/map/pois/nearby`
- 探索页当前附近地点推荐主链路仍来自高德小程序 SDK 的逆地理 `getRegeo()`，没有直接调用 `fetchNearbyPois`
- 逆地理依然保留高德 SDK

这说明：

- 地图“展示与交互”仍然是小程序端能力
- 地图“语义搜索与环境信息”可以逐步往后端统一

### 5.3 漫步记录模型

Web 前端的保存结构更轻：

- `themeTitle`
- `themeCategory`
- `locationName`
- `recordUnit`
- `path`
- `completedMissions`
- 单个 `photoUrl/videoUrl/audioUrl`

小程序当前记录更重：

- `themeSnapshot`
- `locationContext`
- `locationAddress`
- `routePoints`
- `missionReviews`
- `photoList/videoList/audioList`
- `walkMode`
- `generationSource`

这意味着：

- 小程序当前记录模型更丰富
- Web 当前接口还没有完全容纳这部分扩展信息

所以现在的共用方案是：

- 小程序向 Web 接口提交一个“降维映射后的版本”

---

## 6. 当前代码层已经做的适配

### 6.1 已改动的文件

- [miniprogram/services/api.js](D:/liuliu-minimap/miniprogram/services/api.js)
- [miniprogram/services/map.js](D:/liuliu-minimap/miniprogram/services/map.js)
- [miniprogram/pages/index/index.js](D:/liuliu-minimap/miniprogram/pages/index/index.js)
- [miniprogram/utils/config.js](D:/liuliu-minimap/miniprogram/utils/config.js)

### 6.2 当前接入规则

当：

- `apiBaseUrl` 为空

则：

- 继续走原云开发逻辑

当：

- `apiBaseUrl` 有值

则：

- 已配置 Web endpoint 且未被云存储开关强制兜底的接口优先走 Web 共用接口 `/api/v1/**`

当前已经具备 Web endpoint 适配的能力包括：

- 主题生成
- 随机主题，前端随机选 `category` 后复用单主题生成接口
- 组合主题
- 地点环境
- 地点搜索
- `fetchNearbyPois` 代理能力
- 文件上传，需 `useCloudMediaStorage: false`
- 保存漫步 / 历史列表 / 详情查询 / 分享 / 删除，需 `useCloudWalkStorage: false`

当前仍主要依赖云函数的能力包括：

- 同行模式主链路
- 成就列表
- 默认配置下的单人记录和媒体上传
- 公共列表，小程序当前没有对应入口

---

## 7. 建议下一步怎么做

### 第一步：先联通能共用的主流程

建议先验证这条主流程：

1. 探索页搜索地点
2. 生成主题
3. 开始漫步
4. 如需测试 Web 上传，先关闭 `useCloudMediaStorage`
5. 如需测试 Web 保存和历史，先关闭 `useCloudWalkStorage`
6. 保存漫步记录
7. 历史页读取记录

这是当前最值得优先打通的一条链路。

### 第二步：后端补字段，而不是让小程序越来越绕

如果后续决定长期共用 Web 接口，建议 Spring Boot Web 接口逐步补齐：

- `locationContext`
- `locationAddress`
- 多媒体列表而不是单个 URL
- `themeSnapshot`
- `missionReviews`
- 更完整的轨迹与任务结构

这样小程序就不需要长期靠前端映射“降维提交”。

### 第三步：单独设计小程序登录共用方案

不要直接复用网页扫码登录流程。

建议改成：

- 小程序 `wx.login()`
- 新增或改造统一鉴权接口，让同一套用户体系同时支持：
  - Web 扫码登录
  - 小程序 code 登录

目标应该是：

- 共用用户表
- 共用 token 体系
- 不强行共用网页登录协议

### 第四步：补齐任务核验的 Web 共用接口

如果任务核验未来也要统一，建议把它补成标准 Web 接口，再让小程序调用，而不是继续停留在专用 miniapp 侧逻辑。

---

## 8. 一句话结论

当前小程序与 `D:\liuliu` 的 Web 后端，已经有相当一部分功能可以共用 Web 前端同款接口，尤其是：

- AI 主题生成
- 地点搜索与地点环境
- 文件上传
- 漫步记录保存
- 足迹列表与详情

但以下能力还不能直接共用：

- 微信登录
- 用户同步
- 任务核验
- 完整版足迹详情数据结构

所以当前最合理的策略是：

- 先把“探索 -> 生成 -> 记录 -> 上传 -> 保存 -> 历史”这条主流程统一到 Web 接口
- 对暂时无法统一的部分，在文档中明确保留差异
- 后续再通过补接口和补字段，把两端数据模型逐步拉齐
