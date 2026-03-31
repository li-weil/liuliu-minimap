const https = require('https');
const fileConfig = require('./config');

const REQUEST_TIMEOUT_MS = Number(process.env.AI_REQUEST_TIMEOUT_MS || fileConfig.timeoutMs || 12000);

function requestJson(urlString, options, body) {
  const url = new URL(urlString);
  return new Promise((resolve, reject) => {
    const req = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: options.method || 'POST',
      headers: options.headers,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data || '{}');
          if (res.statusCode >= 400) {
            reject(new Error(parsed.error && parsed.error.message ? parsed.error.message : `http_${res.statusCode}`));
            return;
          }
          resolve(parsed);
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error(`ai_request_timeout_${REQUEST_TIMEOUT_MS}ms`)));
    req.write(body);
    req.end();
  });
}

function stripCodeFence(text) {
  return String(text || '').replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
}

function getAiConfig() {
  return {
    apiKey: process.env.AI_API_KEY || fileConfig.apiKey || '',
    baseUrl: process.env.AI_BASE_URL || fileConfig.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    visionModel: process.env.AI_VISION_MODEL || fileConfig.visionModel || 'qwen3.5-plus',
    audioModel: process.env.AI_AUDIO_MODEL || fileConfig.audioModel || 'qwen3-omni-30b-a3b-captioner',
    textModel: process.env.AI_TEXT_MODEL || fileConfig.textModel || 'qwen-plus',
  };
}

async function chatJson({ model, systemPrompt, content, temperature = 0.2 }) {
  const config = getAiConfig();
  if (!config.apiKey) {
    throw new Error('missing_ai_api_key');
  }

  const payload = await requestJson(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
  }, JSON.stringify({
    model,
    temperature,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content },
    ],
  }));

  const text = payload && payload.choices && payload.choices[0] && payload.choices[0].message
    ? payload.choices[0].message.content || ''
    : '';
  return JSON.parse(stripCodeFence(text) || '{}');
}

async function analyzeVisualMission({ mission, missionNoteText, overallNoteText, imageUrls, videoUrls }) {
  if ((!imageUrls || !imageUrls.length) && (!videoUrls || !videoUrls.length)) {
    return {
      score: 0,
      evidence: [],
      summary: '没有视觉素材',
      confidence: 'low',
    };
  }

  const config = getAiConfig();
  const content = [
    {
      type: 'text',
      text: [
        `任务内容：${mission}`,
        `任务备注：${missionNoteText || '无'}`,
        `本次漫步整体备注：${overallNoteText || '无'}`,
        '请判断这些图片和视频是否体现了任务要求，并只返回 JSON。',
        '字段为 score、summary、evidence、confidence。',
        'score 为 0 到 100 的整数，evidence 为简短证据数组。',
      ].join('\n'),
    },
    ...(imageUrls || []).map((url) => ({ type: 'image_url', image_url: { url } })),
    ...(videoUrls || []).map((url) => ({ type: 'video_url', video_url: { url } })),
  ];

  return chatJson({
    model: config.visionModel,
    systemPrompt: '你是城市漫步任务核验助手，需要依据图片和视频判断任务是否完成，保持鼓励但客观。',
    content,
    temperature: 0.1,
  });
}

async function analyzeSingleAudio({ mission, missionNoteText, overallNoteText, audioUrl }) {
  const config = getAiConfig();
  return chatJson({
    model: config.audioModel,
    systemPrompt: '你是城市漫步任务核验助手，需要依据录音内容判断任务是否完成，保持鼓励但客观。',
    content: [
      {
        type: 'text',
        text: [
          `任务内容：${mission}`,
          `任务备注：${missionNoteText || '无'}`,
          `本次漫步整体备注：${overallNoteText || '无'}`,
          '请先理解这段录音，再只返回 JSON。',
          '字段为 score、summary、evidence、confidence、transcript。',
          'score 为 0 到 100 的整数，evidence 为简短证据数组。',
        ].join('\n'),
      },
      {
        type: 'input_audio',
        input_audio: {
          url: audioUrl,
          format: 'mp3',
        },
      },
    ],
    temperature: 0.1,
  });
}

async function analyzeAudioMission({ mission, missionNoteText, overallNoteText, audioUrls }) {
  if (!audioUrls || !audioUrls.length) {
    return {
      score: 0,
      evidence: [],
      summary: '没有音频素材',
      confidence: 'low',
      transcriptSnippets: [],
    };
  }

  const results = [];
  for (const audioUrl of audioUrls) {
    // DashScope 的音频 caption 模型一次只处理一个音频
    // 顺序执行可以减少云函数内并发失败的概率
    // eslint-disable-next-line no-await-in-loop
    const result = await analyzeSingleAudio({ mission, missionNoteText, overallNoteText, audioUrl });
    results.push(result);
  }

  const score = Math.round(results.reduce((total, item) => total + Number(item.score || 0), 0) / results.length);
  const evidence = results.flatMap((item) => Array.isArray(item.evidence) ? item.evidence : []).slice(0, 4);
  const transcriptSnippets = results.map((item) => item.transcript).filter(Boolean).slice(0, 3);
  const confidence = results.some((item) => item.confidence === 'high')
    ? 'high'
    : results.some((item) => item.confidence === 'medium')
      ? 'medium'
      : 'low';

  return {
    score,
    evidence,
    summary: results.map((item) => item.summary).filter(Boolean).join('；') || '已完成音频分析',
    confidence,
    transcriptSnippets,
  };
}

async function summarizeMissionReview({ mission, missionNoteText, overallNoteText, visualResult, audioResult, mediaSummary }) {
  const config = getAiConfig();
  return chatJson({
    model: config.textModel,
    systemPrompt: '你是遛遛小程序的任务打卡评分助手。请综合多模态分析结果，温和但准确地给出最终评分和结论。',
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          mission,
          missionNoteText,
          overallNoteText,
          mediaSummary,
          visualResult,
          audioResult,
          outputRequirement: {
            passedRule: 'score >= 60 则 passed 为 true',
            fields: ['passed', 'score', 'comment', 'evidence', 'confidence'],
          },
        }),
      },
    ],
    temperature: 0.2,
  });
}

module.exports = {
  analyzeAudioMission,
  analyzeVisualMission,
  summarizeMissionReview,
};
