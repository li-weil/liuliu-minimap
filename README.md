# liuliu-miniapp

`liuliu-miniapp` 是 `liuliu` City Walk 项目的原生微信小程序端。主流程是：探索 -> 生成任务 -> 漫步记录 -> 足迹回看。

## 项目状态

已经完成：

- 探索页主流程重构
- 纯粹模式与进阶模式双分支
- 纯粹模式主题单选，进阶模式支持 1 到 2 个主题方向
- 两种模式都必须先设定探索点（当前定位、搜索地点或选择附近地点）后，才能生成主题并开始漫步
- 微信 `map` + 高德 SDK 的地图能力接入
- 记录页任务打卡与轨迹记录
- 足迹页“纪念卡册 / 成就”双模块展示
- 纪念卡册支持按“状态 + 记录类型”组合筛选记录
- 单人足迹详情页支持一键分享给微信朋友，并在分享时自动开放该记录
- 单人模式：开始时创建记录，保存时结束记录
- 同行模式：建房 -> 开始 -> 多人提交 -> 房主结束
- 探索页、足迹页、个人页主背景基色统一为 `#f5f2ed`
- 小程序服务层已为 Web 共用接口做适配
- 漫步主题已统一为 `形状 / 色彩 / 声音 / 数字 / 气味`
- AI 主题生成已接入结构化 `contextPacket`、规则检查和前端调试面板；生成逻辑统一在 `generation-runtime`

项目保留两种后端运行方式：

- 云开发兜底模式
- Web 后端共用接口模式

是否实际走 Web 后端，由这里控制：

- [miniprogram/utils/config.js](D:/liuliu-minimap/miniprogram/utils/config.js)

当 `apiBaseUrl` 为空时：

- 继续走微信云函数和云存储

当 `apiBaseUrl` 有值时：

- 优先走 Spring Boot Web 共用接口 `/api/v1/**`

## 项目结构

- [miniprogram](D:/liuliu-minimap/miniprogram)：小程序前端代码
- [cloudfunctions](D:/liuliu-minimap/cloudfunctions)：云开发兜底逻辑
- [docs](D:/liuliu-minimap/docs)：产品结构、接入说明、参考图

云函数共享逻辑：

- 成就重算规则的单一源码在 [achievement-runtime.js](D:/liuliu-minimap/cloudfunctions/shared/achievement-runtime.js)
- 修改后执行 `node scripts/sync_cloud_achievement_runtime.js`，再统一部署相关云函数
- AI 主题生成共享运行时的单一源码在 [generation-runtime.js](D:/liuliu-minimap/cloudfunctions/shared/generation-runtime.js)
- 修改后执行 `node scripts/sync_cloud_generation_runtime.js`，会同步 `runtime.js`，再统一部署以下云函数：
  - `generateTheme`
  - `generateCombinedTheme`

主题生成说明：

- 探索页“随机生成”现在已统一并入 `generateTheme`
- 前端只负责随机挑一个主题方向，再调用单主题生成
- 旧的随机主题云函数已下线，不再部署独立随机生成云函数

部署云环境时，还要检查云函数权限规则：

- 推荐直接使用 [云开发环境重建说明.md](D:/liuliu-minimap/docs/云开发环境重建说明.md) 里的最终规则 JSON
- 不建议继续使用 `auth.loginType != 'ANONYMOUS'` 这类未写进当前官方推荐示例的表达式
- 至少要单独放开 `syncUser`、`fetchNearbyPois`、`getLocationContext`、`generateTheme`、`generateCombinedTheme`

同行房间旧数据修复：

- 如果历史数据里还有 `dissolved` 状态的同行记录，使用一次性云函数修复，不要用本地脚本直连云数据库。

- 先部署云函数：

`cloudfunctions/repairDissolvedTeamRooms`

- 再在微信开发者工具里调用：

```bash
wx.cloud.callFunction({
  name: 'repairDissolvedTeamRooms',
  data: { dryRun: true, limit: 100 }
})

wx.cloud.callFunction({
  name: 'repairDissolvedTeamRooms',
  data: { dryRun: false, limit: 100 }
})
```

