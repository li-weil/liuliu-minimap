const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
  timeout: 60000,
});

const GUIDE_FILE_ID = 'cloud://cloud1-2gdui7md5af99e5c.636c-cloud1-2gdui7md5af99e5c-1418723303/dongao-data/guide.md';
const WEATHER_FILE_ID = 'cloud://cloud1-2gdui7md5af99e5c.636c-cloud1-2gdui7md5af99e5c-1418723303/dongao-data/weather.json';
const TIDE_FILE_ID = 'cloud://cloud1-2gdui7md5af99e5c.636c-cloud1-2gdui7md5af99e5c-1418723303/dongao-data/tide.json';
const KNOWLEDGE_MAX_CHARS = 6000;
const HISTORY_MAX_TURNS = 6;
// 具体用哪个对话模型取决于云开发环境里已开通的模型，按顺序尝试
const MODEL_CANDIDATES = ['deepseek-v3', 'hy3', 'hunyuan-lite'];

const TAG_GLOSSARY = `东澳岛客群一级标签体系（用于个性化推荐，与岛上采集数据口径一致）：
- Z世代/情侣客群：出片打卡、浪漫仪式感、婚礼堂/蜜月阁/月牙环等浪漫机位；
- 亲子客群：沙滩玩沙戏水、寓教于乐、亲子酒店与儿童俱乐部；
- 银发/休闲客群：慢节奏度假躺平、滨海栈道慢行、看海发呆、舒适省心；
- 资深玩家：小众深度探索、海鲜赶海尝鲜、人文历史（摩崖石刻/海关遗址/铳城）。
同一景点可能同时适配多类客群，二级/三级标签描述具体玩法。`;

function loadGuideKnowledge() {
  return cloud.downloadFile({ fileID: GUIDE_FILE_ID })
    .then((res) => res.fileContent.toString('utf-8').slice(0, KNOWLEDGE_MAX_CHARS))
    .catch(() => '');
}

function loadJsonFile(fileID) {
  return cloud.downloadFile({ fileID })
    .then((res) => {
      try {
        return JSON.parse(res.fileContent.toString('utf-8'));
      } catch (e) {
        return null;
      }
    })
    .catch(() => null);
}

// —— 天气/潮汐摘要（与 dongaoGenerate 同口径，保证两个 AI 看到的实况一致）——
function pad2(n) {
  return String(n).padStart(2, '0');
}

function getChinaNow() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000);
}

function getTimeContext() {
  const now = getChinaNow();
  return { hour: now.getUTCHours(), minute: now.getUTCMinutes() };
}

function extractList(data, keys) {
  for (const key of keys) {
    if (Array.isArray(data && data[key])) return data[key];
  }
  return [];
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
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return hour * 60 + minute;
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
    .map((row) => ({ row, minutes: parseClockMinutes(row && (row.time || row.forecast_time || row.hour || row.datetime || row.date_time)) }))
    .filter((item) => item.minutes !== null)
    .sort((a, b) => a.minutes - b.minutes);
  if (!normalized.length) return null;
  let selected = normalized[0];
  for (const item of normalized) {
    if (item.minutes <= nowMinutes) selected = item;
    else break;
  }
  return selected.row;
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
    .map((row) => ({ row, minutes: parseClockMinutes(row && (row.hour !== undefined ? row.hour : (row.time || row.tide_time || row.datetime || row.date_time))) }))
    .filter((item) => item.minutes !== null)
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

function buildEnvironmentSection(weather, tide) {
  if (!weather && !tide) return '';
  const timeContext = getTimeContext();
  const now = getChinaNow();
  const clock = `${pad2(now.getUTCHours())}:${pad2(now.getUTCMinutes())}`;
  const weatherSummary = buildWeatherSummary(weather, timeContext);
  const tideSummary = tide ? buildTideSummary(tide, timeContext) : '';
  const lines = [
    `【当前实况（东澳岛，北京时间 ${clock}）】`,
    `天气：${weatherSummary}`,
  ];
  if (tideSummary) lines.push(tideSummary);
  lines.push('以上为最近一次定时刷新的数据（约 3 小时更新一次），回答天气/潮汐问题时以此为依据，不要编造实时数据；若数据明显过时请提示用户以官方天气 App 为准。');
  return `\n\n${lines.join('\n')}`;
}

function normalizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const role = item && item.role === 'assistant' ? 'assistant' : 'user';
      const content = String((item && item.content) || '').trim().slice(0, 500);
      return content ? { role, content } : null;
    })
    .filter(Boolean)
    .slice(-HISTORY_MAX_TURNS);
}

