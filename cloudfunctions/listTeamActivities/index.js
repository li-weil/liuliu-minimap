const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event) => {
  const roomId = event.roomId || event.id;
  const limit = Math.min(Number(event.limit || 20), 50);
  if (!roomId) {
    throw new Error('missing_room_id');
  }

  const result = await db.collection('teamWalkActivities')
    .where({ roomId })
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  return {
    activities: result.data || [],
  };
};
