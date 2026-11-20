const https = require('https');
const cloud = require('wx-server-sdk');
const configFile = require('./config');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const REQUEST_TIMEOUT_MS = Number(process.env.AI_REQUEST_TIMEOUT_MS || configFile.timeoutMs || 12000);

function requestJson(urlString, options, body) {
  const url = new URL(urlString);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: options.method || 'POST',
        headers: options.headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data || '{}');
            if (res.statusCode >= 400) {
              const message = parsed.error && parsed.error.message ? parsed.error.message : `http_${res.statusCode}`;
              reject(new Error(message));
              return;
            }
            resolve(parsed);
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`ai_request_timeout_${REQUEST_TIMEOUT_MS}ms`));
    });
    req.write(body);
    req.end();
  });
}

function stripCodeFence(text) {
  return String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function getConfig() {
  return {
    apiKey: process.env.ARK_API_KEY || configFile.apiKey || '',
    baseUrl: process.env.ARK_BASE_URL || configFile.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3',
    textModel: process.env.ARK_TEXT_MODEL || configFile.textModel || 'ep-20260401023326-j7z49',
  };
}

async function chatJson({ model, systemPrompt, prompt }) {
  const config = getConfig();
  if (!config.apiKey) {
    throw new Error('missing_ark_api_key');
  }

  const payload = await requestJson(
    `${config.baseUrl.replace(/\/$/, '')}/chat/completions`,
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
    },
    JSON.stringify({
      model,
      temperature: 0.8,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
    })
  );

  const text = payload && payload.choices && payload.choices[0] && payload.choices[0].message
    ? payload.choices[0].message.content || ''
    : '';
  return JSON.parse(stripCodeFence(text) || '{}');
}

function normalizePhotoList(photoList) {
  return (Array.isArray(photoList) ? photoList : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 3);
}

function buildCompanionCardPrompt(event) {
  return JSON.stringify({
    role: '为遛遛小程序的打卡卡片生成吉祥物陪伴记录',
    mascot: {
      name: '66',
      species: '小猫',
      persona: '66 是用户城市漫步时一路陪伴的旅伴，观察细腻、温柔、俏皮，不抢戏，但有自己的感受',
    },
    input: {
      themeTitle: event.themeTitle || '',
      locationName: event.locationName || '',
      locationContext: event.locationContext || '',
      mission: event.mission || '',
      userNoteText: event.userNoteText || '',
      photoList: normalizePhotoList(event.photoList),
      previousCompanionNote: event.previousCompanionNote || '',
      regenerationHint: event.regenerationHint || '',
    },
    requirements: {
      perspective: '必须使用 66 小猫的第一人称视角，像旅伴在记录同行见闻',
      tone: '温柔、灵动、有陪伴感，可以有一点小猫观察世界的敏感，但不要幼稚，不要过度卖萌',
      length: '中文 60 到 100 字',
      grounding: [
        '必须结合主题、任务、地点和用户记录内容',
        '如果有图片记录，要把图片里可能体现的信息当作辅助线索',
        '要像 66 真正陪用户走过这段路，而不是抽象赞美',
        '不要复述用户原文，要形成另一个视角',
        '如果提供了 previousCompanionNote，新的 companionNote 必须明显换一个观察角度、措辞和意象，不能只是同义改写',
        '不要输出标题，不要输出解释，只返回 JSON',
      ],
      outputFields: ['companionNote'],
    },
  });
}

exports.main = async (event) => {
  try {
    const result = await chatJson({
      model: getConfig().textModel,
      systemPrompt: '你是遛遛小程序吉祥物 66 的文案作者。请严格返回 JSON。',
      prompt: buildCompanionCardPrompt(event || {}),
    });

    return {
      companionNote: String(result.companionNote || '').trim(),
    };
  } catch (error) {
    throw new Error(`generate_companion_note_failed: ${error.message || 'unknown_error'}`);
  }
};
