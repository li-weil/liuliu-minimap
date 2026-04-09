let cloud = null;

try {
  cloud = require('wx-server-sdk');
} catch (error) {
  process.stderr.write('缺少依赖 wx-server-sdk，请先在仓库根目录执行：npm install wx-server-sdk\n');
  process.exit(1);
}

const DEFAULT_LIMIT = 100;

function parseArgs(argv) {
  const args = {
    envId: '',
    dryRun: false,
    limit: DEFAULT_LIMIT,
  };

  argv.forEach((arg) => {
    if (!arg) {
      return;
    }
    if (arg === '--dry-run') {
      args.dryRun = true;
      return;
    }
    if (arg.startsWith('--limit=')) {
      const value = Number(arg.split('=')[1]);
      if (Number.isFinite(value) && value > 0) {
        args.limit = Math.min(Math.floor(value), DEFAULT_LIMIT);
      }
      return;
    }
    if (!args.envId) {
      args.envId = arg;
    }
  });

  return args;
}

function buildSummary(room) {
  if (room && room.teamSummary) {
    return room.teamSummary;
  }
  return '这次同行房间已由房主解散，记录归档为已结束。';
}

function buildTeamStats(room, memberCount) {
  const stats = room && room.teamStats ? room.teamStats : {};
  const themeSnapshot = room && room.themeSnapshot ? room.themeSnapshot : {};
  const totalMissionCount = Array.isArray(themeSnapshot.missions) ? themeSnapshot.missions.length : 0;
  return {
    ...stats,
    memberCount,
    totalMissionCount,
    completedMissionCount: Number(stats.completedMissionCount || 0),
    contributionCount: Number(stats.contributionCount || 0),
    photoCount: Number(stats.photoCount || 0),
    videoCount: Number(stats.videoCount || 0),
    audioCount: Number(stats.audioCount || 0),
  };
}

async function listDissolvedRooms(db, limit) {
  const result = await db.collection('teamWalkRooms')
    .where({ status: 'dissolved' })
    .limit(limit)
    .get();
  return result.data || [];
}

async function getJoinedMemberCount(db, roomId) {
  const result = await db.collection('teamWalkMembers')
    .where({ roomId, status: 'joined' })
    .count();
  return result && typeof result.total === 'number' ? result.total : 0;
}

async function repairRoom(db, room, dryRun) {
  const roomId = room && room._id ? room._id : '';
  if (!roomId) {
    return { roomId: '', updated: false, reason: 'missing_id' };
  }

  const memberCount = await getJoinedMemberCount(db, roomId);
  const nextData = {
    status: 'finished',
    endedAt: room.endedAt || room.updatedAt || room.createdAt || Date.now(),
    teamSummary: buildSummary(room),
    teamStats: buildTeamStats(room, memberCount),
  };

  if (!dryRun) {
    await db.collection('teamWalkRooms').doc(roomId).update({ data: nextData });
  }

  return {
    roomId,
    updated: true,
    nextData,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.envId) {
    process.stderr.write('用法：node scripts/repair_dissolved_team_rooms.js <cloudEnvId> [--dry-run] [--limit=100]\n');
    process.exit(1);
  }

  cloud.init({ env: args.envId });
  const db = cloud.database();

  const rooms = await listDissolvedRooms(db, args.limit);
  if (!rooms.length) {
    process.stdout.write('没有找到 status 为 dissolved 的同行房间记录。\n');
    return;
  }

  process.stdout.write(`${args.dryRun ? '预检查' : '开始修复'} ${rooms.length} 条 dissolved 同行房间记录...\n`);

  const results = [];
  for (const room of rooms) {
    const result = await repairRoom(db, room, args.dryRun);
    results.push(result);
    if (result.updated) {
      process.stdout.write(`${args.dryRun ? '[dry-run]' : '[updated]'} ${result.roomId}\n`);
    } else {
      process.stdout.write(`[skipped] ${result.roomId || 'unknown'} ${result.reason || ''}\n`);
    }
  }

  const updatedCount = results.filter((item) => item.updated).length;
  process.stdout.write(`${args.dryRun ? '预检查完成' : '修复完成'}：${updatedCount} / ${rooms.length}\n`);
}

main().catch((error) => {
  process.stderr.write(`修复失败：${error && error.message ? error.message : String(error)}\n`);
  process.exit(1);
});
