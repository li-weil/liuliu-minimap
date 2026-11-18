'use strict';

// 东澳岛语料库（MVP）——纯函数模块，不依赖 wx-server-sdk，便于本地预览与单测。
// 契约见 东澳岛/data/corpus/README.md。

const AUDIENCES = ['couple', 'family', 'elder', 'hardcore', 'general'];
const HARD_ACTIVITY_KEYWORDS = [
  '夜潜', '深潜', '水肺', '浮潜', '摩托艇', '游艇', '船钓', '矶钓', '钓鱼',
  '攀岩', '悬崖', '露营', '桨板', '冲浪', '潜水',
];
const MAX_CORPUS_CHARS = 1200;
const MAX_SPOT_BLOCK_CHARS = 600;
const MAX_PLAYS = 4;
const MAX_MENU_CHARS = 240;
const MAX_FOOD_DISHES = 12;

function normalizePreference(value) {
  const text = String(value || '').trim().toLowerCase();
  return AUDIENCES.indexOf(text) >= 0 ? text : 'general';
}

function normalizeRecentMissions(value, limit) {
  const max = Number.isFinite(limit) ? limit : 3;
  if (!Array.isArray(value)) return [];
  return value
    .map(function (item) { return String(item || '').trim(); })
    .filter(function (item) { return !!item; })
    .slice(0, max);
}

function isSafeUniversal(play) {
  const audiences = Array.isArray(play && play.audiences) ? play.audiences : [];
  if (audiences.indexOf('hardcore') >= 0) return false;
  const text = String((play && play.text) || '');
  for (let i = 0; i < HARD_ACTIVITY_KEYWORDS.length; i += 1) {
    if (text.indexOf(HARD_ACTIVITY_KEYWORDS[i]) >= 0) return false;
  }
  return true;
}

function matchesPreference(play, preference) {
  if (preference === 'general') return isSafeUniversal(play);
  const audiences = Array.isArray(play && play.audiences) ? play.audiences : [];
  if (!audiences.length) return true;
  return audiences.indexOf(preference) >= 0 || audiences.indexOf('general') >= 0;
}

function isDuplicateText(text, recentMissions) {
  const value = String(text || '').trim();
  if (!value) return true;
  for (let i = 0; i < recentMissions.length; i += 1) {
    const recent = String(recentMissions[i] || '');
    if (!recent) continue;
    if (recent.indexOf(value) >= 0 || value.indexOf(recent) >= 0) return true;
  }
  return false;
}

function findArea(index, mapName) {
  if (!index || !Array.isArray(index.areas)) return null;
  for (let i = 0; i < index.areas.length; i += 1) {
    const area = index.areas[i] || {};
    const spots = Array.isArray(area.spots) ? area.spots : [];
    if (spots.indexOf(mapName) >= 0) return area;
  }
  return null;
}

function containsHardKeyword(text) {
  const value = String(text || '');
  for (let i = 0; i < HARD_ACTIVITY_KEYWORDS.length; i += 1) {
    if (value.indexOf(HARD_ACTIVITY_KEYWORDS[i]) >= 0) return true;
  }
  return false;
}

