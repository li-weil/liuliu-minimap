const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

async function getRoomBundle(roomId, openid) {
  const roomDoc = await db.collection('teamWalkRooms').doc(roomId).get();
  const room = roomDoc.data;
  if (!room) {
    throw new Error('room_not_found');
  }

  const membersResult = await db.collection('teamWalkMembers')
    .where({ roomId, status: 'joined' })
    .orderBy('joinedAt', 'asc')
    .get();
  const contributionsResult = await db.collection('teamWalkContributions')
    .where({ roomId })
    .orderBy('updatedAt', 'desc')
    .get();
  const activitiesResult = await db.collection('teamWalkActivities')
    .where({ roomId })
    .orderBy('createdAt', 'desc')
    .limit(20)
    .get();

  const memberDocs = membersResult.data || [];
  const member = memberDocs.find((item) => item.userId === openid) || null;

  return {
    _id: roomId,
    ...room,
    members: memberDocs,
    contributions: contributionsResult.data || [],
    activities: activitiesResult.data || [],
    memberRole: member ? member.role : '',
  };
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const roomId = event.roomId || event.id;
  if (!roomId) {
    throw new Error('missing_room_id');
  }

  return {
    room: await getRoomBundle(roomId, wxContext.OPENID),
  };
};
