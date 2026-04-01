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

function firstJsonBlock(text) {
  const cleaned = stripCodeFence(text);
  const match = cleaned.match(/\{[\s\S]*\}/);
  return match ? match[0] : cleaned;
}

function parseJsonSafely(text, fallback = {}) {
  try {
    return JSON.parse(firstJsonBlock(text) || '{}');
  } catch (error) {
    return fallback;
  }
}

function normalizeList(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function getConfig() {
  return {
    apiKey: process.env.ARK_API_KEY || configFile.apiKey || '',
    baseUrl: process.env.ARK_BASE_URL || configFile.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3',
    textModel: process.env.ARK_TEXT_MODEL || configFile.textModel || 'doubao-seed-1.6-flash',
    visionModel: process.env.ARK_VISION_MODEL || configFile.visionModel || '',
    imageProvider: process.env.IMAGE_PROVIDER || configFile.imageProvider || 'wanx',
    dashscopeApiKey: process.env.DASHSCOPE_API_KEY || configFile.dashscopeApiKey || '',
    dashscopeBaseUrl: process.env.DASHSCOPE_BASE_URL || configFile.dashscopeBaseUrl || 'https://dashscope.aliyuncs.com/api/v1',
    wanxImageModel: process.env.WANX_IMAGE_MODEL || configFile.wanxImageModel || 'wan2.6-t2i',
    imageModel: process.env.ARK_IMAGE_MODEL || configFile.imageModel || 'doubao-seedream-4-0-250828',
    imageSize: process.env.ARK_IMAGE_SIZE || configFile.imageSize || '1024x1536',
    maxImageAttempts: Math.max(1, Number(process.env.ARK_MAX_IMAGE_ATTEMPTS || configFile.maxImageAttempts || 1)),
  };
}

async function chatCompletion({ model, systemPrompt, userContent }) {
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
    temperature: 0.6,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  }));

  return payload && payload.choices && payload.choices[0] && payload.choices[0].message
    ? payload.choices[0].message.content || ''
    : '';
}

async function chatJson({ model, systemPrompt, prompt }) {
  const text = await chatCompletion({
    model,
    systemPrompt,
    userContent: prompt,
  });
  return parseJsonSafely(text, {});
}

async function generateImage(prompt) {
  const config = getConfig();
  if (config.imageProvider === 'wanx') {
    if (!config.dashscopeApiKey) {
      throw new Error('missing_dashscope_api_key');
    }

    const createTask = await requestJson(`${config.dashscopeBaseUrl.replace(/\/$/, '')}/services/aigc/image-generation/generation`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.dashscopeApiKey}`,
        'X-DashScope-Async': 'enable',
      },
    }, JSON.stringify({
      model: config.wanxImageModel,
      input: {
        messages: [
          {
            role: 'user',
            content: [
              {
                text: prompt,
              },
            ],
          },
        ],
      },
      parameters: {
        size: config.imageSize,
        n: 1,
        prompt_extend: false,
        watermark: false,
        negative_prompt: '插画感，拼贴感，海报感，抽象道具，错误主体，漂浮元素，文字覆盖，画面逻辑错误',
      },
    }));

    const taskId = createTask && createTask.output ? createTask.output.task_id : '';
    if (!taskId) {
      throw new Error('missing_wanx_task_id');
    }

    const startedAt = Date.now();
    let taskResult = null;
    while (Date.now() - startedAt < REQUEST_TIMEOUT_MS - 5000) {
      taskResult = await requestJson(`${config.dashscopeBaseUrl.replace(/\/$/, '')}/tasks/${taskId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${config.dashscopeApiKey}`,
        },
      }, '');

      const status = taskResult && taskResult.output ? taskResult.output.task_status : '';
      if (status === 'SUCCEEDED') {
        break;
      }
      if (status === 'FAILED') {
        throw new Error(`wanx_task_failed: ${(taskResult && taskResult.output && taskResult.output.message) || 'unknown_reason'}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    const imageUrl = taskResult
      && taskResult.output
      && Array.isArray(taskResult.output.choices)
      && taskResult.output.choices[0]
      && taskResult.output.choices[0].message
      && Array.isArray(taskResult.output.choices[0].message.content)
      && taskResult.output.choices[0].message.content[0]
      ? taskResult.output.choices[0].message.content[0].image || ''
      : '';
    if (!imageUrl) {
      throw new Error('missing_wanx_generated_image');
    }
    return imageUrl;
  }

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
        '必须返回 relationType，用来描述任务和主体的关系，只能是 literal_object, reflection, shadow_or_trace, signboard, architectural_object 中的一个',
        '必须返回 mustShow，列出画面里必须真实出现的主体元素，2到4项',
        '必须返回 mustAvoid，列出绝对不能出现的错误替代物、错误构图或无关物件，3到6项',
        '必须返回 verificationChecklist，列出 3 到 5 条验图问题，问题必须能判断画面是否真正完成了这个任务',
        '必须返回 negativeSceneExamples，列出 2 到 4 个典型错误画法，帮助后续生图纠偏',
        '如果任务提到招牌、窗户、路灯、台阶、栏杆、摊位、门框等具体城市物件，就必须画成真实街景中的对应物件，不能用独立木牌、空白板、抽象雕塑、道具替身来替代',
        '如果任务提到带弧度的招牌、弧形门头、圆窗、拱门等形态，弧度必须出现在那个目标物本身，不能通过前景里无关的弧形木块、装置、路障、雕塑来冒充',
        '如果任务要求寻找某个物件，画面主角就必须是那个物件本身，且它应当占据足够视觉权重，不能被远景带过，也不能只出现一个模糊轮廓',
        '如果任务描述的是倒影、影子、投影、反射、痕迹，不能把它偷换成实体物件本身',
        '必须进行一次自检：确认画面中的主角是否就是任务所要求的关系结果，而不是替代品、象征物或逻辑上不成立的实体',
      ],
      outputFields: ['poem', 'title', 'focusMission', 'primaryObject', 'sceneBinding', 'objectState', 'relationType', 'visualPrompt', 'mustShow', 'mustAvoid', 'verificationChecklist', 'negativeSceneExamples', 'palette', 'ornaments'],
    },
  });
}

