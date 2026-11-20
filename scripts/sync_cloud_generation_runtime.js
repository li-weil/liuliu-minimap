const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const syncPairs = [
  {
    sourcePath: path.join(rootDir, 'cloudfunctions', 'shared', 'generation-runtime.js'),
    targets: [
      path.join(rootDir, 'cloudfunctions', 'generateTheme', 'runtime.js'),
      path.join(rootDir, 'cloudfunctions', 'generateCombinedTheme', 'runtime.js'),
    ],
  },
];

function main() {
  syncPairs.forEach(({ sourcePath, targets }) => {
    const source = fs.readFileSync(sourcePath, 'utf8');
    const generated = `// Auto-generated from ${path.relative(rootDir, sourcePath).replace(/\\/g, '/')}\n${source}`;

    targets.forEach((targetPath) => {
      fs.writeFileSync(targetPath, generated, 'utf8');
      process.stdout.write(`synced ${path.relative(rootDir, targetPath)}\n`);
    });
  });
}

main();
