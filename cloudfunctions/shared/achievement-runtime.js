const ACHIEVEMENTS = [
  {
    id: 'shape_master',
    title: '几何大师',
    description: '解锁形状漫步',
    progressLabel: '形状漫步',
    target: 1,
    type: 'boolean',
    asset: 'cloud://cloud1-2gdui7md5af99e5c.636c-cloud1-2gdui7md5af99e5c-1418723303/achievements/shape_master.png',
    sort: 1,
  },
  {
    id: 'cat_marathon',
    title: '喵氏马拉松',
    description: '单次漫步里程 >= 5 公里',
    progressLabel: '单次里程',
    target: 5000,
    type: 'distance',
    asset: 'cloud://cloud1-2gdui7md5af99e5c.636c-cloud1-2gdui7md5af99e5c-1418723303/achievements/cat_marathon.png',
    sort: 2,
  },
  {
    id: 'no_photo_five_walks',
    title: '我喵都不喵你',
    description: '5 次漫步未上传图片',
    progressLabel: '无图漫步',
    target: 5,
    type: 'count',
    asset: 'cloud://cloud1-2gdui7md5af99e5c.636c-cloud1-2gdui7md5af99e5c-1418723303/achievements/no_photo_five_walks.png',
    sort: 3,
  },
  {
    id: 'ten_locations',
    title: '掌量世界',
    description: '在 10 个不同地点进行漫步',
    progressLabel: '不同地点',
    target: 10,
    type: 'count',
    asset: 'cloud://cloud1-2gdui7md5af99e5c.636c-cloud1-2gdui7md5af99e5c-1418723303/achievements/ten_locations.png',
    sort: 4,
  },
  {
    id: 'spring_first_walk',
    title: '猫步探春',
    description: '解锁春季第一次漫步',
    progressLabel: '春',
    target: 1,
    type: 'season',
    season: '春',
    asset: 'cloud://cloud1-2gdui7md5af99e5c.636c-cloud1-2gdui7md5af99e5c-1418723303/achievements/spring_first_walk.png',
    sort: 5,
  },
  {
    id: 'summer_first_walk',
    title: '猫步逐夏',
    description: '解锁夏季第一次漫步',
    progressLabel: '夏',
    target: 1,
    type: 'season',
    season: '夏',
    asset: 'cloud://cloud1-2gdui7md5af99e5c.636c-cloud1-2gdui7md5af99e5c-1418723303/achievements/summer_first_walk.png',
    sort: 6,
  },
  {
    id: 'autumn_first_walk',
    title: '猫步踏秋',
    description: '解锁秋季第一次漫步',
    progressLabel: '秋',
    target: 1,
    type: 'season',
    season: '秋',
    asset: 'cloud://cloud1-2gdui7md5af99e5c.636c-cloud1-2gdui7md5af99e5c-1418723303/achievements/autumn_first_walk.png',
    sort: 7,
  },
  {
    id: 'winter_first_walk',
    title: '猫步寻冬',
    description: '解锁冬季第一次漫步',
    progressLabel: '冬',
    target: 1,
    type: 'season',
    season: '冬',
    asset: 'cloud://cloud1-2gdui7md5af99e5c.636c-cloud1-2gdui7md5af99e5c-1418723303/achievements/winter_first_walk.png',
    sort: 8,
  },
];

function formatDate(dateInput) {
  if (!dateInput) {
    return '';
  }
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const yyyy = date.getFullYear();
  const mm = `${date.getMonth() + 1}`.padStart(2, '0');
  const dd = `${date.getDate()}`.padStart(2, '0');
  const hh = `${date.getHours()}`.padStart(2, '0');
  const min = `${date.getMinutes()}`.padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function formatMeters(value) {
  const meters = Number(value || 0);
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }
  return `${Math.round(meters)} m`;
}

function formatProgressValue(item, value) {
  if (item.type === 'distance') {
    return formatMeters(value);
  }
  return `${Math.round(value)}`;
}

function getRecordSeason(record) {
  return String(record.season || (record.generationContext && record.generationContext.season) || '').trim();
}

function isTeamRecord(record) {
  return record && record.recordType === 'team';
}

function isCompletedRecord(record) {
  if (!record) {
    return false;
  }
  if (isTeamRecord(record)) {
    return record.status === 'finished';
  }
  return record.status === 'finished';
}