function inferMissionSpecificConstraints(focusMission) {
  const text = String(focusMission || '');
  const constraints = [];

  if (/倒影|影子|投影|反射|映在|映出|水中.*影|影在/.test(text) || /.+影/.test(text)) {
    constraints.push('This mission is about a reflection, shadow, projection, or mirrored trace, not about inventing a brand new physical creature or object in the scene.');
    constraints.push('Represent the subject through real reflection logic: puddle reflection, water reflection, glass reflection, shadow on wall/ground, or light projection that could naturally exist in the location.');
    constraints.push('Do not fabricate a fully solid standalone subject when the mission only asks for its shadow, reflection, silhouette, or trace.');
  }

  if (/雀影|鸟影|鸽影|燕影/.test(text)) {
    constraints.push('If the mission mentions a bird reflection or bird shadow, the key visual must be the reflected or shadow-like trace in water, glass, or on the ground, not a literal bird pasted into the scene.');
    constraints.push('Do not create a mural bird, painted bird, sticker bird, floating bird icon, or a bird that obviously does not belong to the location.');
    constraints.push('A bird body may be absent or only implied outside the frame; the reflection/shadow itself should be the main evidence.');
  }

  if (/倒影/.test(text)) {
    constraints.push('The reflected object must correspond to something that could truly exist around the scene, such as nearby architecture, trees, lamps, passersby, bicycles, or animals. No impossible reflected subject.');
  }

  if (/招牌/.test(text)) {
    constraints.push('If the mission mentions a signboard, it must be attached to a real shopfront or street facade and read visually as an actual signboard in use.');
  }

  return constraints;
}

