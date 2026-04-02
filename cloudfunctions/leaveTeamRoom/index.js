const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

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
  if (room.status !== 'waiting') {
    throw new Error('room_not_leaveable');
  }

  const memberResult = await db.collection('teamWalkMembers').where({ roomId, userId: openid }).limit(1).get();
  if (!(memberResult.data && memberResult.data.length)) {
    throw new Error('member_not_found');
  }

  const member = memberResult.data[0];
  const now = Date.now();

  if (member.role === 'owner') {
    await db.collection('teamWalkRooms').doc(roomId).update({
      data: {
        status: 'dissolved',
        endedAt: now,
      },
    });
    await db.collection('teamWalkActivities').add({
      data: {
        roomId,
        type: 'room_dissolved',
        userId: openid,
        nickName: member.nickName || '房主',
        avatarUrl: member.avatarUrl || '',
        content: `${member.nickName || '房主'} 解散了房间`,
        payload: {},
        createdAt: now,
      },
    });
    return {
      ok: true,
      room: await getRoomBundle(roomId, openid),
    };
  }

  await db.collection('teamWalkMembers').doc(member._id).update({
    data: {
      status: 'left',
    },
  });
  const joinedMembers = await db.collection('teamWalkMembers').where({ roomId, status: 'joined' }).get();
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
      type: 'member_left',
      userId: openid,
      nickName: member.nickName || '队友',
      avatarUrl: member.avatarUrl || '',
      content: `${member.nickName || '队友'} 离开了房间`,
      payload: {},
      createdAt: now,
    },
  });
  return {
    ok: true,
    room: await getRoomBundle(roomId, openid),
  };
};
