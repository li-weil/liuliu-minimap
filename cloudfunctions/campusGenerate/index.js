const cloud = require('wx-server-sdk');
const https = require('https');
const fileConfig = require('./config.json');

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
    temperature: 0.9,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };
  const payload = await requestJson(
    `${config.baseUrl.replace(/\/$/, '')}/chat/completions`,
    JSON.stringify(requestBody)
  );
  const text = (payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content) || '';
  const stripped = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  return {
    parsed: JSON.parse(stripped || '{}'),
    rawText: text,
    strippedText: stripped,
    request: requestBody,
    response: payload,
  };
}

// === 时间与开放判断 ===

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

function pickSensoryOne(play) {
  const result = [];
  if (!play || typeof play !== 'object') return result;
  ['色', '声', '形', '味'].forEach((sense) => {
    const items = Array.isArray(play[sense]) ? play[sense] : [];
    if (items.length) {
      const item = items[0];
      result.push(`【${sense}】${item.name}：${item.description}`);
    }
  });
  return result;
}

function buildGuideContext(guideData) {
  if (!guideData || typeof guideData !== 'object') return '';
  const env = guideData.task1_environment || {};
  const parts = [];
  if (env.physical_features) parts.push(`环境：${env.physical_features}`);
  if (env.nearby_environment) parts.push(`周边：${env.nearby_environment}`);
  if (Array.isArray(env.atmosphere) && env.atmosphere.length) parts.push(`氛围：${env.atmosphere.join('、')}`);
  const sensory = pickSensoryOne(guideData.task3_sensory_play);
  if (sensory.length) parts.push(`五感玩法：${sensory.join('；')}`);
  return parts.join('\n');
}

// === Main ===

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const mapName = String(event.map_name || '').trim();
  const tag = String(event.tag || '').trim() || '景点';
  if (!mapName) return { mission: '', tips: '', safetyNote: '', spotName: '' };

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
  const guideContext = buildGuideContext(guideData);
  const openHoursText = (guideData && guideData.openHours) ? guideData.openHours : '';
  const themeTips = (guideData && guideData.themeTips && Array.isArray(guideData.themeTips[tag]))
    ? guideData.themeTips[tag]
    : [];

  const THEME_META = {
    美食: { name: '美食', focus: '推荐这里怎么吃、吃什么、有什么招牌窗口或好吃的小店', fallbackMission: `在${mapName}看看窗口和招牌，挑一份最想吃的` },
    历史: { name: '历史', focus: '这里的故事、意义、纪念点，值得了解什么', fallbackMission: `在${mapName}看看铭牌和介绍，记住一个关于它的故事` },
    景点: { name: '景点', focus: '这里有什么看点、怎么逛、怎么打卡', fallbackMission: `在${mapName}走走看看，找一处最吸引你的角落` },
  };
  const meta = THEME_META[tag] || THEME_META.景点;

  // 2. Build prompt（带开放时间判断）
  const systemPrompt = `你是遛遛小程序「校园导览」的任务助手，服务中山大学珠海校区。只返回合法 JSON，不要输出解释。语气像一位熟悉校园的学长学姐，温暖、自然、不堆砌词藻。`;

  const userPrompt = `为地点「${mapName}」生成一条「${meta.name}」主题的校园导览任务。

【地点信息】
${guideContext || '暂无详细信息'}

【${meta.name}主题素材】
${themeTips.length ? themeTips.join('\n') : '暂无，请基于地点信息合理生成'}

【开放时间】
${openHoursText || '未提供，视为正常开放'}

【当前时间】
${time.currentTime}，${time.season}季，${time.weekday}

【生成要求】
1. 先根据开放时间判断当前是否适合前往：若当前明显不开放（如已闭馆、周一闭馆），在 tips 里提醒"开放时间以官方为准/建议改天"；无法判断则视为开放。
2. mission：一条具体可执行的任务，14-30字，围绕「${meta.focus}」。必须是"做一件小事情"（看/听/闻/找/尝/读），结合地点真实环境，不要空话。
3. tips：一条贴心的提示，8-20字。两类内容都可以写：(a) 实用建议，(b) 礼仪文明提醒——保持安静、勿打扰自习的同学、文明参观、不要乱碰展品。语气像学长的随口提醒。
4. safetyNote：一条**只和安全相关**的提醒，8-18字。只写人身安全内容：注意脚下台阶、路面湿滑、防滑、防晒补水、不要靠近水边或危险区域。**不要写礼仪、文明、安静类内容**（那些放 tips）。



返回 JSON：
{
  "mission": "任务文本",
  "tips": "小提示",
  "safetyNote": "安全提醒"
}`;

  // 3. Call AI with fallback
  let mission = '', tips = '', safetyNote = '';
  let rawModelText = '';
  let parsedModelJson = null;
  let modelResponseMeta = null;
  let fallbackReason = '';
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
    mission = String(generated.mission || '').trim();
    tips = String(generated.tips || '').trim();
    safetyNote = String(generated.safetyNote || '').trim();
  } catch (err) {
    console.error('[campusGenerate] AI generation failed:', err.message);
    fallbackReason = err.message || 'unknown_error';
    mission = meta.fallbackMission;
    tips = '放慢脚步，看看路牌和介绍，会有收获';
    safetyNote = '注意开放时间，文明参观';
  }

  // 4. 写 campusCards 历史
  const cardRecord = {
    userId: wxContext.OPENID,
    spotName: mapName,
    tag,
    mission,
    tips,
    safetyNote,
    openHoursSnapshot: openHoursText,
    createdAt: Date.now(),
    debug: {
      modelInput: {
        model: getAiConfig().model,
        currentTime: time.currentTime,
        tag,
        hasGuideData: !!guideData,
        guideLoadError,
        guideContext,
        openHoursText,
        themeTips,
        systemPrompt,
        userPrompt,
      },
      modelOutput: {
        rawText: rawModelText,
        parsedJson: parsedModelJson,
        responseMeta: modelResponseMeta,
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
