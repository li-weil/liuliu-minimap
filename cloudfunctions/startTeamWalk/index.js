const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

async function getRoomBundle(roomId, openid) {
  const roomDoc = await db.collection('teamWalkRooms').doc(roomId).get();
  const room = roomDoc.data;
  const membersResult = await db.collection('teamWalkMembers').where({ roomId, status: 'joined' }).get();
  const activitiesResult = await db.collection('teamWalkActivities').where({ roomId }).orderBy('createdAt', 'desc').limit(20).get();
  const member = (membersResult.data || []).find((item) => item.userId === openid) || null;
  return {
    _id: roomId,
    ...room,
    members: membersResult.data || [],
    contributions: [],
    activities: activitiesResult.data || [],
    memberRole: member ? member.role : '',
  };
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const roomId = event.roomId || event.id;
  const openid = wxContext.OPENID;
  if (!roomId) {
    throw new Error('missing_room_id');
  }

  const roomDoc = await db.collection('teamWalkRooms').doc(roomId).get();
  const room = roomDoc.data;
  if (!room) {
    throw new Error('room_not_found');
  }
  if (room.ownerUserId !== openid) {
    throw new Error('permission_denied');
  }
  if (room.status !== 'waiting') {
    throw new Error('room_not_waiting');
  }

  const ownerResult = await db.collection('teamWalkMembers').where({ roomId, userId: openid }).limit(1).get();
  const owner = ownerResult.data && ownerResult.data[0] ? ownerResult.data[0] : null;
  const now = Date.now();
  await db.collection('teamWalkRooms').doc(roomId).update({
    data: {
      status: 'active',
      startedAt: now,
    },
  });
  await db.collection('teamWalkActivities').add({
    data: {
      roomId,
      type: 'walk_started',
      userId: openid,
      nickName: owner && owner.nickName ? owner.nickName : '房主',
      avatarUrl: owner && owner.avatarUrl ? owner.avatarUrl : '',
      content: `${owner && owner.nickName ? owner.nickName : '房主'} 发起出发`,
      payload: {},
      createdAt: now,
    },
  });
  return {
    ok: true,
    room: await getRoomBundle(roomId, openid),
  };
};
