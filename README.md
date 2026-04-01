# liuliu-miniapp

`liuliu-miniapp` 是 `liuliu` City Walk 项目的原生微信小程序端实现，当前围绕“探索 -> 生成任务 -> 漫步记录 -> 足迹回看”这一条主流程持续迭代。

## 当前状态

当前项目已经完成：

- 探索页主流程重构
- 纯粹模式与进阶模式双分支
- 微信 `map` + 高德 SDK 的地图能力接入
- 记录页任务打卡与轨迹记录
- 足迹列表与详情页基础展示
- 小程序服务层对 Web 共用接口的适配准备

当前项目仍保留两种后端运行方式：

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

## 关键文档

- [页面结构.md](D:/liuliu-minimap/docs/页面结构.md)
- [地图功能接入说明.md](D:/liuliu-minimap/docs/地图功能接入说明.md)
- [Web后端共用接口接入说明.md](D:/liuliu-minimap/docs/Web后端共用接口接入说明.md)
- [云函数登录系统说明.md](D:/liuliu-minimap/docs/云函数登录系统说明.md)

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

## 当前注意点

- 任务核验目前仍以云函数链路为主
- 云函数模式下已经具备基于 `OPENID` 的登录、用户资料同步与个人历史隔离
- 微信登录还没有完全统一到 Web 登录体系
- 如果切 Web 模式，仍需补齐小程序 token 与鉴权链路

## 一句话说明

这个仓库现在已经不是单纯的旧版云开发小程序，而是一个正在向“与 Web 后端共用接口”迁移中的微信小程序项目
