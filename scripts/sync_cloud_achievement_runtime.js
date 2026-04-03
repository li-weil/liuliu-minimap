const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const sourcePath = path.join(rootDir, 'cloudfunctions', 'shared', 'achievement-runtime.js');
const targets = [
  path.join(rootDir, 'cloudfunctions', 'createWalk', 'achievement.js'),
  path.join(rootDir, 'cloudfunctions', 'finishTeamWalk', 'achievement.js'),
  path.join(rootDir, 'cloudfunctions', 'listMyAchievements', 'achievement.js'),
  path.join(rootDir, 'cloudfunctions', 'deleteWalk', 'achievement.js'),
  path.join(rootDir, 'cloudfunctions', 'deleteTeamWalk', 'achievement.js'),
];

function main() {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const generated = `// Auto-generated from cloudfunctions/shared/achievement-runtime.js\n${source}`;

  targets.forEach((targetPath) => {
    fs.writeFileSync(targetPath, generated, 'utf8');
    process.stdout.write(`synced ${path.relative(rootDir, targetPath)}\n`);
  });
}

main();
