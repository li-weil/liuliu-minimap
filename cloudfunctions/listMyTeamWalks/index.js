const cloud = require('wx-server-sdk');
const { getUserAlbumStats } = require('./album-stats');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

function normalizeLimit(value) {
  const limit = Number(value || 20);
  if (!Number.isFinite(limit) || limit <= 0) {
    return 20;
  }
  return Math.min(Math.floor(limit), 50);
}

function normalizeOffset(event = {}) {
  const explicitOffset = event.offset !== undefined ? event.offset : event.skip;
  const offset = Number(explicitOffset || 0);
  if (Number.isFinite(offset) && offset > 0) {
    return Math.floor(offset);
  }

  const page = Number(event.page || 1);
  const limit = normalizeLimit(event.limit || event.pageSize);
  if (Number.isFinite(page) && page > 1) {
    return Math.floor((page - 1) * limit);
  }
  return 0;
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

function resolveAlbumSortTimestamp(item = {}) {
  if (normalizeAlbumStatus(item) === 'finished') {
    return Number(item.endedAt || item.updatedAt || item.createdAt || 0);
  }
  return Number(item.startedAt || item.createdAt || item.updatedAt || 0);
}

function resolveAlbumSortRank(item = {}) {
  const status = normalizeAlbumStatus(item);
  if (status === 'active') {
    return 0;
  }
  if (status === 'pending') {
    return 1;
  }
  return 2;
}

function compareAlbumRecords(left = {}, right = {}) {
  const leftRank = resolveAlbumSortRank(left);
  const rightRank = resolveAlbumSortRank(right);
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  return resolveAlbumSortTimestamp(right) - resolveAlbumSortTimestamp(left);
}

async function loadVisibleMemberships(openid) {
  const visibleMemberships = [];
  let skip = 0;
  const pageSize = 100;

  while (true) {
    const result = await db.collection('teamWalkMembers')
      .where({ userId: openid, status: 'joined' })
      .orderBy('joinedAt', 'desc')
      .skip(skip)
      .limit(pageSize)
      .get();
    const rows = result.data || [];
    rows.forEach((item) => {
      if (item && !item.recordDeletedAt) {
        visibleMemberships.push(item);
      }
    });
    if (rows.length < pageSize) {
      break;
    }
    skip += rows.length;
  }

  return visibleMemberships;
}

async function loadRoomsByIds(roomIds) {
  const rooms = [];
  for (let index = 0; index < roomIds.length; index += 20) {
    const chunk = roomIds.slice(index, index + 20);
    if (!chunk.length) {
      continue;
    }
    const result = await db.collection('teamWalkRooms')
      .where({
        _id: _.in(chunk),
      })
      .get();
    rooms.push(...(result.data || []));
  }
  return rooms;
}

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const limit = normalizeLimit(event.limit || event.pageSize);
  const offset = normalizeOffset(event);
  const visibleMemberships = await loadVisibleMemberships(openid);
  const roomIds = Array.from(new Set(visibleMemberships.map((item) => item.roomId).filter(Boolean)));
  if (!roomIds.length) {
    const albumStats = await getUserAlbumStats({ db, _, openid });
    return {
      records: [],
      albumStats,
      pagination: {
        limit,
        offset,
        nextOffset: offset,
        hasMore: false,
      },
    };
  }

  const rooms = await loadRoomsByIds(roomIds);

  const records = rooms
    .map((item) => {
      const membership = visibleMemberships.find((member) => member.roomId === item._id);
      return {
        ...item,
        memberRole: membership ? membership.role : '',
      };
    })
    .sort(compareAlbumRecords)
    .slice(offset, offset + limit);

  return {
    records,
    albumStats: await getUserAlbumStats({ db, _, openid }),
    pagination: {
      limit,
      offset,
      nextOffset: offset + records.length,
      hasMore: offset + records.length < rooms.length,
    },
  };
};
