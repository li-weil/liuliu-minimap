const cloud = require('wx-server-sdk');
const { recalculateUserAlbumStats } = require('./album-stats');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

async function getUserProfile(openid) {
  try {
    const result = await db.collection('users').doc(openid).get();
    return result.data || null;
  } catch (error) {
    return null;
  }
}

async function getRoomBundle(roomId, openid) {
  const roomDoc = await db.collection('teamWalkRooms').doc(roomId).get();
  const room = roomDoc.data;
  const membersResult = await db.collection('teamWalkMembers')
    .where({ roomId, status: 'joined' })
    .orderBy('joinedAt', 'asc')
    .get();
  const activitiesResult = await db.collection('teamWalkActivities')
    .where({ roomId })
    .orderBy('createdAt', 'desc')
    .limit(20)
    .get();
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
  const openid = wxContext.OPENID;
  const roomId = event.roomId || event.id;
  if (!openid) {
    throw new Error('missing_openid');
  }
  if (!roomId) {
    throw new Error('missing_room_id');
  }

  const roomDoc = await db.collection('teamWalkRooms').doc(roomId).get();
  const room = roomDoc.data;
  if (!room) {
    throw new Error('room_not_found');
  }
  if (room.status !== 'waiting') {
    throw new Error('room_not_joinable');
  }

  const membersCollection = db.collection('teamWalkMembers');
  const existingResult = await membersCollection.where({ roomId, userId: openid }).limit(1).get();
  const now = Date.now();
  const user = await getUserProfile(openid);

  if (existingResult.data && existingResult.data.length) {
    await membersCollection.doc(existingResult.data[0]._id).update({
      data: {
        status: 'joined',
        nickName: user && user.nickName ? user.nickName : existingResult.data[0].nickName || '微信用户',
        avatarUrl: user && user.avatarUrl ? user.avatarUrl : existingResult.data[0].avatarUrl || '',
        pendingMissionKeys: existingResult.data[0].pendingMissionKeys || [],
        lastDraftUpdatedAt: existingResult.data[0].lastDraftUpdatedAt || 0,
        lastSyncedAt: existingResult.data[0].lastSyncedAt || now,
        joinedAt: now,
      },
    });
  } else {
    await membersCollection.add({
      data: {
        roomId,
        userId: openid,
        nickName: user && user.nickName ? user.nickName : '微信用户',
        avatarUrl: user && user.avatarUrl ? user.avatarUrl : '',
        role: 'member',
        status: 'joined',
        pendingMissionKeys: [],
        lastDraftUpdatedAt: 0,
        lastSyncedAt: now,
        joinedAt: now,
        createdAt: now,
      },
    });
  }

  const joinedMembers = await membersCollection.where({ roomId, status: 'joined' }).get();
  await db.collection('teamWalkRooms').doc(roomId).update({
    data: {
      memberCount: joinedMembers.data.length,
      teamStats: {
        ...(room.teamStats || {}),
        memberCount: joinedMembers.data.length,
      },
    },
  });
  await db.collection('teamWalkActivities').add({
    data: {
      roomId,
      type: 'member_joined',
      userId: openid,
      nickName: user && user.nickName ? user.nickName : '微信用户',
      avatarUrl: user && user.avatarUrl ? user.avatarUrl : '',
      content: `${user && user.nickName ? user.nickName : '新队友'} 加入了房间`,
      payload: {},
      createdAt: now,
    },
  });
  const albumStats = await recalculateUserAlbumStats({ db, _: db.command, openid });

  return {
    joined: true,
    albumStats,
    room: await getRoomBundle(roomId, openid),
  };
};
