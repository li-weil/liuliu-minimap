const https = require('https');
const crypto = require('crypto');
const cloud = require('wx-server-sdk');
const configFile = require('./config');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const REQUEST_TIMEOUT_MS = Number(configFile.timeoutMs || 20000);

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
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error(`sticker_timeout_${REQUEST_TIMEOUT_MS}ms`)));
    req.write(body);
    req.end();
  });
}

function downloadBuffer(urlString) {
  const url = new URL(urlString);
  return new Promise((resolve, reject) => {
    const req = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error(`download_timeout_${REQUEST_TIMEOUT_MS}ms`)));
    req.end();
  });
}

function stripCodeFence(text) {
  return String(text || '').replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
}

function getConfig() {
  return {
    apiKey: process.env.ARK_API_KEY || configFile.apiKey || '',
    baseUrl: process.env.ARK_BASE_URL || configFile.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3',
    textModel: process.env.ARK_TEXT_MODEL || configFile.textModel || 'doubao-seed-1.6-flash',
    imageModel: process.env.ARK_IMAGE_MODEL || configFile.imageModel || 'doubao-seedream-4-0-250828',
    imageSize: process.env.ARK_IMAGE_SIZE || configFile.imageSize || '1024x1536',
  };
}

async function chatJson({ model, systemPrompt, prompt }) {
  const config = getConfig();
  if (!config.apiKey) {
    throw new Error('missing_ark_api_key');
  }

  const payload = await requestJson(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
  }, JSON.stringify({
    model,
    temperature: 0.8,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
  }));

  const text = payload && payload.choices && payload.choices[0] && payload.choices[0].message
    ? payload.choices[0].message.content || ''
    : '';
  return JSON.parse(stripCodeFence(text) || '{}');
}

async function generateImage(prompt) {
  const config = getConfig();
  if (!config.apiKey) {
    throw new Error('missing_ark_api_key');
  }

  const payload = await requestJson(`${config.baseUrl.replace(/\/$/, '')}/images/generations`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
  }, JSON.stringify({
    model: config.imageModel,
    prompt,
    sequential_image_generation: 'disabled',
    size: config.imageSize,
    n: 1,
    response_format: 'url',
    stream: false,
    watermark: true,
  }));

  const imageUrl = payload && payload.data && payload.data[0]
    ? payload.data[0].url || payload.data[0].b64_json || ''
    : '';
  if (!imageUrl) {
    throw new Error('missing_generated_image');
  }
  return imageUrl;
}

async function uploadGeneratedImage(imageUrl) {
  const buffer = await downloadBuffer(imageUrl);
  const file = await cloud.uploadFile({
    cloudPath: `stickers/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.png`,
    fileContent: buffer,
  });
  return file.fileID;
}

function buildPoemPrompt(event) {
  return JSON.stringify({
    role: '为城市漫步生成打卡贴纸文案',
    input: {
      themeTitle: event.themeTitle,
      themeDescription: event.themeDescription,
      themeCategory: event.themeCategory,
      walkMode: event.walkMode,
      locationName: event.locationName,
      locationContext: event.locationContext,
      overallNoteText: event.overallNoteText,
      missions: event.missions || [],
      completedMissions: event.completedMissions || [],
    },
    requirements: {
      poem: '生成一句 12 到 24 字的中文短诗，可以偏古意，也可以偏近代散文诗，但不要空泛鸡汤，不要口号。整句尽量由 2 到 4 个短分句组成，每个分句 4 到 8 字，并用中文逗号或顿号断开，便于后续逐行排版',
      visualPrompt: '生成贴纸底图提示词，画面要和主题、地点、任务意象一致，适合竖版打卡贴纸。必须从 missions 或 completedMissions 中选一个最具体、最好画的任务作为视觉主任务，而且这个任务里的目标物必须被字面、真实、具体地画出来',
      title: '生成一个 4 到 10 字的小标题',
      layout: '画面必须是完整满幅构图，不要为了题字刻意腾出任何空白区域，不要出现与题字位置对应的大块空墙、空纸面、空幕布、空招牌、空边栏。允许正常真实场景，但禁止任何明显为文字预留的留白带。不要在底图里直接生成可读文字',
      grounding: [
        '必须返回 focusMission，内容是你最终选中的那个任务原句',
        '必须返回 primaryObject，内容是任务里最核心、最需要被画出来的那个具体物件，必须是名词短语',
        '必须返回 sceneBinding，说明这个物件应该如何真实地附着在街景里，例如挂在店门口、装在墙面、嵌在建筑立面、立在真实摊位上，而不是独立道具',
        '必须返回 objectState，说明这个物件在画面里应该具备的关键形态特征。如果任务提到弧度、对称、裂纹、反光、颜色等，这里必须明确写出来',
        '必须返回 mustShow，列出画面里必须真实出现的主体元素，2到4项',
        '必须返回 mustAvoid，列出绝对不能出现的错误替代物、错误构图或无关物件，3到6项',
        '如果任务提到招牌、窗户、路灯、台阶、栏杆、摊位、门框等具体城市物件，就必须画成真实街景中的对应物件，不能用独立木牌、空白板、抽象雕塑、道具替身来替代',
        '如果任务提到带弧度的招牌、弧形门头、圆窗、拱门等形态，弧度必须出现在那个目标物本身，不能通过前景里无关的弧形木块、装置、路障、雕塑来冒充',
        '如果任务要求寻找某个物件，画面主角就必须是那个物件本身，且它应当占据足够视觉权重，不能被远景带过，也不能只出现一个模糊轮廓',
        '必须进行一次自检：确认画面中的主角是否就是任务物件本体，而不是替代品或象征物',
      ],
      outputFields: ['poem', 'title', 'focusMission', 'primaryObject', 'sceneBinding', 'objectState', 'visualPrompt', 'mustShow', 'mustAvoid', 'palette', 'ornaments'],
    },
  });
}

