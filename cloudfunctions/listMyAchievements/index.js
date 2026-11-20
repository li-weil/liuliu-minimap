const cloud = require('wx-server-sdk');
const { recalculateUserAchievements } = require('./achievement');
const { ACHIEVEMENTS } = require('./achievement');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async () => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) {
    throw new Error('missing_openid');
  }

  try {
    const doc = await db.collection('userAchievements').doc(openid).get();
    if (doc && doc.data) {
      const storedAchievements = Array.isArray(doc.data.achievements) ? doc.data.achievements : [];
      if (storedAchievements.length !== ACHIEVEMENTS.length) {
        const rebuilt = await recalculateUserAchievements({ db, _, openid });
        return {
          achievements: rebuilt.achievements || [],
          summary: rebuilt.summary || {
            unlockedCount: 0,
            totalCount: 0,
            completionRate: 0,
          },
          updatedAt: rebuilt.updatedAt || 0,
        };
      }
      return {
        achievements: storedAchievements,
        summary: doc.data.summary || {
          unlockedCount: 0,
          totalCount: 0,
          completionRate: 0,
        },
        updatedAt: doc.data.updatedAt || 0,
      };
    }
  } catch (error) {
    // Fall through to rebuild from records.
  }

  const rebuilt = await recalculateUserAchievements({ db, _, openid });
  return {
    achievements: rebuilt.achievements || [],
    summary: rebuilt.summary || {
      unlockedCount: 0,
      totalCount: 0,
      completionRate: 0,
    },
    updatedAt: rebuilt.updatedAt || 0,
  };
};
