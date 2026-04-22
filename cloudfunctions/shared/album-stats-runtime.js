const STATUS_KEYS = ['all', 'pending', 'active', 'finished'];
const TYPE_KEYS = ['solo', 'team'];

function createStatusCounts() {
  return STATUS_KEYS.reduce((result, key) => {
    result[key] = 0;
    return result;
  }, {});
}

function createDefaultAlbumStats(updatedAt = 0) {
  return {
    totalCount: 0,
    soloCount: 0,
    teamCount: 0,
    statusCounts: createStatusCounts(),
    typeStatusCounts: {
      solo: createStatusCounts(),
      team: createStatusCounts(),
    },
    updatedAt,
  };
}

function normalizeAlbumStatus(item = {}) {
  const status = String(item.status || '').toLowerCase();
  if (status === 'finished' || item.endedAt) {
    return 'finished';
  }
  if (status === 'waiting' || status === 'pending') {
    return 'pending';
  }
  return 'active';
}

function addAlbumStatsRecord(stats, type, item = {}) {
  const recordType = type === 'team' ? 'team' : 'solo';
  const status = normalizeAlbumStatus(item);
  stats.totalCount += 1;
  stats[`${recordType}Count`] += 1;
  stats.statusCounts.all += 1;
  stats.statusCounts[status] = Number(stats.statusCounts[status] || 0) + 1;
  stats.typeStatusCounts[recordType].all += 1;
  stats.typeStatusCounts[recordType][status] = Number(stats.typeStatusCounts[recordType][status] || 0) + 1;
}

async function loadAll(collection, query = {}, options = {}) {
  const rows = [];
  let skip = 0;
  const pageSize = Math.min(Math.max(Number(options.pageSize || 100), 1), 100);

  while (true) {
    let request = collection.where(query).skip(skip).limit(pageSize);
    if (options.orderBy && options.order) {
      request = request.orderBy(options.orderBy, options.order);
    }
    const result = await request.get();
    const data = result.data || [];
    rows.push(...data);
    if (data.length < pageSize) {
      break;
    }
    skip += data.length;
  }

  return rows;
}

async function loadRoomsByIds(db, _, roomIds = []) {
  const ids = Array.from(new Set(roomIds.filter(Boolean)));
  const rooms = [];

  for (let index = 0; index < ids.length; index += 20) {
    const chunk = ids.slice(index, index + 20);
    if (!chunk.length) {
      continue;
    }

    if (_ && typeof _.in === 'function') {
      const result = await db.collection('teamWalkRooms')
        .where({ _id: _.in(chunk) })
        .get();
      rooms.push(...(result.data || []));
      continue;
    }

    for (const roomId of chunk) {
      try {
        const doc = await db.collection('teamWalkRooms').doc(roomId).get();
        if (doc && doc.data) {
          rooms.push(doc.data);
        }
      } catch (error) {
        // Ignore broken memberships that point to missing rooms.
      }
    }
  }

  return rooms;
}

async function buildUserAlbumStats({ db, _, openid }) {
  const stats = createDefaultAlbumStats(Date.now());
  if (!openid) {
    return stats;
  }

  const soloRecords = await loadAll(db.collection('walkRecords'), { userId: openid });
  soloRecords.forEach((record) => {
    addAlbumStatsRecord(stats, 'solo', record);
  });

  const memberships = await loadAll(db.collection('teamWalkMembers'), {
    userId: openid,
    status: 'joined',
  });
  const visibleMemberships = memberships.filter((item) => item && !item.recordDeletedAt);
  const roomIds = visibleMemberships.map((item) => item.roomId).filter(Boolean);
  const teamRooms = await loadRoomsByIds(db, _, roomIds);
  teamRooms.forEach((room) => {
    addAlbumStatsRecord(stats, 'team', room);
  });

  return stats;
}

async function saveUserAlbumStats({ db, openid, stats }) {
  if (!openid) {
    return stats || createDefaultAlbumStats();
  }
  const albumStats = stats || createDefaultAlbumStats(Date.now());
  try {
    await db.collection('users').doc(openid).update({
      data: {
        albumStats,
      },
    });
  } catch (error) {
    await db.collection('users').doc(openid).set({
      data: {
        openid,
        nickName: '微信用户',
        avatarUrl: '',
        role: 'user',
        albumStats,
        createdAt: Date.now(),
        lastLoginAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
  }
  return albumStats;
}

async function recalculateUserAlbumStats({ db, _, openid }) {
  const albumStats = await buildUserAlbumStats({ db, _, openid });
  return saveUserAlbumStats({ db, openid, stats: albumStats });
}

async function recalculateUsersAlbumStats({ db, _, userIds = [] }) {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  const results = [];
  for (const openid of ids) {
    const albumStats = await recalculateUserAlbumStats({ db, _, openid });
    results.push({ openid, albumStats });
  }
  return results;
}

function hasStoredAlbumStats(value) {
  return !!(
    value &&
    typeof value === 'object' &&
    Number.isFinite(Number(value.totalCount))
  );
}

async function getUserAlbumStats({ db, _, openid }) {
  if (!openid) {
    return createDefaultAlbumStats();
  }

  try {
    const doc = await db.collection('users').doc(openid).get();
    const albumStats = doc && doc.data ? doc.data.albumStats : null;
    if (hasStoredAlbumStats(albumStats)) {
      return albumStats;
    }
  } catch (error) {
    // Fall through and rebuild from records.
  }

  return recalculateUserAlbumStats({ db, _, openid });
}

module.exports = {
  buildUserAlbumStats,
  createDefaultAlbumStats,
  getUserAlbumStats,
  recalculateUserAlbumStats,
  recalculateUsersAlbumStats,
};
