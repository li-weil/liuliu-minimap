const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const roomId = event.roomId || event.id;
  const missionKey = String(event.missionKey || '').trim();
  const cardImagePath = String(event.cardImagePath || '').trim();
  if (!roomId) {
    throw new Error('missing_room_id');
  }
  if (!missionKey) {
    throw new Error('missing_mission_key');
  }
  if (!cardImagePath) {
    throw new Error('missing_card_image_path');
  }

  const memberResult = await db.collection('teamWalkMembers').where({
    roomId,
    userId: wxContext.OPENID,
    status: 'joined',
  }).limit(1).get();
  if (!(memberResult.data && memberResult.data.length)) {
    throw new Error('permission_denied');
  }

  const roomDoc = await db.collection('teamWalkRooms').doc(roomId).get();
  const room = roomDoc.data;
  if (!room) {
    throw new Error('room_not_found');
  }

  const missionCardMap = {
    ...(room.missionCardMap || {}),
    [missionKey]: {
      cardImagePath,
      updatedAt: Date.now(),
      updatedBy: wxContext.OPENID,
    },
  };

  await db.collection('teamWalkRooms').doc(roomId).update({
    data: {
      missionCardMap,
      updatedAt: Date.now(),
    },
  });

  const updatedDoc = await db.collection('teamWalkRooms').doc(roomId).get();
  return {
    ok: true,
    missionCardMap: updatedDoc.data && updatedDoc.data.missionCardMap ? updatedDoc.data.missionCardMap : missionCardMap,
  };
};
