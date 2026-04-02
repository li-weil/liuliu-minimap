const { formatDate } = require('../utils/format');
const { ACHIEVEMENTS } = require('../utils/achievements');

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
  return String(
    record.season ||
    (record.generationContext && record.generationContext.season) ||
    ''
  ).trim();
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
  return !!record.id || !!record._id;
}

function getThemeCategory(record) {
  return String(
    record.themeCategory ||
    (record.themeSnapshot && record.themeSnapshot.category) ||
    ''
  ).trim();
}

function getRouteDistance(record) {
  if (!record) {
    return 0;
  }
  if (record.routeStats && Number.isFinite(Number(record.routeStats.distanceMeters))) {
    return Number(record.routeStats.distanceMeters);
  }
  return 0;
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

function buildProgressText(item, progress, unlocked) {
  if (item.type === 'distance') {
    return unlocked
      ? `${Math.round(progress)}m / ${item.target}m`
      : `${Math.round(progress)}m / ${item.target}m`;
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
    progressText: buildProgressText(item, progress, unlocked),
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
      unlockedAt = Number(record.createdAt || Date.now());
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

  const noPhotoResult = resolveThresholdUnlock(
    completedRecords,
    (record) => (!hasPhotos(record) ? 1 : 0),
    5,
    (value) => value
  );

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
      distinctLocationUnlockedAt = Number(record.createdAt || Date.now());
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
      return withPresentation(item, shapeRecord ? 1 : 0, !!shapeRecord, shapeRecord && shapeRecord.createdAt);
    }

    if (item.id === 'cat_marathon') {
      return withPresentation(item, maxDistance, maxDistance >= item.target, maxDistanceRecord && maxDistanceRecord.createdAt);
    }

    if (item.id === 'no_photo_five_walks') {
      return withPresentation(
        item,
        noPhotoResult.progress,
        noPhotoResult.unlocked,
        noPhotoResult.unlockedAt
      );
    }

    if (item.id === 'ten_locations') {
      return withPresentation(
        item,
        distinctLocationProgress,
        distinctLocationProgress >= item.target,
        distinctLocationUnlockedAt
      );
    }

    if (item.type === 'season') {
      const matchedRecord = seasonRecordMap[item.season] || null;
      return withPresentation(item, matchedRecord ? 1 : 0, !!matchedRecord, matchedRecord && matchedRecord.createdAt);
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

module.exports = {
  computeAchievements,
  formatMeters,
};