- 这个云函数会把旧的 `dissolved` 房间批量改为 `finished`，补齐 `endedAt / teamSummary / teamStats`，让它们在纪念卡册里正常显示为“已结束”，并可继续删除。

字体静态资源：

- 品牌字体不再从 `fonts.gstatic.com` 直拉
- 请把字体文件上传到你自己的微信云托管静态站点
- 然后在 [config.js](/D:/liuliu-minimap/miniprogram/utils/config.js) 中配置 `brandFontBaseUrl`

## 关键文档

- [页面结构.md](D:/liuliu-minimap/docs/页面结构.md)
- [AI主题任务内容全流程说明.md](D:/liuliu-minimap/docs/AI主题任务内容全流程说明.md)
- [地图功能接入说明.md](D:/liuliu-minimap/docs/地图功能接入说明.md)
- [Web后端共用接口接入说明.md](D:/liuliu-minimap/docs/Web后端共用接口接入说明.md)
- [云函数登录系统说明.md](D:/liuliu-minimap/docs/云函数登录系统说明.md)
- [成就系统功能实现说明.md](D:/liuliu-minimap/docs/成就系统功能实现说明.md)
- [项目功能板块-页面与云函数链路总览.md](D:/liuliu-minimap/docs/项目功能板块-页面与云函数链路总览.md)
- [历史遗留清理.md](D:/liuliu-minimap/docs/历史遗留清理.md)

## 成就系统部署

成就系统现在采用“云端统一计算 + `userAchievements` 持久化 + 前端展示”。

上线或迁移云环境时，至少确认：

1. 云数据库存在 `userAchievements` 集合
2. 已部署以下相关云函数：
   - `createWalk`
   - `finishTeamWalk`
   - `listMyAchievements`
   - `deleteWalk`
   - `deleteTeamWalk`
3. 如果修改了成就规则，先执行：

```bash
node scripts/sync_cloud_achievement_runtime.js
```

再重新部署上面 5 个云函数。

## 本地开发

1. 用微信开发者工具导入当前项目
2. 确认小程序根目录为 `miniprogram/`
3. 打开 [config.js](D:/liuliu-minimap/miniprogram/utils/config.js)
4. 按当前开发目标选择运行方式

云开发模式：

- 保持 `apiBaseUrl: ''`
- 使用现有 `cloudEnvId`

Web 后端模式：

- 把 `apiBaseUrl` 改成你的线上域名，例如 `https://your-domain.com`
- 确保服务端已经把 `/api/v1/` 和 `/uploads/` 反向代理到 Spring Boot

## 注意点

- 任务核验仍以云函数流程为主
- 云函数模式下已经具备基于 `OPENID` 的登录、用户资料同步与个人历史隔离
- 单人进行中记录会按 `walkId` 保存草稿；如果另一端已结束该记录，当前记录页会自动退出并回到“足迹 - 纪念卡册”
- 同行房间详情对未加入用户仅返回基础预览信息，不再暴露成员、贡献和动态流
- 已结束同行记录支持“仅删除我自己的可见记录”，不会联动删除其他成员视角
- 微信登录还没有完全统一到 Web 登录体系
- 如果切 Web 模式，仍需补齐小程序 token 与鉴权链路

## 主流程

单人模式：

1. 探索页生成主题后点击“开始这次漫步”
   生成主题前必须先设定探索点
2. 立即创建一条 `active` 状态的单人记录
3. 记录页围绕这条记录持续编辑本地草稿
4. 点击“完成本次漫步并保存”后，更新同一条记录并标记为 `finished`

同行模式：

1. 探索页切到“同行”并生成主题
   生成主题前必须先设定探索点
2. 创建一个 `waiting` 状态的同行房间
3. 队友加入后，房主开始同行，房间变为 `active`
4. 成员围绕共享任务提交各自贡献
5. 房主结束同行后，房间变为 `finished`，并进入团队结果页

## 一句话说明

这个仓库已经不只是旧版云开发小程序。它仍保留云开发兜底，同时正在向“与 Web 后端共用接口”的方向迁移。