function buildStickerImagePrompt(plan, verificationFeedback = [], attempt = 1) {
  const missionSpecificConstraints = inferMissionSpecificConstraints(plan.focusMission);
  const feedbackText = verificationFeedback.length
    ? `Previous failed attempts show these problems and they must be corrected this time: ${verificationFeedback.join(' ')}`
    : '';
  return [
    'Create a vertical citywalk background image with authentic real-world street photography quality.',
    `Current retry attempt: ${attempt}. If any previous attempt violated the mission, strictly correct it now rather than making a cosmetic variation.`,
    `Theme mood and atmosphere: ${(Array.isArray(plan.palette) ? plan.palette.join(', ') : '') || 'gentle, cinematic, poetic, urban'}.`,
    `Focus mission that must be visualized faithfully: ${plan.focusMission || ''}.`,
    `Primary object that must be the real protagonist: ${plan.primaryObject || ''}.`,
    `How the object must exist in the real scene: ${plan.sceneBinding || ''}.`,
    `Required object state and shape details: ${plan.objectState || ''}.`,
    `Mission relation type: ${plan.relationType || 'literal_object'}.`,
    `Visual direction: ${plan.visualPrompt || ''}.`,
    `Must show as real in-scene objects: ${Array.isArray(plan.mustShow) ? plan.mustShow.join(', ') : (plan.mustShow || '')}.`,
    `Must avoid completely: ${Array.isArray(plan.mustAvoid) ? plan.mustAvoid.join(', ') : (plan.mustAvoid || '')}.`,
    `Verification checklist to satisfy: ${Array.isArray(plan.verificationChecklist) ? plan.verificationChecklist.join(' ') : ''}.`,
    `Known wrong examples to avoid: ${Array.isArray(plan.negativeSceneExamples) ? plan.negativeSceneExamples.join(' ') : ''}.`,
    `Palette: ${Array.isArray(plan.palette) ? plan.palette.join(', ') : (plan.palette || '')}.`,
    `Decorative motifs: ${Array.isArray(plan.ornaments) ? plan.ornaments.join(', ') : (plan.ornaments || '')}.`,
    `Mission-specific realism constraints: ${missionSpecificConstraints.join(' ')}`,
    feedbackText,
    'The image must depict the mission literally and concretely, not symbolically. The main subject must be the actual mission object itself, not a proxy, metaphor, placeholder, abstract prop, or design mockup.',
    'The image must look like a real photograph captured in a believable urban scene, with documentary street-photo realism, natural lens perspective, physically plausible lighting, real materials, and real spatial depth.',
    'Prioritize photo realism over graphic design. It should feel like a camera captured a true scene in the city, not like a poster, collage, illustration, concept art, mural design, or graphic mockup.',
    'If the mission mentions a signboard, the signboard must be visibly installed on a real storefront, wall, facade, doorway, or street-side business structure. Do not replace it with a wooden block, abstract prop, sculpture, blank plaque, standalone object, tabletop mockup, or object placed on the ground.',
    'If the mission mentions curved or arched shapes, the curve must belong to the actual target object itself inside the real scene. Do not satisfy the curve using an unrelated foreground object, road barrier, sculpture, wooden slab, decorative prop, or random rounded shape.',
    'The mission object should be visually prominent and easy to identify at first glance, occupying a meaningful portion of the frame rather than appearing as a tiny distant detail.',
    'Nothing in the image may imply that the model invented a nonexistent object just to satisfy the task words. Every key visual element must obey real-world spatial logic.',
    'Use natural environmental detail, believable surfaces, real weather traces, and realistic street atmosphere. No stylized paper texture, no layered collage, no scrapbook edges, no painterly brushwork, no graphic overlays.',
    'The generated background image must not contain any poem text, title text, decorative title block, slogan, or calligraphy overlay. All poem and title text will be added later by the app UI.',
    'Do not reserve any text area. Do not create any wide blank wall, empty strip, pale side panel, margin column, poster frame, signage panel, hanging scroll, announcement board, lightbox, empty canvas, or any abrupt object aligned for text placement.',
    'No isolated object centered in foreground unless the mission explicitly asks for an isolated object. No placeholder object. No object mockup. No display stand. No prop introduced only to satisfy the task keywords.',
    'No illustration look, no collage look, no poster look, no mural look, no sticker look inside the generated background image itself.',
    'No readable text, no watermark, no logo. Especially no poem text, no title text, no vertical calligraphy, no slogan, no caption, no subtitle, and no decorative characters matching the poem.',
  ].join(' ');
}

function buildVerificationPrompt(plan) {
  return JSON.stringify({
    role: '验证城市漫步贴纸底图是否真的完成任务',
    task: {
      focusMission: plan.focusMission || '',
      relationType: plan.relationType || 'literal_object',
      primaryObject: plan.primaryObject || '',
      sceneBinding: plan.sceneBinding || '',
      objectState: plan.objectState || '',
      mustShow: plan.mustShow || [],
      mustAvoid: plan.mustAvoid || [],
      verificationChecklist: plan.verificationChecklist || [],
      negativeSceneExamples: plan.negativeSceneExamples || [],
    },
    requirements: [
      '你不是在评价美观度，而是在判断画面是否真正、严格、合逻辑地完成了任务',
      '如果任务是倒影、影子、反射、痕迹，不能把它误判成实体物件',
      '如果主体虽然出现了，但出现方式不合逻辑，也必须判 fail',
      '如果模型为了满足关键词虚构了不该存在的物体，也必须判 fail',
    ],
    outputFields: ['pass', 'score', 'issues', 'correctionPrompt'],
  });
}

