const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const DEFAULT_LIMIT = 100;

function buildSummary(room) {
  if (room && room.teamSummary) {
    return room.teamSummary;
  }
  return '这次同行房间已由房主解散，记录归档为已结束。';
}

function buildTeamStats(room, memberCount) {
  const stats = room && room.teamStats ? room.teamStats : {};
  const themeSnapshot = room && room.themeSnapshot ? room.themeSnapshot : {};
  return {
    ...stats,
    memberCount,
    totalMissionCount: Array.isArray(themeSnapshot.missions) ? themeSnapshot.missions.length : 0,
    completedMissionCount: Number(stats.completedMissionCount || 0),
    contributionCount: Number(stats.contributionCount || 0),
    photoCount: Number(stats.photoCount || 0),
    videoCount: Number(stats.videoCount || 0),
    audioCount: Number(stats.audioCount || 0),
  };
}

async function listTargetRooms(limit) {
  const result = await db.collection('teamWalkRooms')
    .where({ status: 'dissolved' })
    .limit(limit)
    .get();
  return result.data || [];
}

async function getJoinedMemberCount(roomId) {
  const result = await db.collection('teamWalkMembers')
    .where({ roomId, status: 'joined' })
    .count();
  return result && typeof result.total === 'number' ? result.total : 0;
}

exports.main = async (event) => {
  const dryRun = !!event.dryRun;
  const limit = Math.min(Math.max(Number(event.limit || DEFAULT_LIMIT), 1), DEFAULT_LIMIT);
  const rooms = await listTargetRooms(limit);

  if (!rooms.length) {
    return {
      ok: true,
      dryRun,
      total: 0,
      updated: 0,
      rooms: [],
    };
  }

  const results = [];
  for (const room of rooms) {
    const roomId = room && room._id ? room._id : '';
    if (!roomId) {
      results.push({ roomId: '', updated: false, reason: 'missing_id' });
      continue;
    }

    const memberCount = await getJoinedMemberCount(roomId);
    const nextData = {
      status: 'finished',
      endedAt: room.endedAt || room.updatedAt || room.createdAt || Date.now(),
      teamSummary: buildSummary(room),
      teamStats: buildTeamStats(room, memberCount),
    };

    if (!dryRun) {
      await db.collection('teamWalkRooms').doc(roomId).update({ data: nextData });
    }

    results.push({
      roomId,
      updated: true,
      nextData,
    });
  }

  return {
    ok: true,
    dryRun,
    total: rooms.length,
    updated: results.filter((item) => item.updated).length,
    rooms: results,
  };
};