function buildStickerImagePrompt(plan) {
  return [
    'Create a premium vertical citywalk check-in sticker poster, Chinese aesthetic, collectible sticker feeling.',
    `Theme title: ${plan.title || '城市漫步贴纸'}.`,
    `Poem mood reference: ${plan.poem || ''}.`,
    `Focus mission that must be visualized faithfully: ${plan.focusMission || ''}.`,
    `Primary object that must be the real protagonist: ${plan.primaryObject || ''}.`,
    `How the object must exist in the real scene: ${plan.sceneBinding || ''}.`,
    `Required object state and shape details: ${plan.objectState || ''}.`,
    `Visual direction: ${plan.visualPrompt || ''}.`,
    `Must show as real in-scene objects: ${Array.isArray(plan.mustShow) ? plan.mustShow.join(', ') : (plan.mustShow || '')}.`,
    `Must avoid completely: ${Array.isArray(plan.mustAvoid) ? plan.mustAvoid.join(', ') : (plan.mustAvoid || '')}.`,
    `Palette: ${Array.isArray(plan.palette) ? plan.palette.join(', ') : (plan.palette || '')}.`,
    `Decorative motifs: ${Array.isArray(plan.ornaments) ? plan.ornaments.join(', ') : (plan.ornaments || '')}.`,
    'The image must depict the mission literally and concretely, not symbolically. The main subject must be the actual mission object itself, not a proxy, metaphor, placeholder, abstract prop, or design mockup.',
    'If the mission mentions a signboard, the signboard must be visibly installed on a real storefront, wall, facade, doorway, or street-side business structure. Do not replace it with a wooden block, abstract prop, sculpture, blank plaque, standalone object, tabletop mockup, or object placed on the ground.',
    'If the mission mentions curved or arched shapes, the curve must belong to the actual target object itself inside the real scene. Do not satisfy the curve using an unrelated foreground object, road barrier, sculpture, wooden slab, decorative prop, or random rounded shape.',
    'The mission object should be visually prominent and easy to identify at first glance, occupying a meaningful portion of the frame rather than appearing as a tiny distant detail.',
    'Warm paper texture, layered collage, cinematic light, refined full-bleed composition, rich visual content across the whole frame.',
    'Do not reserve any text area. Do not create any wide blank wall, empty strip, pale side panel, margin column, poster frame, signage panel, hanging scroll, announcement board, lightbox, empty canvas, or any abrupt object aligned for text placement.',
    'No isolated object centered in foreground unless the mission explicitly asks for an isolated object. No placeholder object. No object mockup. No display stand. No prop introduced only to satisfy the task keywords.',
    'No readable text, no watermark, no logo.',
  ].join(' ');
}

function splitPoemLines(poem) {
  const normalized = String(poem || '').replace(/[。！？]+$/g, '');
  const lines = normalized
    .split(/[，、；]/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (lines.length) {
    return lines;
  }
  const compact = normalized.replace(/\s+/g, '');
  const result = [];
  for (let index = 0; index < compact.length; index += 6) {
    result.push(compact.slice(index, index + 6));
  }
  return result.filter(Boolean);
}

exports.main = async (event) => {
  try {
    const stage = event.stage || 'full';
    if (stage === 'plan') {
      const plan = await chatJson({
        model: getConfig().textModel,
        systemPrompt: '你是遛遛小程序的贴纸策展人，需要把城市漫步主题、地点和任务意象转成适合贴纸的诗句与画面方案。只返回 JSON。',
        prompt: buildPoemPrompt(event),
      });

      return {
        sticker: {
          title: plan.title || event.themeTitle || '漫步贴纸',
          poem: plan.poem || '把这一段路轻轻折进今天的风里',
          poemLines: splitPoemLines(plan.poem || '把这一段路轻轻折进今天的风里'),
          focusMission: plan.focusMission || ((event.completedMissions && event.completedMissions[0]) || (event.missions && event.missions[0]) || ''),
          primaryObject: plan.primaryObject || '',
          sceneBinding: plan.sceneBinding || '',
          objectState: plan.objectState || '',
          mustShow: Array.isArray(plan.mustShow) ? plan.mustShow : [],
          mustAvoid: Array.isArray(plan.mustAvoid) ? plan.mustAvoid : [],
          palette: plan.palette || [],
          ornaments: plan.ornaments || [],
          visualPrompt: plan.visualPrompt || '',
          generatedAt: Date.now(),
          version: 'sticker-plan-v1',
        },
      };
    }

    const existingPlan = event.sticker || {};
    const imagePrompt = buildStickerImagePrompt(existingPlan);
    const remoteImageUrl = await generateImage(imagePrompt);
    const cloudFileId = await uploadGeneratedImage(remoteImageUrl);

    return {
      sticker: {
        ...existingPlan,
        title: existingPlan.title || event.themeTitle || '漫步贴纸',
        poem: existingPlan.poem || '把这一段路轻轻折进今天的风里',
        poemLines: Array.isArray(existingPlan.poemLines) && existingPlan.poemLines.length
          ? existingPlan.poemLines
          : splitPoemLines(existingPlan.poem || '把这一段路轻轻折进今天的风里'),
        imageUrl: cloudFileId,
        backgroundUrl: remoteImageUrl,
        imagePrompt,
        generatedAt: Date.now(),
        version: 'sticker-image-v1',
      },
    };
  } catch (error) {
    throw new Error(`generate_sticker_failed: ${error.message || 'unknown_error'}`);
  }
};