async function verifyGeneratedImage(plan, imageUrl) {
  const config = getConfig();
  if (!config.visionModel) {
    return {
      pass: true,
      skipped: true,
      score: 100,
      issues: [],
      correctionPrompt: '',
    };
  }

  const raw = await chatCompletion({
    model: config.visionModel,
    systemPrompt: '你是严苛的城市漫步贴纸验图员。只返回合法 JSON，不要输出额外解释。',
    userContent: [
      {
        type: 'text',
        text: buildVerificationPrompt(plan),
      },
      {
        type: 'image_url',
        image_url: {
          url: imageUrl,
        },
      },
    ],
  });

  const parsed = parseJsonSafely(raw, {});
  return {
    pass: !!parsed.pass,
    skipped: false,
    score: Number(parsed.score || 0),
    issues: normalizeList(parsed.issues),
    correctionPrompt: String(parsed.correctionPrompt || '').trim(),
  };
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

function detectRelationType(focusMission) {
  const text = String(focusMission || '');
  if (/倒影|映在|映出|水中.*影|反射/.test(text)) {
    return 'reflection';
  }
  if (/影子|投影|影在/.test(text) || /.+影/.test(text)) {
    return 'shadow_or_trace';
  }
  if (/招牌/.test(text)) {
    return 'signboard';
  }
  if (/窗|门|栏杆|台阶|路灯|摊位|门框/.test(text)) {
    return 'architectural_object';
  }
  return 'literal_object';
}

function normalizePlan(plan, event) {
  const fallbackPoem = '把这一段路轻轻折进今天的风里';
  const poem = plan.poem || fallbackPoem;
  const focusMission = plan.focusMission || ((event.completedMissions && event.completedMissions[0]) || (event.missions && event.missions[0]) || '');
  const relationType = plan.relationType || detectRelationType(focusMission);
  return {
    title: plan.title || event.themeTitle || '漫步贴纸',
    poem,
    poemLines: splitPoemLines(poem),
    focusMission,
    primaryObject: plan.primaryObject || '',
    sceneBinding: plan.sceneBinding || '',
    objectState: plan.objectState || '',
    relationType,
    mustShow: normalizeList(plan.mustShow),
    mustAvoid: normalizeList(plan.mustAvoid),
    verificationChecklist: normalizeList(plan.verificationChecklist),
    negativeSceneExamples: normalizeList(plan.negativeSceneExamples),
    palette: normalizeList(plan.palette),
    ornaments: normalizeList(plan.ornaments),
    visualPrompt: plan.visualPrompt || '',
    generatedAt: Date.now(),
    version: 'sticker-plan-v2',
  };
}

exports.main = async (event) => {
  try {
    const stage = event.stage || 'full';
    if (stage === 'plan') {
      const rawPlan = await chatJson({
        model: getConfig().textModel,
        systemPrompt: '你是遛遛小程序的贴纸策展人，需要把城市漫步主题、地点和任务意象转成适合贴纸的诗句与画面方案。只返回 JSON。',
        prompt: buildPoemPrompt(event),
      });

      return {
        sticker: normalizePlan(rawPlan, event),
      };
    }

    const existingPlan = event.sticker || {};
    const config = getConfig();
    const verificationFeedback = [];
    let acceptedImageUrl = '';
    let acceptedPrompt = '';
    let lastVerification = {
      pass: true,
      skipped: true,
      score: 100,
      issues: [],
      correctionPrompt: '',
    };

    for (let attempt = 0; attempt < config.maxImageAttempts; attempt += 1) {
      const imagePrompt = buildStickerImagePrompt(existingPlan, verificationFeedback, attempt + 1);
      const remoteImageUrl = await generateImage(imagePrompt);
      const verification = await verifyGeneratedImage(existingPlan, remoteImageUrl);
      if (verification.pass) {
        acceptedImageUrl = remoteImageUrl;
        acceptedPrompt = imagePrompt;
        lastVerification = verification;
        break;
      }

      lastVerification = verification;
      verificationFeedback.push(...verification.issues.map((item) => `Validation issue: ${item}`));
      if (verification.correctionPrompt) {
        verificationFeedback.push(`Correction instruction: ${verification.correctionPrompt}`);
      }
    }

    if (!acceptedImageUrl) {
      throw new Error(`sticker_validation_failed_after_${config.maxImageAttempts}_attempts: ${(lastVerification.issues || []).join(' | ') || 'image_not_aligned_with_mission'}`);
    }

    const cloudFileId = await uploadGeneratedImage(acceptedImageUrl);

    return {
      sticker: {
        ...existingPlan,
        title: existingPlan.title || event.themeTitle || '漫步贴纸',
        poem: existingPlan.poem || '把这一段路轻轻折进今天的风里',
        poemLines: Array.isArray(existingPlan.poemLines) && existingPlan.poemLines.length
          ? existingPlan.poemLines
          : splitPoemLines(existingPlan.poem || '把这一段路轻轻折进今天的风里'),
        imageUrl: cloudFileId,
        backgroundUrl: acceptedImageUrl,
        imagePrompt: acceptedPrompt,
        verification: lastVerification,
        generatedAt: Date.now(),
        version: 'sticker-image-v2',
      },
    };
  } catch (error) {
    throw new Error(`generate_sticker_failed: ${error.message || 'unknown_error'}`);
  }
};
