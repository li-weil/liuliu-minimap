const cloud = require('wx-server-sdk');
const https = require('https');
const fileConfig = require('./config.ai.json');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const REQUEST_TIMEOUT_MS = Number(process.env.AI_REQUEST_TIMEOUT_MS || fileConfig.timeoutMs || 15000);

// === AI call（同东澳岛 dongaoGenerate，模型配置可被环境变量覆盖）===

function getAiConfig() {
  return {
    apiKey: process.env.DEEPSEEK_API_KEY || process.env.AI_API_KEY || fileConfig.apiKey || '',
    baseUrl: process.env.DEEPSEEK_BASE_URL || process.env.AI_BASE_URL || fileConfig.baseUrl || 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_CHAT_MODEL || process.env.AI_CHAT_MODEL || fileConfig.model || 'deepseek-v4-flash',
  };
}

function requestJson(urlString, body) {
  const url = new URL(urlString);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAiConfig().apiKey}`,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data || '{}');
            if (res.statusCode >= 400) {
              reject(new Error((parsed.error && parsed.error.message) || `http_${res.statusCode}`));
              return;
            }
            resolve(parsed);
          } catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('timeout')));
    req.write(body);
    req.end();
  });
}

async function chatJson(systemPrompt, userPrompt) {
  const config = getAiConfig();
  if (!config.apiKey) throw new Error('missing_ai_api_key');

  const requestBody = {
    model: config.model,
    temperature: 0.5,
    max_tokens: 2048,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };

  // 解析容错：最多尝试 2 次（偶发截断/JSON 不完整时重试一次即可成功）
  let lastError = null;
  let lastPayload = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const startedAt = Date.now();
    const payload = await requestJson(
      `${config.baseUrl.replace(/\/$/, '')}/chat/completions`,
      JSON.stringify(requestBody)
    );
    const elapsedMs = Date.now() - startedAt;
    const text = (payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content) || '';
    const stripped = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
    lastPayload = payload;
    try {
      return {
        parsed: JSON.parse(stripped || '{}'),
        rawText: text,
        strippedText: stripped,
        request: requestBody,
        response: payload,
        elapsedMs,
        attempts: attempt + 1,
      };
    } catch (error) {
      lastError = error;
      lastError.rawText = text;
      lastError.strippedText = stripped;
      lastError.finishReason = payload && payload.choices && payload.choices[0] ? payload.choices[0].finish_reason || '' : '';
      lastError.attempt = attempt + 1;
    }
  }
  throw lastError;
}

// === 时间 ===

function getChinaNow() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatChinaTime(now) {
  return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())} ${pad2(now.getUTCHours())}:${pad2(now.getUTCMinutes())}`;
}

function getSeason(now) {
  const month = now.getUTCMonth() + 1;
  if (month >= 3 && month <= 5) return '春';
  if (month >= 6 && month <= 8) return '夏';
  if (month >= 9 && month <= 11) return '秋';
  return '冬';
}

function getWeekday(now) {
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return weekdays[now.getUTCDay()];
}

function getTimeContext() {
  const now = getChinaNow();
  return {
    currentTime: formatChinaTime(now),
    season: getSeason(now),
    weekday: getWeekday(now),
    hour: now.getUTCHours(),
  };
}

// === 攻略素材提取 ===

function toLines(list, fallback) {
  if (!Array.isArray(list) || !list.length) return fallback;
  return list.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

// 随机抽样：保持多样性并缩短 prompt（每次生成抽不同条目，也辅助避开雷同）
function sampleItems(list, max) {
  if (!Array.isArray(list) || !list.length) return [];
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, max);
}

function formatSensoryExamples(list) {
  if (!Array.isArray(list) || !list.length) return '';
  return list.map((s) => `- ${s.sense}｜${s.name}：${s.description}`).join('\n');
}

