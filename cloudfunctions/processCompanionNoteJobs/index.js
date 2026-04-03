const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const jobsCollection = db.collection('companionNoteJobs');
const walkRecords = db.collection('walkRecords');
const teamWalkRooms = db.collection('teamWalkRooms');
const teamWalkContributions = db.collection('teamWalkContributions');
const MAX_ATTEMPTS = 6;
const RETRY_DELAYS_MS = [30 * 1000, 2 * 60 * 1000, 10 * 60 * 1000, 30 * 60 * 1000, 60 * 60 * 1000];

function createEmptyMissionAssets() {
  return {
    photoList: [],
    videoList: [],
    audioList: [],
    noteText: '',
    companionNote: '',
    cardImagePath: '',
  };
}

function normalizePhotoList(list) {
  return Array.isArray(list) ? list.filter(Boolean).slice(0, 3) : [];
}

function computeRetryDelay(attempts) {
  return RETRY_DELAYS_MS[Math.max(0, Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1))];
}

async function generateCompanionNote(payload) {
  const result = await cloud.callFunction({
    name: 'generateSticker',
    data: {
      ...payload,
      stage: 'companion-note',
    },
  });
  return String((result && result.result && result.result.companionNote) || '').trim();
}

async function markSucceeded(jobId, extra = {}) {
  await jobsCollection.doc(jobId).update({
    data: {
      status: 'succeeded',
      lastError: '',
      updatedAt: Date.now(),
      finishedAt: Date.now(),
      ...extra,
    },
  });
}

async function markFailed(job, error) {
  const attempts = Number(job.attempts || 0) + 1;
  const terminal = attempts >= MAX_ATTEMPTS;
  await jobsCollection.doc(job._id).update({
    data: {
      status: terminal ? 'failed' : 'pending',
      attempts,
      lastError: String((error && error.message) || error || '').slice(0, 300),
      nextRunAt: terminal ? Date.now() : Date.now() + computeRetryDelay(attempts),
      updatedAt: Date.now(),
    },
  });
}

async function claimJob(job) {
  const result = await jobsCollection.where({
    _id: job._id,
    status: 'pending',
  }).update({
    data: {
      status: 'processing',
      updatedAt: Date.now(),
    },
  });
  return !!(result && result.stats && result.stats.updated);
}

async function processWalkJob(job) {
  const payload = job.payload || {};
  const walkId = String(payload.walkId || '').trim();
  const openid = String(payload.openid || '').trim();
  if (!walkId || !openid) {
    await markSucceeded(job._id, { skippedReason: 'missing_payload' });
    return;
  }

  const walkDoc = await walkRecords.doc(walkId).get();
  const walk = walkDoc.data;
  if (!walk || walk.userId !== openid) {
    await markSucceeded(job._id, { skippedReason: 'walk_not_found_or_no_permission' });
    return;
  }

  const missionAssetMap = walk.missionAssetMap || {};
  const nextMissionAssetMap = {};
  let changed = false;

  for (const [missionKey, assets] of Object.entries(missionAssetMap)) {
    const nextAssets = {
      ...createEmptyMissionAssets(),
      ...(assets || {}),
    };
    const userNoteText = String(nextAssets.noteText || '').trim();
    const photoList = normalizePhotoList(nextAssets.photoList);
    if (!userNoteText && !photoList.length) {
      nextMissionAssetMap[missionKey] = nextAssets;
      continue;
    }
    if (nextAssets.companionNote) {
      nextMissionAssetMap[missionKey] = nextAssets;
      continue;
    }
    const companionNote = await generateCompanionNote({
      themeTitle: walk.themeTitle || (walk.themeSnapshot && walk.themeSnapshot.title) || '',
      locationName: walk.locationName || '',
      locationContext: walk.locationContext || '',
      mission: missionKey === '__summary__' ? '总结与补充' : missionKey,
      userNoteText,
      photoList,
      previousCompanionNote: '',
    });
    nextMissionAssetMap[missionKey] = {
      ...nextAssets,
      companionNote,
    };
    if (companionNote) {
      changed = true;
    }
  }

  if (changed) {
    await walkRecords.doc(walkId).update({
      data: {
        missionAssetMap: nextMissionAssetMap,
        updatedAt: Date.now(),
      },
    });
  }

  await markSucceeded(job._id, { changed });
}

async function processTeamJob(job) {
  const payload = job.payload || {};
  const roomId = String(payload.roomId || '').trim();
  const missionKey = String(payload.missionKey || '').trim();
  const openid = String(payload.openid || '').trim();
  if (!roomId || !missionKey || !openid) {
    await markSucceeded(job._id, { skippedReason: 'missing_payload' });
    return;
  }

  const contributionResult = await teamWalkContributions.where({ roomId, missionKey, userId: openid }).limit(1).get();
  const contribution = contributionResult.data && contributionResult.data[0] ? contributionResult.data[0] : null;
  if (!contribution) {
    await markSucceeded(job._id, { skippedReason: 'contribution_not_found' });
    return;
  }
  if (contribution.companionNote) {
    await markSucceeded(job._id, { skippedReason: 'already_generated' });
    return;
  }

  const userNoteText = String(contribution.noteText || '').trim();
  const photoList = normalizePhotoList(contribution.photoList);
  if (!userNoteText && !photoList.length) {
    await markSucceeded(job._id, { skippedReason: 'no_material' });
    return;
  }

  const roomDoc = await teamWalkRooms.doc(roomId).get();
  const room = roomDoc.data || {};
  const companionNote = await generateCompanionNote({
    themeTitle: room.themeTitle || (room.themeSnapshot && room.themeSnapshot.title) || '',
    locationName: room.locationName || '',
    locationContext: room.locationContext || '',
    mission: contribution.missionLabel || missionKey,
    userNoteText,
    photoList,
    previousCompanionNote: '',
  });
  if (companionNote) {
    await teamWalkContributions.doc(contribution._id).update({
      data: {
        companionNote,
        updatedAt: Date.now(),
      },
    });
  }

  await markSucceeded(job._id, { changed: !!companionNote });
}

exports.main = async (event) => {
  const batchSize = Math.max(1, Math.min(Number(event.batchSize || 10), 20));
  const now = Date.now();
  const result = await jobsCollection.where({
    status: 'pending',
    nextRunAt: _.lte(now),
  }).orderBy('updatedAt', 'asc').limit(batchSize).get();
  const jobs = result.data || [];

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const job of jobs) {
    const claimed = await claimJob(job);
    if (!claimed) {
      continue;
    }
    processed += 1;
    try {
      if (job.type === 'walk') {
        await processWalkJob(job);
      } else if (job.type === 'team') {
        await processTeamJob(job);
      } else {
        await markSucceeded(job._id, { skippedReason: 'unknown_type' });
      }
      succeeded += 1;
    } catch (error) {
      await markFailed(job, error);
      failed += 1;
    }
  }

  return {
    ok: true,
    processed,
    succeeded,
    failed,
    pendingCount: jobs.length,
  };
};
