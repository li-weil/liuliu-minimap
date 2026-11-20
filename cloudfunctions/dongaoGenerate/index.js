const cloud = require('wx-server-sdk');
const https = require('https');
const fileConfig = require('./config.ai.json');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const REQUEST_TIMEOUT_MS = Number(process.env.AI_REQUEST_TIMEOUT_MS || fileConfig.timeoutMs || 15000);

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
  const payload = await requestJson(
    `${config.baseUrl.replace(/\/$/, '')}/chat/completions`,
    JSON.stringify(requestBody)
  );
  const text = payload?.choices?.[0]?.message?.content || '';
  const stripped = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  return {
    parsed: JSON.parse(stripped || '{}'),
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

// === 用户画像（客群标签个性化） ===
const TAG_GLOSSARY = `东澳岛客群一级标签体系（与采集数据口径一致）：
- Z世代/情侣客群：出片打卡、浪漫仪式感、婚礼堂/蜜月阁/月牙环等浪漫机位；
- 亲子客群：沙滩玩沙戏水、寓教于乐、儿童俱乐部；
- 银发/休闲客群：慢节奏躺平、滨海栈道慢行、看海发呆、舒适省心；
- 资深玩家：小众深度探索、海鲜赶海尝鲜、人文历史（摩崖石刻/海关遗址/铳城）。`;

async function loadUserProfile(event) {
  let tags = null;
  try {
    const freshSince = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const res = await db.collection('userProfiles')
      .where({ _openid: cloud.getWXContext().OPENID, updatedAt: db.command.gt(freshSince) })
      .limit(1)
      .get();
    if (res.data && res.data.length && Array.isArray(res.data[0].tags)) {
      tags = res.data[0].tags;
    }
  } catch (err) {
    console.warn('loadUserProfile failed:', err && err.message);
  }
  if ((!tags || !tags.length) && Array.isArray(event && event.tags)) {
    tags = event.tags;
  }
  return Array.isArray(tags) ? tags.filter((t) => t && String(t).trim()).slice(0, 4) : [];
}

function buildUserProfileSection(tags) {
  if (!tags.length) return '\n\n【游客画像】暂无标签，按大众游客给出稳妥、安全的任务。';
  return `\n\n【游客画像】该游客的客群标签（按匹配度排序）：${tags.join('、')}。
任务与提示要贴合上述客群的兴趣与节奏（参照下方标签体系），让游客感到"这就是为我准备的"。
${TAG_GLOSSARY}`;
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

  const [guideData, weatherData, tideData, guideText] = await Promise.all([
    loadFile('cloud://cloud1-2gdui7md5af99e5c.636c-cloud1-2gdui7md5af99e5c-1418723303/dongao-content/' + mapName + '.json'),
    loadFile('cloud://cloud1-2gdui7md5af99e5c.636c-cloud1-2gdui7md5af99e5c-1418723303/dongao-data/weather.json'),
    loadFile('cloud://cloud1-2gdui7md5af99e5c.636c-cloud1-2gdui7md5af99e5c-1418723303/dongao-data/tide.json'),
    loadFile('cloud://cloud1-2gdui7md5af99e5c.636c-cloud1-2gdui7md5af99e5c-1418723303/dongao-data/guide.md'),
  ]);

  const time = getTimeContext();
  const [userTags] = await Promise.all([loadUserProfile(event)]);
  const weatherSummary = buildWeatherSummary(weatherData, time);
  const tideSummary = buildTideSummary(tideData, time);
  const envContext = buildEnvironmentContext(guideData);
  const sensoryInspo = buildSensoryInspiration(guideData);
  const visitorRules = typeof guideText === 'string' ? guideText.slice(0, 600) : '';

  // 2. Build prompt
  const systemPrompt = '你是遛遛小程序东澳岛模式的漫步任务助手。只返回合法 JSON，不要输出解释。语气温暖、活泼、像一位体贴的好友。直接给出简洁结果，不要犹豫、不要自我检查、不要多余说明。';

  const userPrompt = `为东澳岛景点"${mapName}"生成一条漫步任务和贴心小提示。

【景点信息】
${envContext || '暂无详细信息'}

【五感玩法灵感（仅供参考，不要直接复制）】
${sensoryInspo || '暂无'}
${buildUserProfileSection(userTags)}

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
    // Local fallback
    mission = `在${mapName}停下来，看看周围最吸引你的是什么`;
    tips = '放慢脚步，享受这一刻';
    safetyNote = '注意脚下安全';
  }

  // 4. Write to dongaoCards for history
  const cardRecord = {
    userId: wxContext.OPENID,
    spotName: mapName,
    mission,
    tips,
    safetyNote,
    weatherSnapshot: weatherSummary,
    tideSnapshot: tideSummary,
    createdAt: Date.now(),
    debug: {
      modelInput: {
        model: getAiConfig().model,
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

  try {
    await db.collection('dongaoCards').add({ data: savedCardRecord });
  } catch (err) {
    console.warn('Failed to save dongaoCard:', err.message);
  }

  return cardRecord;
};
