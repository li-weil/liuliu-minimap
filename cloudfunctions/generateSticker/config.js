module.exports = {
  // 火山引擎方舟 API Key
  apiKey: 'f0462aee-4fe0-4b65-a83e-faa5fd120924',

  // 方舟 OpenAI 兼容地址
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',

  // 豆包文本模型接入点 ID
  // 建议填写你在火山方舟“在线推理/自定义推理接入点”里创建出来的 endpoint id
  // 不是直接填展示名称，很多账号直接用模型名会报无权限或不存在
  textModel: 'ep-20260401023326-j7z49',

  // 豆包图像生成模型
  // 这个模型名按当前官方示例可直接使用，如你的账号无权限可替换成控制台可用模型
  imageModel: 'doubao-seedream-4-0-250828',

  // 贴纸生成尺寸
  imageSize: '2K',

  timeoutMs: 55000,
};
