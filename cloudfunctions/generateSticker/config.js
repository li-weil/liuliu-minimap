module.exports = {
  // 火山引擎方舟 API Key（用于文本推理）
  apiKey: 'f0462aee-4fe0-4b65-a83e-faa5fd120924',

  // 方舟 OpenAI 兼容地址
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',

  // 豆包文本模型接入点 ID
  // 建议填写你在火山方舟“在线推理/自定义推理接入点”里创建出来的 endpoint id
  // 不是直接填展示名称，很多账号直接用模型名会报无权限或不存在
  textModel: 'ep-20260401023326-j7z49',

  // 豆包视觉理解模型接入点 ID
  // 用于对生成后的贴纸背景图做一致性验收
  // 请填写支持图像理解的视觉模型 endpoint id；如果留空，将跳过验图回路
  visionModel: '',

  // 生图提供方：wanx 或 doubao
  imageProvider: 'wanx',

  // 阿里云百炼 API Key（用于万相生图）
  dashscopeApiKey: 'sk-31d83bd7de5640cc9fe3f148ae49cffd',

  // 百炼北京地域基地址
  dashscopeBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',

  // 万相文生图模型
  // 官方文档推荐写实场景可用 wan2.6-t2i
  wanxImageModel: 'wan2.6-t2i',

  // 豆包图像生成模型
  // 如果 imageProvider 改回 doubao，会使用这个模型
  imageModel: 'doubao-seedream-4-0-250828',

  // 贴纸生成尺寸
  // 万相支持 512~1440 范围内宽高组合，竖版贴纸这里建议使用 1024*1440
  imageSize: '1024*1440',

  // 验图失败后的自动重试次数上限
  maxImageAttempts: 4,

  timeoutMs: 55000,
};
