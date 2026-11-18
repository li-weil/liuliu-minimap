const cloud = require('wx-server-sdk');
const https = require('https');
const fileConfig = require('./config');
const corpusLib = require('./corpus');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const REQUEST_TIMEOUT_MS = Number(process.env.AI_REQUEST_TIMEOUT_MS || fileConfig.timeoutMs || 15000);

// === 语料库（MVP，并联新增；置 DONGAO_CORPUS_ENABLED=0 可整体回滚） ===
const CORPUS_ENABLED = process.env.DONGAO_CORPUS_ENABLED !== '0';
const CORPUS_CACHE_TTL_MS = 5 * 60 * 1000;
const CLOUD_FILE_ROOT = 'cloud://cloud1-2gdui7md5af99e5c.636c-cloud1-2gdui7md5af99e5c-1418723303/';
let corpusIndexCache = null;
const corpusSpotCache = Object.create(null);

function isCacheFresh(entry) {
  return !!entry && (Date.now() - entry.ts) < CORPUS_CACHE_TTL_MS;
}

// === AI call ===

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
              reject(new Error(parsed.error?.message || `http_${res.statusCode}`));
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

// 模型偶尔会在 JSON 前后多说一句话，直接 JSON.parse 会整条失败走兜底。
// 先按原样解析，失败再截取第一个 { 到最后一个 } 之间的内容。
function parseModelJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const candidates = [raw];
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(raw.slice(start, end + 1));
  for (let i = 0; i < candidates.length; i += 1) {
    try {
      const value = JSON.parse(candidates[i]);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch (e) { /* 尝试下一个候选 */ }
  }
  return null;
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
  const text = payload?.choices?.[0]?.message?.content || '';
  const stripped = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const parsed = parseModelJson(stripped);
  if (!parsed) throw new Error('invalid_model_json');
  return {
    parsed: parsed,
    rawText: text,
    strippedText: stripped,
    request: requestBody,
    response: payload,
  };
}

// === Context builders ===

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
  let season = '春';
  if (month >= 3 && month <= 5) season = '春';
  else if (month >= 6 && month <= 8) season = '夏';
  else if (month >= 9 && month <= 11) season = '秋';
  else season = '冬';
  return season;
}

function getTimeContext() {
  const now = getChinaNow();
  return {
    currentTime: formatChinaTime(now),
    season: getSeason(now),
    hour: now.getUTCHours(),
    minute: now.getUTCMinutes(),
  };
}

function extractList(data, keys) {
  for (const key of keys) {
    if (Array.isArray(data && data[key])) return data[key];
  }
  return [];
}

function parseClockMinutes(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const hour = Math.floor(value);
    if (hour >= 0 && hour <= 23) return hour * 60;
  }
  const text = String(value).trim();
  let match = text.match(/(\d{1,2}):(\d{2})/);
  if (match) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return hour * 60 + minute;
    }
  }
  match = text.match(/(\d{1,2})\s*时/);
  if (match) {
    const hour = Number(match[1]);
    if (hour >= 0 && hour <= 23) return hour * 60;
  }
  match = text.match(/\b(\d{1,2})\b/);
  if (match) {
    const hour = Number(match[1]);
    if (hour >= 0 && hour <= 23) return hour * 60;
  }
  return null;
}

function selectCurrentTimeRow(rows, nowMinutes) {
  const normalized = rows
    .map((row, index) => ({
      row,
      index,
      minutes: parseClockMinutes(row && (row.time || row.forecast_time || row.hour || row.datetime || row.date_time)),
    }))
    .filter(item => item.minutes !== null)
    .sort((a, b) => a.minutes - b.minutes);
  if (!normalized.length) return null;

  let selected = normalized[0];
  for (const item of normalized) {
    if (item.minutes <= nowMinutes) selected = item;
    else break;
  }
  return selected.row;
}

