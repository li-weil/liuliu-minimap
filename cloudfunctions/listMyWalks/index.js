const cloud = require('wx-server-sdk');
const { getUserAlbumStats } = require('./album-stats');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

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

async function loadUserWalkRecords(openid) {
  const records = [];
  let skip = 0;
  const pageSize = 100;

  while (true) {
    const result = await db.collection('walkRecords')
      .where({ userId: openid })
      .orderBy('createdAt', 'desc')
      .skip(skip)
      .limit(pageSize)
      .get();
    const rows = result.data || [];
    records.push(...rows);
    if (rows.length < pageSize) {
      break;
    }
    skip += rows.length;
  }

  return records;
}

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext();
  const limit = normalizeLimit(event.limit || event.pageSize);
  const offset = normalizeOffset(event);
  const rows = await loadUserWalkRecords(wxContext.OPENID);
  const records = rows
    .sort(compareAlbumRecords)
    .slice(offset, offset + limit);
  const albumStats = await getUserAlbumStats({ db, _: db.command, openid: wxContext.OPENID });
  return {
    records,
    albumStats,
    pagination: {
      limit,
      offset,
      nextOffset: offset + records.length,
      hasMore: offset + records.length < rows.length,
    },
  };
};
