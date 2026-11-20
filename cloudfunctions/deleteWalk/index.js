const cloud = require('wx-server-sdk');
const { recalculateUserAchievements } = require('./achievement');
const { recalculateUserAlbumStats } = require('./album-stats');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const id = event.id;

  if (!id) {
    return { ok: false, reason: 'missing_id' };
  }

  let walk = null;
  try {
    const doc = await db.collection('walkRecords').doc(id).get();
    walk = doc.data || null;
  } catch (error) {
    return { ok: false, reason: 'not_found' };
  }

  if (!walk) {
    return { ok: false, reason: 'not_found' };
  }

  if (walk.userId !== wxContext.OPENID) {
    return { ok: false, reason: 'permission_denied' };
  }

  if (walk.status && walk.status !== 'finished') {
    return { ok: false, reason: 'walk_not_finished' };
  }

  try {
    await db.collection('walkRecords').doc(id).remove();
    const [albumStats] = await Promise.all([
      recalculateUserAlbumStats({ db, _, openid: wxContext.OPENID }),
      recalculateUserAchievements({
        db,
        _,
        openid: wxContext.OPENID,
      }),
    ]);
    return {
      ok: true,
      id,
      albumStats,
    };
  } catch (error) {
    return { ok: false, reason: 'delete_failed' };
  }
};
