const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

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
  const membersResult = await db.collection('teamWalkMembers').where({ roomId, status: 'joined' }).get();
  const member = (membersResult.data || []).find((item) => item.userId === openid) || null;
  if (!member) {
    throw new Error('permission_denied');
  }
  const contributionsResult = await db.collection('teamWalkContributions').where({ roomId }).orderBy('updatedAt', 'desc').get();
  const activitiesResult = await db.collection('teamWalkActivities').where({ roomId }).orderBy('createdAt', 'desc').limit(30).get();

  return {
    room: {
      _id: roomId,
      ...room,
      members: membersResult.data || [],
      contributions: contributionsResult.data || [],
      activities: activitiesResult.data || [],
      memberRole: member.role || '',
    },
  };
};