function pickField(data, keys) {
  for (const key of keys) {
    const value = data && data[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

function buildWeatherSummary(weather, timeContext) {
  if (!weather) return '天气数据暂无';
  const nowMinutes = timeContext.hour * 60 + timeContext.minute;
  const hourly = extractList(weather, ['hourly_forecast', 'hourlyForecast', 'hourly', 'forecast']);
  const selected = selectCurrentTimeRow(hourly, nowMinutes);
  const sunrise = pickField(weather.realtime || weather, ['sunrise', 'sunrise_time']);
  const sunset = pickField(weather.realtime || weather, ['sunset', 'sunset_time']);

  if (!selected) {
    const r = weather.realtime || {};
    const weatherText = pickField(r, ['current_weather', 'weather', 'text']);
    const temp = pickField(r, ['current_temp', 'temperature', 'temp']);
    const parts = [];
    if (weatherText) parts.push(weatherText);
    if (temp) parts.push(`${temp}°C`);
    if (sunrise || sunset) parts.push(`日出${sunrise || '未知'}，日落${sunset || '未知'}`);
    return parts.length ? parts.join('，') : '天气数据暂无';
  }

  const time = pickField(selected, ['time', 'forecast_time', 'hour', 'datetime', 'date_time']);
  const weatherText = pickField(selected, ['weather', 'weather_text', 'condition', 'text', 'phenomena']);
  const temp = pickField(selected, ['temp', 'temperature', 'current_temp']);
  const rain = pickField(selected, ['rain', 'precipitation', 'precip', 'rainfall']);
  const parts = [];
  if (time) parts.push(`${time}时段`);
  if (weatherText) parts.push(weatherText);
  if (temp) parts.push(`${temp}°C`);
  if (rain) parts.push(`降水${rain}`);
  if (sunrise || sunset) parts.push(`日出${sunrise || '未知'}，日落${sunset || '未知'}`);
  return parts.length ? parts.join('，') : '天气数据暂无';
}

function buildTideSummary(tide, timeContext) {
  const hourly = extractList(tide, ['hourly', 'hourly_tide', 'hourlyTide']);
  if (!hourly.length) return '';
  const nowMinutes = timeContext.hour * 60 + timeContext.minute;
  const rows = hourly
    .map(row => ({
      row,
      minutes: parseClockMinutes(row && (row.hour !== undefined ? row.hour : (row.time || row.tide_time || row.datetime || row.date_time))),
    }))
    .filter(item => item.minutes !== null)
    .sort((a, b) => a.minutes - b.minutes);
  if (!rows.length) return '';

  let selected = rows[0];
  for (const item of rows) {
    if (item.minutes <= nowMinutes) selected = item;
    else break;
  }
  const row = selected.row;
  const hour = row.hour !== undefined ? `${row.hour}时` : pickField(row, ['time', 'tide_time', 'datetime', 'date_time']);
  const height = pickField(row, ['height_m', 'height', 'tide_height']);
  const heightCm = pickField(row, ['height_cm']);
  const heightText = height ? `${height}m` : (heightCm ? `${heightCm}cm` : '未知');
  return `当前潮汐时段：${hour || '当前小时'}，潮高${heightText}`;
}

function buildEnvironmentContext(guideData) {
  if (!guideData) return '';
  const env = guideData.task1_environment || {};
  const parts = [];
  if (env.physical_features) parts.push(`环境：${env.physical_features}`);
  if (env.nearby_environment) parts.push(`周边：${env.nearby_environment}`);
  if (env.atmosphere && env.atmosphere.length) parts.push(`氛围：${env.atmosphere.join('、')}`);
  return parts.join('\n');
}

function buildSensoryInspiration(guideData) {
  if (!guideData || !guideData.task3_sensory_play) return '';
  const play = guideData.task3_sensory_play;
  const samples = [];
  ['色', '声', '形', '味'].forEach(sense => {
    const items = play[sense] || [];
    if (items.length) {
      const pick = items[Math.floor(Math.random() * items.length)];
      samples.push(`[${sense}] ${pick.name}：${pick.description}`);
    }
  });
  return samples.slice(0, 3).join('\n');
}

// === Main ===

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const mapName = String(event.map_name || '').trim();
  if (!mapName) return { mission: '', tips: '', safetyNote: '', spotName: '' };

  // 1. Load cloud storage files (guide content + weather + tide + visitor guide)
  const loadFile = async (fileID) => {
    try {
      const res = await cloud.downloadFile({ fileID });
      const text = res.fileContent.toString('utf-8');
      if (fileID.endsWith('.json')) return JSON.parse(text);
      return text;
    } catch (e) {
      console.warn(`Failed to load: ${fileID}`, e.message);
      return null;
    }
  };

  const loadCorpusIndex = async () => {
    if (!CORPUS_ENABLED) return null;
    if (isCacheFresh(corpusIndexCache)) return corpusIndexCache.data;
    const data = await loadFile(CLOUD_FILE_ROOT + 'dongao-corpus/_index.json');
    if (!data || typeof data !== 'object') return null;
    corpusIndexCache = { data, ts: Date.now() };
    return data;
  };

  const loadSpotCorpus = async (name) => {
    if (!CORPUS_ENABLED || !name) return null;
    const cached = corpusSpotCache[name];
    if (isCacheFresh(cached)) return cached.data;
    const data = await loadFile(CLOUD_FILE_ROOT + 'dongao-corpus/' + name + '.json');
    if (!data || typeof data !== 'object') return null;
    corpusSpotCache[name] = { data, ts: Date.now() };
    return data;
  };

  const [guideData, weatherData, tideData, guideText, spotCorpus, corpusIndex] = await Promise.all([
    loadFile(CLOUD_FILE_ROOT + 'dongao-content/' + mapName + '.json'),
    loadFile(CLOUD_FILE_ROOT + 'dongao-data/weather.json'),
    loadFile(CLOUD_FILE_ROOT + 'dongao-data/tide.json'),
    loadFile(CLOUD_FILE_ROOT + 'dongao-data/guide.md'),
    loadSpotCorpus(mapName),
    loadCorpusIndex(),
  ]);

  const time = getTimeContext();
  const weatherSummary = buildWeatherSummary(weatherData, time);
  const tideSummary = buildTideSummary(tideData, time);
  const envContext = buildEnvironmentContext(guideData);
  const sensoryInspo = buildSensoryInspiration(guideData);
  const visitorRules = typeof guideText === 'string' ? guideText.slice(0, 600) : '';

  // 语料检索（L1 点位档案 → L2 片区 → L3 风格样本）；为空则走原 prompt
  const preference = corpusLib.normalizePreference(event.preference);
  const recentMissions = corpusLib.normalizeRecentMissions(event.recentMissions);
  const corpusContext = corpusLib.buildCorpusContext({
    mapName,
    spot: spotCorpus,
    index: corpusIndex,
    preference,
    recentMissions,
  });

  // 2. Build prompt
  let systemPrompt = '你是遛遛小程序东澳岛模式的漫步任务助手。只返回合法 JSON，不要输出解释。语气温暖、活泼、像一位体贴的好友。';

  let userPrompt = `为东澳岛景点"${mapName}"生成一条漫步任务和贴心小提示。

【景点信息】
${envContext || '暂无详细信息'}

【五感玩法灵感（仅供参考，不要直接复制）】
${sensoryInspo || '暂无'}

【当前环境】
当前时间：${time.currentTime}，季节：${time.season}
天气：${weatherSummary}
${tideSummary}

【游客安全守则】
${visitorRules || '注意人身安全，遵守景区规定'}

【生成要求】
1. mission: 一条具体可执行的观察任务，14-28字。必须是"做一件小事情"，比如看、听、摸、闻、找。不能是空话或抽象描述。结合当前天气、时间和景点环境。任务要安全。
2. tips: 一条贴心小提示，12-24字。语气温暖，像朋友的关心。可以结合天气（比如防晒、带伞）、潮汐（赶海时机）、或当天的特别体验。
3. safetyNote: 一条安全提醒，8-16字。结合景点特点和当前天气/潮汐。比如海边湿滑、礁石注意、防晒提醒等。

返回 JSON：
{
  "mission": "任务文本",
  "tips": "小提示",
  "safetyNote": "安全提醒"
}`;

  // 餐饮点位走「美食推荐」prompt：不生成观察任务，而是点单推荐
  const isFoodMode = corpusContext.mode === 'food';
  if (corpusContext.text) {
    const promptV2 = isFoodMode
      ? corpusLib.buildPromptFoodV2({
        mapName,
        corpusText: corpusContext.text,
        weatherSummary,
        time,
        recentMissions,
      })
      : corpusLib.buildPromptV2({
        mapName,
        corpusText: corpusContext.text,
        envContext,
        sensoryInspo,
        weatherSummary,
        tideSummary,
        visitorRules,
        time,
        recentMissions,
      });
    systemPrompt = promptV2.systemPrompt;
    userPrompt = promptV2.userPrompt;
  }

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
    console.error('AI generation failed:', err.message);
    fallbackReason = err.message || 'unknown_error';
    // Local fallback：餐饮点位只复述菜单菜名，不新增事实
    if (isFoodMode) {
      const foodFallback = corpusLib.buildFoodFallback({ mapName, picks: corpusContext.picks });
      mission = foodFallback.mission;
      tips = foodFallback.tips;
      safetyNote = foodFallback.safetyNote;
    } else {
      mission = `在${mapName}停下来，看看周围最吸引你的是什么`;
      tips = '放慢脚步，享受这一刻';
      safetyNote = '注意脚下安全';
    }
  }

  // 模型返回 200 但内容为空时也要兜底，避免卡片空白
  if (!mission) {
    fallbackReason = fallbackReason || 'empty_mission';
    if (isFoodMode) {
      const foodFallback = corpusLib.buildFoodFallback({ mapName, picks: corpusContext.picks });
      mission = foodFallback.mission;
      tips = tips || foodFallback.tips;
      safetyNote = safetyNote || foodFallback.safetyNote;
    } else {
      mission = `在${mapName}停下来，看看周围最吸引你的是什么`;
      tips = tips || '放慢脚步，享受这一刻';
      safetyNote = safetyNote || '注意脚下安全';
    }
  }

  // 4. Write to dongaoCards for history
  const cardRecord = {
    userId: wxContext.OPENID,
    spotName: mapName,
    mode: isFoodMode ? 'food' : 'spot',
    mission,
    tips,
    safetyNote,
    weatherSnapshot: weatherSummary,
    tideSnapshot: tideSummary,
    createdAt: Date.now(),
    debug: {
      modelInput: {
        model: getAiConfig().model,
        mode: isFoodMode ? 'food' : 'spot',
        corpus: corpusContext.stats,
        currentTime: time.currentTime,
        weatherSummary,
        tideSummary,
        systemPrompt,
        userPrompt,
        contextSummary: {
          spotName: mapName,
          time,
          weatherSummary,
          tideSummary,
          hasGuideData: !!guideData,
          hasWeatherData: !!weatherData,
          hasTideData: !!tideData,
          hasVisitorGuide: !!guideText,
        },
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

  // 控制台/CLI 调用没有 OPENID，写进去只会污染历史卡片，直接跳过。
  if (wxContext.OPENID) {
    try {
      await db.collection('dongaoCards').add({ data: savedCardRecord });
    } catch (err) {
      console.warn('Failed to save dongaoCard:', err.message);
    }
  } else {
    console.log('[CARD] skip history write: no OPENID (console/CLI invocation)');
  }

  return cardRecord;
};
