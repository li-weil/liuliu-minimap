const cloud = require('wx-server-sdk');
const { buildUserAlbumStats } = require('../cloudfunctions/shared/album-stats-runtime');

const env = process.env.WECHAT_CLOUD_ENV || process.env.CLOUD_ENV || cloud.DYNAMIC_CURRENT_ENV;
const pageSize = Math.min(Math.max(Number(process.env.PAGE_SIZE || 100), 1), 100);
const dryRun = process.argv.includes('--dry-run');

cloud.init({ env });

const db = cloud.database();
const _ = db.command;

async function loadUserPage(skip) {
  const result = await db.collection('users')
    .skip(skip)
    .limit(pageSize)
    .get();
  return result.data || [];
}

async function saveUserAlbumStats(openid, albumStats) {
  await db.collection('users').doc(openid).update({
    data: {
      albumStats,
    },
  });
}

async function main() {
  let skip = 0;
  let scanned = 0;
  let updated = 0;

  while (true) {
    const users = await loadUserPage(skip);
    if (!users.length) {
      break;
    }

    for (const user of users) {
      const openid = user && (user.openid || user._id);
      if (!openid) {
        continue;
      }
      const albumStats = await buildUserAlbumStats({ db, _, openid });
      scanned += 1;
      if (!dryRun) {
        await saveUserAlbumStats(openid, albumStats);
        updated += 1;
      }
      process.stdout.write(`${dryRun ? 'checked' : 'updated'} ${openid}: total=${albumStats.totalCount}, solo=${albumStats.soloCount}, team=${albumStats.teamCount}\n`);
    }

    if (users.length < pageSize) {
      break;
    }
    skip += users.length;
  }

  process.stdout.write(`done: scanned=${scanned}, updated=${updated}, dryRun=${dryRun}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