// === Main ===

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const mapName = String(event.map_name || '').trim();
  const tag = String(event.tag || '').trim() || '景点';
  const lastTask = String(event.lastTask || '').trim();
  if (!mapName) return { mainTask: '', sensoryTask: null, tips: '', safetyNote: '', spotName: '' };

  // 1. 读取攻略（云存储 campus-content/{map_name}.json，文件名与 map_name 一致，中文名不编码）
  let guideData = null;
  let guideLoadError = '';
  try {
    const fileID = `cloud://cloud1-2gdui7md5af99e5c.636c-cloud1-2gdui7md5af99e5c-1418723303/campus-content/${mapName}.json`;
    const res = await cloud.downloadFile({ fileID });
    guideData = JSON.parse(res.fileContent.toString('utf-8'));
  } catch (e) {
    guideLoadError = e.message || String(e);
    console.warn(`[campusGenerate] guide load failed: ${mapName}`, guideLoadError);
  }

  const time = getTimeContext();

  // 按主题取素材：themeTips 主题介绍（理解用）、mainTasks 主任务素材库、sensoryExamples 感官任务示例、tips 提示素材库
  const themeIntro = (guideData && guideData.themeTips && typeof guideData.themeTips[tag] === 'string')
    ? guideData.themeTips[tag]
    : '';
  const mainTasksAll = (guideData && guideData.mainTasks && Array.isArray(guideData.mainTasks[tag]))
    ? guideData.mainTasks[tag]
    : [];
  const tipPoolAll = (guideData && guideData.tips && Array.isArray(guideData.tips[tag]))
    ? guideData.tips[tag]
    : [];
  const sensoryAll = (guideData && guideData.sensoryExamples && Array.isArray(guideData.sensoryExamples[tag]))
    ? guideData.sensoryExamples[tag]
    : [];
  const openHoursText = (guideData && guideData.openHours) ? guideData.openHours : '';

  // 抽样传入 prompt（控制长度、加快生成、增加每次差异）
  const mainTasks = sampleItems(mainTasksAll, 5);
  const tipPool = sampleItems(tipPoolAll, 4);
  const sensoryExamples = sampleItems(sensoryAll, 3);

  const THEME_META = {
    美食: { name: '美食', fallbackMain: `在${mapName}看看窗口和招牌，挑一份最想吃的` },
    历史: { name: '历史', fallbackMain: `在${mapName}看看铭牌和介绍，记住一个关于它的故事` },
    景点: { name: '景点', fallbackMain: `在${mapName}走走看看，找一处最吸引你的角落` },
  };
  const meta = THEME_META[tag] || THEME_META.景点;

  // 2. Build prompt（主题理解已包含地点环境，不再重复传基础信息）
  const systemPrompt = `你是遛遛小程序「校园导览」的任务助手，服务中山大学珠海校区。只返回合法 JSON，不要输出解释。语气像一位熟悉校园的学长学姐，温暖、自然、不堆砌词藻。直接给出简洁结果，不要犹豫、不要自我检查、不要多余说明。`;

  const userPrompt = `为地点「${mapName}」生成一条「${meta.name}」主题的校园导览任务。

【主题理解】
${themeIntro || `请基于「${mapName}」的实际情况理解这个地点`}

【主任务素材库】（从真实攻略提炼的具体可做的事，本次抽取部分）
${toLines(mainTasks, '暂无素材，请合理生成一件具体的事')}

【感官任务示例】（感官任务是对主任务的延伸和补充，参考此格式）
${formatSensoryExamples(sensoryExamples) || '暂无示例，感官任务请从主任务自然延伸'}

【提示素材库】（从真实攻略提炼的注意/实用提醒，本次抽取部分；生成 tips 时从这里挑选）
${toLines(tipPool, '暂无素材，请结合开放时间与当前时间合理生成')}

${lastTask ? `【上次生成的主任务】（请避开与其雷同的内容，换一件不同的事）
${lastTask}` : ''}

【开放时间】
${openHoursText || '未提供，视为正常开放'}

【当前时间】
${time.currentTime}，${time.season}季，${time.weekday}

【生成要求】
1. mainTask：主导览任务。从【主任务素材库】中挑选或组合、或基于素材合理衍生一件具体的事，14-30字。必须是"做一件小事情"（看/听/闻/找/尝/读/拍/爬），结合地点真实环境，不要空话。若提供了【上次生成的主任务】，必须避开与其雷同的内容。
2. sensoryTask：感官任务（副任务），是对 mainTask 的延伸和补充，让玩法更丰富。参考【感官任务示例】格式输出一个对象：{"sense":"色|声|形|味","name":"具体可观察对象","description":"怎么观察，12-25字"}。必须与主任务相关、具体可执行、口语化，禁止 AI 腔套话。
3. tips：一条贴心的提示，12-26字。优先从【提示素材库】挑选最合适的一条（可结合开放时间、当前时间、季节微调），也可以补充礼仪文明提醒（保持安静、勿打扰、文明参观）。不要自己编造素材库里没有的禁忌信息。语气像学长的随口提醒。
4. safetyNote：一条**只和安全相关**的提醒，8-18字。只写人身安全内容：注意脚下台阶、路面湿滑、防滑、防晒补水、不要靠近水边或危险区域。不要写礼仪、文明、安静类内容（那些放 tips）。

⚠️ 区分：
- tips = 实用建议 + 礼仪文明（怎么做更好、安静、勿打扰、文明参观）
- safetyNote = 只写人身安全（脚下、湿滑、防晒、远离危险）

返回 JSON：
{
  "mainTask": "主导览任务",
  "sensoryTask": {"sense": "色", "name": "对象", "description": "观察方式"},
  "tips": "提示",
  "safetyNote": "安全提醒"
}`;

  // 3. Call AI with fallback
  let mainTask = '', sensoryTask = null, tips = '', safetyNote = '';
  let rawModelText = '';
  let strippedText = '';
  let parsedModelJson = null;
  let modelResponseMeta = null;
  let fallbackReason = '';
  let aiRequestInfo = null;
  try {
    const aiResult = await chatJson(systemPrompt, userPrompt);
    const generated = aiResult.parsed || {};
    rawModelText = aiResult.rawText || '';
    parsedModelJson = generated;
    modelResponseMeta = {
      id: aiResult.response && aiResult.response.id,
      model: aiResult.response && aiResult.response.model,
      usage: aiResult.response && aiResult.response.usage,
      created: aiResult.response && aiResult.response.created,
    };
    aiRequestInfo = {
      model: aiResult.request && aiResult.request.model,
      baseUrl: getAiConfig().baseUrl,
      apiKeySet: true,
      elapsedMs: aiResult.elapsedMs,
      attempts: aiResult.attempts,
    };
    mainTask = String(generated.mainTask || '').trim() || meta.fallbackMain;
    const st = generated.sensoryTask;
    sensoryTask = (st && typeof st === 'object' && st.sense && st.name)
      ? { sense: String(st.sense).trim(), name: String(st.name).trim(), description: String(st.description || '').trim() }
      : null;
    tips = String(generated.tips || '').trim();
    safetyNote = String(generated.safetyNote || '').trim();
  } catch (err) {
    console.error('[campusGenerate] AI generation failed:', err.message);
    fallbackReason = err.message || 'unknown_error';
    if (err.rawText) rawModelText = err.rawText;
    if (err.strippedText) strippedText = err.strippedText;
    aiRequestInfo = {
      model: getAiConfig().model,
      baseUrl: getAiConfig().baseUrl,
      apiKeySet: !!getAiConfig().apiKey,
      error: err.message || '',
      finishReason: err.finishReason || '',
    };
    mainTask = meta.fallbackMain;
    sensoryTask = null;
    tips = '放慢脚步，看看路牌和介绍，会有收获';
    safetyNote = '注意开放时间，文明参观';
  }

  // 4. 写 campusCards 历史
  const cardRecord = {
    userId: wxContext.OPENID,
    spotName: mapName,
    tag,
    mainTask,
    sensoryTask,
    tips,
    safetyNote,
    openHoursSnapshot: openHoursText,
    createdAt: Date.now(),
    debug: {
      modelInput: {
        // 真正传给模型的 prompt（与 chatJson 请求完全一致）
        systemPrompt,
        userPrompt,
      },
      modelOutput: {
        rawText: rawModelText,
        strippedText,
        parsedJson: parsedModelJson,
        responseMeta: modelResponseMeta,
        requestInfo: aiRequestInfo,
        usedFallback: !!fallbackReason,
        fallbackReason,
      },
    },
  };

  const { debug, ...savedCardRecord } = cardRecord;
  try {
    await db.collection('campusCards').add({ data: savedCardRecord });
  } catch (err) {
    console.warn('[campusGenerate] Failed to save campusCard:', err.message);
  }

  return cardRecord;
};