function getThemeCategory(record) {
  return String(record.themeCategory || (record.themeSnapshot && record.themeSnapshot.category) || '').trim();
}

function getRouteDistance(record) {
  if (!record || !record.routeStats) {
    return 0;
  }
  return Number(record.routeStats.distanceMeters || 0);
}

function hasPhotos(record) {
  if (!record) {
    return false;
  }
  if (isTeamRecord(record)) {
    return Number(record.teamStats && record.teamStats.photoCount) > 0;
  }
  if (Array.isArray(record.photoList) && record.photoList.length) {
    return true;
  }
  const missionAssetMap = record.missionAssetMap || {};
  return Object.keys(missionAssetMap).some((key) => {
    const asset = missionAssetMap[key];
    return Array.isArray(asset && asset.photoList) && asset.photoList.length > 0;
  });
}

function getLocationKey(record) {
  const locationName = String(record.locationName || '').trim();
  if (locationName) {
    return `name:${locationName}`;
  }
  const latitude = Number(
    record.latitude !== undefined
      ? record.latitude
      : (record.routePoints && record.routePoints[0] && record.routePoints[0].latitude)
  );
  const longitude = Number(
    record.longitude !== undefined
      ? record.longitude
      : (record.routePoints && record.routePoints[0] && record.routePoints[0].longitude)
  );
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return `geo:${latitude.toFixed(3)},${longitude.toFixed(3)}`;
  }
  return '';
}

function buildProgressText(item, progress) {
  if (item.type === 'distance') {
    return `${Math.round(progress)}m / ${item.target}m`;
  }
  return `${Math.min(progress, item.target)}/${item.target}`;
}

function withPresentation(item, progress, unlocked, unlockedAt) {
  const cappedProgress = item.type === 'distance' ? progress : Math.min(progress, item.target);
  const milestoneCount = Math.min(Math.max(Number(item.target || 1), 1), 6);
  const milestones = Array.from({ length: milestoneCount }).map((_, index) => {
    const value = item.type === 'distance'
      ? Math.round((item.target / milestoneCount) * (index + 1))
      : Math.max(1, Math.round((item.target / milestoneCount) * (index + 1)));
    const previousValue = index === 0
      ? 0
      : item.type === 'distance'
        ? Math.round((item.target / milestoneCount) * index)
        : Math.max(1, Math.round((item.target / milestoneCount) * index));
    return {
      index,
      label: formatProgressValue(item, value),
      reached: progress >= value,
      current: !unlocked && progress < value && progress >= previousValue,
    };
  });

  return {
    ...item,
    progress,
    unlocked,
    unlockedAt: unlockedAt || null,
    unlockedAtLabel: unlockedAt ? formatDate(unlockedAt) : '',
    progressText: buildProgressText(item, progress),
    progressValueLabel: formatProgressValue(item, cappedProgress),
    targetValueLabel: formatProgressValue(item, item.target),
    milestones,
  };
}

function resolveThresholdUnlock(sortedRecords, predicate, target, projectValue) {
  let progress = 0;
  let unlockedAt = null;
  sortedRecords.forEach((record) => {
    const delta = predicate(record);
    if (!delta) {
      return;
    }
    progress += projectValue(delta, record);
    if (!unlockedAt && progress >= target) {
      unlockedAt = Number(record.endedAt || record.createdAt || Date.now());
    }
  });
  return {
    progress,
    unlocked: progress >= target,
    unlockedAt,
  };
}

