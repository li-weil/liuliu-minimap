const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const limit = Math.min(Number(event.limit || 20), 50);

  const membershipResult = await db.collection('teamWalkMembers')
    .where({ userId: openid, status: 'joined' })
    .orderBy('joinedAt', 'desc')
    .limit(limit)
    .get();
  const roomIds = Array.from(new Set((membershipResult.data || []).map((item) => item.roomId).filter(Boolean)));
  if (!roomIds.length) {
    return { records: [] };
  }

  const roomsResult = await db.collection('teamWalkRooms')
    .where({
      _id: _.in(roomIds),
    })
    .get();

  const records = (roomsResult.data || [])
    .map((item) => {
      const membership = (membershipResult.data || []).find((member) => member.roomId === item._id);
      return {
        ...item,
        memberRole: membership ? membership.role : '',
      };
    })
    .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));

  return { records };
};