// 注入前清洗：去掉电话、营销标签【…】、多余空白，避免模型复述联系方式或运营话术
const PHONE_RE = /1[3-9]\d{9}|0\d{2,3}-?\d{7,8}/g;
function sanitizeFactText(text) {
  return String(text || '')
    .replace(/【[^】]{0,20}】/g, '')
    .replace(PHONE_RE, '')
    .replace(/(联系电话|预订电话|电话|手机|微信)\s*[:：]?/g, '')
    .replace(/[、，,；;]\s*([）)])/g, '$1')
    .replace(/([（(])\s*[、，,；;]/g, '$1')
    .replace(/[（(]\s*[）)]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getSpotCategory(spot, index, mapName) {
  if (spot && spot.category) return String(spot.category);
  if (index && index.spotCategories) {
    const value = index.spotCategories[mapName];
    if (value) return String(value);
  }
  return 'spot';
}

// 菜单块：只给菜名与套餐构成，不给菜价（价格时效风险由人均承担）
function formatMenu(menu) {
  if (!menu || typeof menu !== 'object') return '';
  const lines = [];
  if (Array.isArray(menu.dishes) && menu.dishes.length) {
    const names = [];
    const seen = Object.create(null);
    menu.dishes.forEach(function (item) {
      const name = String((item && item.name) || '').trim();
      if (name && !seen[name] && names.length < MAX_FOOD_DISHES) {
        seen[name] = true;
        names.push(name);
      }
    });
    if (names.length) lines.push('可以点的菜：' + names.join('、'));
  }
  if (Array.isArray(menu.packages) && menu.packages.length) {
    menu.packages.slice(0, 2).forEach(function (item) {
      const name = String((item && item.name) || '').trim();
      if (!name) return;
      const items = Array.isArray(item.items)
        ? item.items.map(function (dish) { return String(dish || '').trim(); }).filter(Boolean)
        : [];
      lines.push('套餐：' + name + (items.length ? '（含 ' + items.slice(0, 6).join('、') + '）' : ''));
    });
  }
  return lines.join('\n').slice(0, MAX_MENU_CHARS);
}

function formatFoodBlock(spot, preference, menuText) {
  if (!spot || typeof spot !== 'object') return '';
  const lines = [];
  const verified = String((spot.source && spot.source.verified) || '');
  if (verified && verified.indexOf('待实采') >= 0) {
    lines.push('核验状态：待实采（以下信息仅作参考，不要当成确定事实）');
  }
  if (spot.openHours) lines.push('营业时间：' + sanitizeFactText(spot.openHours));
  if (spot.avgPrice) lines.push('人均：' + sanitizeFactText(spot.avgPrice));
  if (spot.partySize) lines.push('适合人数：' + sanitizeFactText(spot.partySize));
  if (spot.location) lines.push('位置：' + sanitizeFactText(spot.location));
  if (Array.isArray(spot.surroundings) && spot.surroundings.length) {
    const nearby = sanitizeFactText(
      spot.surroundings.slice(0, 3).map(function (item) { return String(item || ''); }).filter(Boolean).join('、')
    );
    if (nearby) lines.push('周边：' + nearby.slice(0, 120));
  }
  const safeLines = preference === 'general'
    ? lines.filter(function (line) { return !containsHardKeyword(line); })
    : lines;
  const head = safeLines.join('\n').slice(0, MAX_SPOT_BLOCK_CHARS);
  return menuText ? head + '\n' + menuText : head;
}

function countMenuItems(menu) {
  let total = 0;
  if (menu && Array.isArray(menu.dishes)) total += menu.dishes.length;
  if (menu && Array.isArray(menu.packages)) {
    menu.packages.forEach(function (pkg) {
      if (pkg && Array.isArray(pkg.items)) total += pkg.items.length;
    });
  }
  return total;
}

function pickDishNames(menu, limit) {
  const max = Number.isFinite(limit) ? limit : 3;
  const names = [];
  if (!menu) return names;
  if (Array.isArray(menu.dishes)) {
    menu.dishes.forEach(function (item) {
      const name = String((item && item.name) || '').trim();
      if (name && names.indexOf(name) < 0 && names.length < max) names.push(name);
    });
  }
  // 只有套餐的点位（菜单是团购套餐截图）：从套餐内容里取菜名兜底
  if (!names.length && Array.isArray(menu.packages)) {
    menu.packages.forEach(function (pkg) {
      const items = Array.isArray(pkg && pkg.items) ? pkg.items : [];
      items.forEach(function (item) {
        const name = String(item || '').trim();
        if (name && names.indexOf(name) < 0 && names.length < max) names.push(name);
      });
    });
  }
  return names;
}

function formatSpotBlock(spot, preference) {
  if (!spot || typeof spot !== 'object') return '';
  const lines = [];
  const verified = String((spot.source && spot.source.verified) || '');
  if (verified && verified.indexOf('待实采') >= 0) {
    lines.push('核验状态：待实采（以下信息仅作参考，不要当成确定事实）');
  }
  if (spot.duration) lines.push('建议停留：' + sanitizeFactText(spot.duration));
  if (spot.bestTime) lines.push('最佳时段：' + sanitizeFactText(spot.bestTime));
  if (spot.budget) lines.push('花费：' + sanitizeFactText(spot.budget));
  if (spot.partySize) lines.push('适合人数：' + sanitizeFactText(spot.partySize));
  if (spot.booking) lines.push('预订：' + sanitizeFactText(spot.booking));
  if (spot.location) lines.push('位置：' + sanitizeFactText(spot.location));
  if (Array.isArray(spot.surroundings) && spot.surroundings.length) {
    const nearby = sanitizeFactText(
      spot.surroundings.slice(0, 3).map(function (item) { return String(item || ''); }).filter(Boolean).join('、')
    );
    if (nearby) lines.push('周边：' + nearby.slice(0, 120));
  }
  // general 偏好下，不在事实块里暴露水上/硬核项目（安全审核未过）
  const safeLines = preference === 'general'
    ? lines.filter(function (line) { return !containsHardKeyword(line); })
    : lines;
  return safeLines.join('\n').slice(0, MAX_SPOT_BLOCK_CHARS);
}

function collectPlayCandidates(spot, area) {
  const list = [];
  const seen = Object.create(null);
  function push(play) {
    if (!play || !play.text) return;
    const text = String(play.text).trim();
    if (!text || seen[text]) return;
    seen[text] = true;
    list.push({ text: text, audiences: Array.isArray(play.audiences) ? play.audiences : [] });
  }
  if (spot && Array.isArray(spot.plays)) {
    spot.plays.forEach(function (text) { push({ text: text, audiences: spot.audiences }); });
  }
  if (area && Array.isArray(area.plays)) area.plays.forEach(push);
  return list;
}

// 返回 { text, stats }；text 为空表示本次没有可用语料，调用方应回退旧 prompt。
function buildCorpusContext(options) {
  const opts = options || {};
  const spot = opts.spot || null;
  const index = opts.index || null;
  const mapName = String(opts.mapName || (spot && spot.mapName) || '').trim();
  const preference = normalizePreference(opts.preference);
  const recentMissions = normalizeRecentMissions(opts.recentMissions);
  const area = findArea(index, mapName);
  const category = getSpotCategory(spot, index, mapName);
  // 没有可用菜名的餐厅点位不切美食推荐：缺菜名时模型必然编菜，退化成景点/店铺任务更安全。
  // 判据直接看注入文本（菜名/套餐名全空 → menuText 为空 → 退化）。
  const spotMenu = (spot && spot.menu) || null;
  const menuText = formatMenu(spotMenu);
  const isFood = category === 'food' && !!menuText;
  const parts = [];
  const spotBlock = isFood
    ? formatFoodBlock(spot, preference, menuText)
    : formatSpotBlock(spot, preference);
  if (spotBlock) parts.push((isFood ? '【餐厅档案】' : '【点位档案】') + '\n' + spotBlock);

  // 餐饮点位的玩法是「这家店的特点」，只用该店自己的三级标签：
  // 不能从片区补位（会混进景点玩法），也不能按客群过滤（采集表客群常带资深玩家）。
  const candidates = (isFood
    ? collectPlayCandidates(spot, null)
    : collectPlayCandidates(spot, area)
  ).filter(function (play) {
    if (isDuplicateText(play.text, recentMissions)) return false;
    if (isFood) return !containsHardKeyword(play.text);
    return matchesPreference(play, preference);
  });
  if (candidates.length) {
    const playLines = candidates.slice(0, MAX_PLAYS).map(function (play) { return '- ' + play.text; });
    const title = isFood ? '【这家店的特点】（参考，不要照抄）' : '【这一带可以做什么】（参考，不要照抄）';
    parts.push(title + '\n' + playLines.join('\n'));
  }

  if (!isFood && area && Array.isArray(area.food) && area.food.length) {
    const foodLines = area.food.slice(0, 1).map(function (item) {
      const name = String((item && item.name) || '').trim();
      const note = String((item && item.note) || '').trim();
      return '- ' + (note ? name + '：' + note : name);
    }).filter(function (line) { return line !== '- '; });
    if (foodLines.length) {
      parts.push('【这一带可以吃什么】（仅供提示，营业情况以现场为准）\n' + foodLines.join('\n'));
    }
  }

  if (index && Array.isArray(index.styleSamples) && index.styleSamples.length) {
    const styles = index.styleSamples.slice(0, 2).map(function (item) { return String(item || '').trim(); }).filter(Boolean);
    if (styles.length) parts.push('【语气参考】（只学语气，不抄内容）\n- ' + styles.join('\n- '));
  }

  const text = parts.join('\n\n').slice(0, MAX_CORPUS_CHARS);
  return {
    text: text,
    mode: isFood ? 'food' : 'spot',
    picks: isFood ? pickDishNames(spot && spot.menu, 3) : [],
    stats: {
      hit: spot ? 'L1' : (area ? 'L2' : 'none'),
      category: category,
      mode: isFood ? 'food' : 'spot',
      area: area && area.name ? area.name : '',
      playCount: candidates.length ? Math.min(candidates.length, MAX_PLAYS) : 0,
      menuChars: menuText.length,
      dishCount: isFood && spot && spot.menu ? countMenuItems(spot.menu) : 0,
      injectedChars: text.length,
      preference: preference,
    },
  };
}

function buildPromptV2(options) {
  const opts = options || {};
  const mapName = String(opts.mapName || '').trim();
  const time = opts.time || {};
  const recentMissions = normalizeRecentMissions(opts.recentMissions);
  const recentBlock = recentMissions.length
    ? '\n【最近已经做过】（不要重复）\n' + recentMissions.map(function (item) { return '- ' + item; }).join('\n')
    : '';
  const corpusText = String(opts.corpusText || '').trim();

  const systemPrompt = [
    '你是遛遛小程序东澳岛模式的漫步任务助手。只返回合法 JSON，不要输出解释。',
    '事实纪律：只能使用用户提供的资料；资料没有写的价格、营业时间、预订方式、店铺名一律不要出现；不得声称现在营业中、有票、可预约；资料里标注待实采的信息只能弱表述（例如可以留意）。',
    '语气温暖、活泼，像一位体贴的朋友。',
  ].join('\n');

  const userPrompt = [
    '为东澳岛景点「' + mapName + '」生成一条漫步任务、一条贴心提示、一条安全提醒。',
    '',
    corpusText,
    '',
    '【景点环境】',
    opts.envContext || '暂无详细信息',
    '',
    '【五感玩法灵感（仅供参考，不要直接复制）】',
    opts.sensoryInspo || '暂无',
    '',
    '【此刻环境】',
    '当前时间：' + (time.currentTime || '') + '，季节：' + (time.season || ''),
    '天气：' + (opts.weatherSummary || '天气数据暂无'),
    opts.tideSummary || '',
    '',
    '【游客安全守则】',
    opts.visitorRules || '注意人身安全，遵守景区规定',
    recentBlock,
    '',
    '【生成要求】',
    '1. mission：一条具体可执行的观察任务，14-28字（含标点最多 34 字）。必须是看、听、摸、闻、找、坐、拍这类具体动作，不能空泛；结合当前时段与天气；',
    '2. tips：一条贴心提示，12-24字（含标点最多 30 字）。优先使用点位资料里的时段、时长、花费、预订信息；资料没有就不写；',
    '3. safetyNote：一条安全提醒，8-16字（含标点最多 22 字）。结合点位特点与天气潮汐；',
    '4. 不得编造资料中不存在的事实；',
    '5. 只返回 JSON：{"mission":"任务文本","tips":"小提示","safetyNote":"安全提醒"}',
  ].filter(function (line) { return line !== undefined; }).join('\n');

  return { systemPrompt: systemPrompt, userPrompt: userPrompt };
}

function buildPromptFoodV2(options) {
  const opts = options || {};
  const mapName = String(opts.mapName || '').trim();
  const time = opts.time || {};
  const recentMissions = normalizeRecentMissions(opts.recentMissions);
  const recentBlock = recentMissions.length
    ? '\n【最近已经吃过】（换个方向，不要重复）\n' + recentMissions.map(function (item) { return '- ' + item; }).join('\n')
    : '';
  const corpusText = String(opts.corpusText || '').trim();

  const systemPrompt = [
    '你是遛遛小程序东澳岛模式的美食推荐助手。只返回合法 JSON，不要输出解释。',
    '事实纪律：只能使用用户提供的资料；资料里没有的菜名、价格、营业时间、门店信息一律不要出现；不得声称现在营业中、有座、可预订、有折扣；资料标注待实采的信息只能弱表述（例如可以留意）。',
    '不要写具体菜价；不要承诺排队时长、赠品或团购可用。',
    '语气温暖、具体，像本地朋友带你点菜。',
  ].join('\n');

  const userPrompt = [
    '在「' + mapName + '」给用户推荐怎么吃，返回一条美食推荐、一条点单提示、一条饮食提醒。',
    '',
    corpusText,
    '',
    '【此刻环境】',
    '当前时间：' + (time.currentTime || '') + '，季节：' + (time.season || ''),
    '天气：' + (opts.weatherSummary || '天气数据暂无'),
    recentBlock,
    '',
    '【生成要求】',
    '1. mission：2-3 道具体菜（或 1 个套餐）的点单推荐，28-45字（含标点最多 50 字）；菜名必须原样使用【餐厅档案】里给出的菜名，不要改写或漏字；可以带一句为什么（招牌/本地常见/适合这个季节），但不得编造卖点；',
    '2. tips：一条点单或到店提示，12-26字（含标点最多 30 字）；优先用营业时间、人均、位置、适合人数；资料没有就不写；',
    '3. safetyNote：一条饮食提醒，8-18字（含标点最多 22 字）；海鲜过敏、称重/时价、生食风险、小心鱼刺等，结合这家店类型；',
    '4. 不要写菜价，不要承诺折扣/排队/包间；不得编造资料中不存在的事实；',
    '5. 只返回 JSON：{"mission":"推荐文本","tips":"提示","safetyNote":"饮食提醒"}',
  ].filter(function (line) { return line !== undefined; }).join('\n');

  return { systemPrompt: systemPrompt, userPrompt: userPrompt };
}

// AI 失败时的确定性兜底：只复述菜单里的菜名，不新增事实
function buildFoodFallback(options) {
  const opts = options || {};
  const mapName = String(opts.mapName || '').trim();
  const picks = Array.isArray(opts.picks) ? opts.picks.filter(Boolean) : [];
  const mission = picks.length
    ? '在' + mapName + '点一份' + picks.slice(0, 2).join('，再来一份')
    : '在' + mapName + '看看菜单，挑一份当天新鲜的';
  return {
    mission: mission.slice(0, 60),
    tips: '营业与供应当天为准，可以现场看海鲜后再点',
    safetyNote: '海鲜过敏者慎点，注意鱼刺',
  };
}

module.exports = {
  AUDIENCES: AUDIENCES,
  normalizePreference: normalizePreference,
  normalizeRecentMissions: normalizeRecentMissions,
  buildCorpusContext: buildCorpusContext,
  buildPromptV2: buildPromptV2,
  buildPromptFoodV2: buildPromptFoodV2,
  buildFoodFallback: buildFoodFallback,
  findArea: findArea,
};