const SYSTEM_PROMPT = `你是"小猫遛遛"，微信小程序"遛遛东澳"的东澳岛专属 AI 向导，形象是一只爱遛弯的小猫。

要求：
1. 只回答与东澳岛、珠海万山群岛、旅行安排相关的问题；无关问题礼貌地拉回海岛话题。
2. 回答要具体可执行：给出景点名、时间段、注意事项，不写空话。
3. 语气温暖活泼，像朋友聊天，可以用一点点猫的口癖（比如"喵"），但每条回复最多出现一次。
4. 涉及安全（台风、涨潮、礁石、防晒）时主动提醒。
5. 不确定或未接入的信息（如实时班船、价格）要明说不确定，建议用户查官方渠道，不要编造。
6. 回复控制在 200 字以内，用短句，可以分点。`;

async function chatWithCloudAi(messages) {
  const ai = cloud.ai();
  const model = ai.createModel('cloudbase');
  let lastError = null;
  for (const candidate of MODEL_CANDIDATES) {
    try {
      const result = await model.generateText({
        model: candidate,
        messages,
        temperature: 0.7,
      });
      const text = String(result && result.text || '').trim();
      if (text) {
        return { text, modelUsed: candidate };
      }
      lastError = new Error(`empty_reply_from_${candidate}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('no_model_available');
}

// 读取用户画像标签：优先云端 userProfiles（按 OPENID，3 天内有效），退回客户端传入
async function loadUserProfile(event) {
  let tags = null;
  try {
    const db = cloud.database();
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
  return Array.isArray(tags) ? tags.filter((t) => t && String(t).trim()) : [];
}

function buildUserProfileSection(tags) {
  if (!tags.length) {
    return `\n\n【用户画像】暂无标签，按大众游客给出稳妥、安全的推荐。\n${TAG_GLOSSARY}`;
  }
  return `\n\n【用户画像】该游客的客群标签（按匹配度排序）：${tags.join('、')}。
推荐景点、玩法与节奏时优先匹配上述标签（参照下方标签体系），可直接点出“你带的标签说明你可能喜欢……”。
${TAG_GLOSSARY}`;
}

exports.main = async (event) => {
  const question = String((event && event.question) || '').trim();
  if (!question) {
    return { reply: '喵？你想问什么呀，直接说就好。' };
  }

  const [knowledge, history, userTags, weatherData, tideData] = await Promise.all([
    loadGuideKnowledge(),
    Promise.resolve(normalizeHistory(event.messages)),
    loadUserProfile(event),
    loadJsonFile(WEATHER_FILE_ID),
    loadJsonFile(TIDE_FILE_ID),
  ]);

  const messages = [
    {
      role: 'system',
      content: `${SYSTEM_PROMPT}${buildUserProfileSection(userTags)}${buildEnvironmentSection(weatherData, tideData)}${
        knowledge
          ? `\n\n【东澳岛参考资料（可能不完整，仅供参考）】\n${knowledge}`
          : ''
      }`,
    },
    ...history,
    { role: 'user', content: question },
  ];

  try {
    const { text, modelUsed } = await chatWithCloudAi(messages);
    return { reply: text, modelUsed };
  } catch (err) {
    console.error('askLiuliu chat failed:', err && err.message);
    return {
      reply: '遛遛现在连不上大脑了，请稍后再试。若持续失败，请到云开发控制台确认该环境已开通 AI 大模型能力。',
      error: err && err.message,
    };
  }
};
