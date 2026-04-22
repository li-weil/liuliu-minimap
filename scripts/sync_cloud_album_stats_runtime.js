const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const sourcePath = path.join(rootDir, 'cloudfunctions', 'shared', 'album-stats-runtime.js');
const targets = [
  path.join(rootDir, 'cloudfunctions', 'createWalk', 'album-stats.js'),
  path.join(rootDir, 'cloudfunctions', 'deleteWalk', 'album-stats.js'),
  path.join(rootDir, 'cloudfunctions', 'createTeamRoom', 'album-stats.js'),
  path.join(rootDir, 'cloudfunctions', 'joinTeamRoom', 'album-stats.js'),
  path.join(rootDir, 'cloudfunctions', 'leaveTeamRoom', 'album-stats.js'),
  path.join(rootDir, 'cloudfunctions', 'startTeamWalk', 'album-stats.js'),
  path.join(rootDir, 'cloudfunctions', 'finishTeamWalk', 'album-stats.js'),
  path.join(rootDir, 'cloudfunctions', 'deleteTeamWalk', 'album-stats.js'),
  path.join(rootDir, 'cloudfunctions', 'listMyWalks', 'album-stats.js'),
  path.join(rootDir, 'cloudfunctions', 'listMyTeamWalks', 'album-stats.js'),
  path.join(rootDir, 'cloudfunctions', 'syncUser', 'album-stats.js'),
  path.join(rootDir, 'cloudfunctions', 'repairDissolvedTeamRooms', 'album-stats.js'),
];

function main() {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const generated = `// Auto-generated from cloudfunctions/shared/album-stats-runtime.js\n${source}`;

  targets.forEach((targetPath) => {
    fs.writeFileSync(targetPath, generated, 'utf8');
    process.stdout.write(`synced ${path.relative(rootDir, targetPath)}\n`);
  });
}

main();
