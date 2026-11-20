// 用户标签体系：选项 → 一级标签（客群）评分
// 一级标签口径与采集表保持一致：Z世代/情侣客群、亲子客群、银发/休闲客群、资深玩家
const ALL_TAGS = ['Z世代/情侣客群', '亲子客群', '银发/休闲客群', '资深玩家'];

const QUESTIONS = [
  {
    key: 'age',
    icon: '/images/icon-sunglasses.png',
    title: '先告诉我你的年龄段',
    hint: '用来挑适合你的节奏',
    options: [
      { label: '18岁以下', img: '/images/ob-kite.png', scores: { 'Z世代/情侣客群': 1 } },
      { label: '18-25岁', img: '/images/icon-surfboard.png', scores: { 'Z世代/情侣客群': 2 } },
      { label: '26-40岁', img: '/images/ob-sandcastle.png', scores: { '亲子客群': 1 } },
      { label: '41-60岁', img: '/images/icon-deckchair.png', scores: { '银发/休闲客群': 1 } },
      { label: '60岁以上', img: '/images/icon-strawhat.png', scores: { '银发/休闲客群': 2 } },
    ],
  },
  {
    key: 'companion',
    icon: '/images/icon-umbrella.png',
    title: '这次和谁一起来东澳岛？',
    hint: '结伴方式决定推荐玩法',
    options: [
      { label: '一个人出发', img: '/images/icon-compass.png', scores: { '资深玩家': 1 } },
      { label: '情侣/伴侣', img: '/images/ob-heartshell.png', scores: { 'Z世代/情侣客群': 2 } },
      { label: '朋友/闺蜜', img: '/images/icon-cocktail.png', scores: { 'Z世代/情侣客群': 1, '资深玩家': 1 } },
      { label: '带孩子', img: '/images/icon-crab.png', scores: { '亲子客群': 2 } },
      { label: '带长辈', img: '/images/icon-umbrella.png', scores: { '银发/休闲客群': 2 } },
    ],
  },
  {
    key: 'source',
    icon: '/images/icon-cocktail.png',
    title: '你从哪里知道东澳岛的？',
    hint: '帮我们改进推广，不影响推荐',
    options: [
      { label: '小红书/抖音等平台种草', img: '/images/ob-phone.png', scores: {} },
      { label: '综艺/影视取景地（《我在岛屿读书》等）', img: '/images/ob-tv.png', scores: {} },
      { label: '朋友/家人推荐', img: '/images/ob-envelope.png', scores: {} },
      { label: '公司/学校组织出行', img: '/images/ob-bus.png', scores: {} },
    ],
  },
  {
    key: 'purpose',
    icon: '/images/icon-deckchair.png',
    title: '这次上岛最想做什么？',
    hint: '最想做的事决定推荐重点',
    options: [
      { label: '度假躺平·看海发呆', img: '/images/icon-palm.png', scores: { '银发/休闲客群': 2 } },
      { label: '拍照出片·浪漫打卡', img: '/images/ob-camera.png', scores: { 'Z世代/情侣客群': 2 } },
      { label: '亲子遛娃·寓教于乐', img: '/images/icon-fish.png', scores: { '亲子客群': 2 } },
      { label: '美食海鲜·赶海尝鲜', img: '/images/ob-lobster.png', scores: { '资深玩家': 1 } },
      { label: '人文历史·小众深度游', img: '/images/pt-cliff.png', scores: { '资深玩家': 2 } },
    ],
  },
];

// 评分函数：answers 形如 { age: 1, companion: 3, purpose: 2 }（被跳过的问题不出现在 answers 里）
function computeTags(answers) {
  const scores = {};
  QUESTIONS.forEach((question) => {
    const index = answers[question.key];
    if (index === undefined || index === null) return;
    const option = question.options[index];
    if (!option) return;
    Object.keys(option.scores).forEach((tag) => {
      scores[tag] = (scores[tag] || 0) + option.scores[tag];
    });
  });
  const ranked = ALL_TAGS
    .map((tag) => ({ tag, score: scores[tag] || 0 }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.tag);
  return ranked;
}

// 标签有效期：3 天（PDF 设计稿"三天记忆"，过期后重新展示选择题更新标签）
const PROFILE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

function getStoredProfile() {
  try {
    return wx.getStorageSync('userProfile') || null;
  } catch (e) {
    return null;
  }
}

function isProfileFresh(profile) {
  if (!profile || !Array.isArray(profile.tags) || !profile.tags.length) return false;
  const updatedAt = Number(profile.updatedAt) || 0;
  return Date.now() - updatedAt < PROFILE_TTL_MS;
}

function isOnboardingDone() {
  try {
    return Boolean(wx.getStorageSync('onboardingDone')) && isProfileFresh(getStoredProfile());
  } catch (e) {
    return false;
  }
}

function markOnboardingDone(profile) {
  try {
    wx.setStorageSync('onboardingDone', true);
    if (profile) wx.setStorageSync('userProfile', profile);
  } catch (e) { /* 存储失败不阻塞流程 */ }
}

module.exports = {
  ALL_TAGS,
  QUESTIONS,
  PROFILE_TTL_MS,
  computeTags,
  getStoredProfile,
  isProfileFresh,
  isOnboardingDone,
  markOnboardingDone,
};
