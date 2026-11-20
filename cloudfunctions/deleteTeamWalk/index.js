const cloud = require('wx-server-sdk');
const { recalculateUserAchievements } = require('./achievement');
const { recalculateUserAlbumStats } = require('./album-stats');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const roomId = event.roomId || event.id || '';
  const openid = wxContext.OPENID;

  if (!roomId) {
    return { ok: false, reason: 'missing_id' };
  }

  let room = null;
  try {
    const doc = await db.collection('teamWalkRooms').doc(roomId).get();
    room = doc.data || null;
  } catch (error) {
    return { ok: false, reason: 'not_found' };
  }

  if (!room) {
    return { ok: false, reason: 'not_found' };
  }

  const memberResult = await db.collection('teamWalkMembers')
    .where({ roomId, userId: openid, status: 'joined' })
    .limit(1)
    .get();
  const member = (memberResult.data || [])[0] || null;

  if (!member) {
    return { ok: false, reason: 'permission_denied' };
  }

  if (member.recordDeletedAt) {
    return {
      ok: true,
      id: roomId,
      alreadyDeleted: true,
    };
  }

  if (room.status !== 'finished') {
    return { ok: false, reason: 'walk_not_finished' };
  }

  try {
    await db.collection('teamWalkMembers').doc(member._id).update({
      data: {
        recordDeletedAt: Date.now(),
        recordDeletedBy: openid,
      },
    });
    const [albumStats] = await Promise.all([
      recalculateUserAlbumStats({ db, _, openid }),
      recalculateUserAchievements({ db, _, openid }),
    ]);
    return {
      ok: true,
      id: roomId,
      albumStats,
    };
  } catch (error) {
    return { ok: false, reason: 'delete_failed' };
  }
};