function computeAchievements(records = []) {
  const completedRecords = (Array.isArray(records) ? records : [])
    .filter(isCompletedRecord)
    .sort((left, right) => Number(left.createdAt || 0) - Number(right.createdAt || 0));

  const maxDistance = completedRecords.reduce((max, record) => Math.max(max, getRouteDistance(record)), 0);
  const maxDistanceRecord = completedRecords.find((record) => getRouteDistance(record) === maxDistance) || null;
  const noPhotoResult = resolveThresholdUnlock(completedRecords, (record) => (!hasPhotos(record) ? 1 : 0), 5, (value) => value);

  const locationCounter = new Set();
  let distinctLocationProgress = 0;
  let distinctLocationUnlockedAt = null;
  completedRecords.forEach((record) => {
    const locationKey = getLocationKey(record);
    if (!locationKey || locationCounter.has(locationKey)) {
      return;
    }
    locationCounter.add(locationKey);
    distinctLocationProgress += 1;
    if (!distinctLocationUnlockedAt && distinctLocationProgress >= 10) {
      distinctLocationUnlockedAt = Number(record.endedAt || record.createdAt || Date.now());
    }
  });

  const shapeRecord = completedRecords.find((record) => getThemeCategory(record).includes('形状')) || null;
  const seasonRecordMap = completedRecords.reduce((accumulator, record) => {
    const season = getRecordSeason(record);
    if (season && !accumulator[season]) {
      accumulator[season] = record;
    }
    return accumulator;
  }, {});

  const achievements = ACHIEVEMENTS.map((item) => {
    if (item.id === 'shape_master') {
      return withPresentation(item, shapeRecord ? 1 : 0, !!shapeRecord, shapeRecord && (shapeRecord.endedAt || shapeRecord.createdAt));
    }
    if (item.id === 'cat_marathon') {
      return withPresentation(item, maxDistance, maxDistance >= item.target, maxDistanceRecord && (maxDistanceRecord.endedAt || maxDistanceRecord.createdAt));
    }
    if (item.id === 'no_photo_five_walks') {
      return withPresentation(item, noPhotoResult.progress, noPhotoResult.unlocked, noPhotoResult.unlockedAt);
    }
    if (item.id === 'ten_locations') {
      return withPresentation(item, distinctLocationProgress, distinctLocationProgress >= item.target, distinctLocationUnlockedAt);
    }
    if (item.type === 'season') {
      const matchedRecord = seasonRecordMap[item.season] || null;
      return withPresentation(item, matchedRecord ? 1 : 0, !!matchedRecord, matchedRecord && (matchedRecord.endedAt || matchedRecord.createdAt));
    }
    return withPresentation(item, 0, false, null);
  }).sort((left, right) => left.sort - right.sort);

  const unlockedCount = achievements.filter((item) => item.unlocked).length;
  return {
    achievements,
    summary: {
      unlockedCount,
      totalCount: achievements.length,
      completionRate: achievements.length ? Math.round((unlockedCount / achievements.length) * 100) : 0,
    },
  };
}

async function loadAllRecords(query, orderField = 'createdAt') {
  const result = [];
  let skip = 0;
  const pageSize = 100;
  while (true) {
    const response = await query.orderBy(orderField, 'desc').skip(skip).limit(pageSize).get();
    const data = response.data || [];
    result.push(...data);
    if (data.length < pageSize) {
      break;
    }
    skip += data.length;
  }
  return result;
}

async function loadAllUserWalkRecords(db, openid) {
  return loadAllRecords(
    db.collection('walkRecords').where({ userId: openid }),
    'createdAt'
  );
}

async function loadAllUserTeamWalkRecords(db, _, openid) {
  const memberships = await loadAllRecords(
    db.collection('teamWalkMembers').where({ userId: openid, status: 'joined' }),
    'joinedAt'
  );
  const roomIds = Array.from(new Set(memberships.map((item) => item.roomId).filter(Boolean)));
  if (!roomIds.length) {
    return [];
  }

  const records = [];
  for (let index = 0; index < roomIds.length; index += 20) {
    const chunk = roomIds.slice(index, index + 20);
    const response = await db.collection('teamWalkRooms').where({
      _id: _.in(chunk),
    }).get();
    (response.data || []).forEach((item) => {
      records.push({
        ...item,
        recordType: 'team',
      });
    });
  }
  return records;
}

async function recalculateUserAchievements({ db, _, openid }) {
  const [soloRecords, teamRecords] = await Promise.all([
    loadAllUserWalkRecords(db, openid),
    loadAllUserTeamWalkRecords(db, _, openid),
  ]);
  const achievementResult = computeAchievements([...(soloRecords || []), ...(teamRecords || [])]);
  const payload = {
    userId: openid,
    achievements: achievementResult.achievements,
    summary: achievementResult.summary,
    updatedAt: Date.now(),
  };

  try {
    await db.collection('userAchievements').doc(openid).set({ data: payload });
  } catch (error) {
    const message = String((error && error.message) || '');
    if (message.includes('does not exist')) {
      await db.collection('userAchievements').add({
        data: {
          ...payload,
          _id: openid,
        },
      });
    } else {
      throw error;
    }
  }

  return payload;
}

module.exports = {
  computeAchievements,
  recalculateUserAchievements,
};
