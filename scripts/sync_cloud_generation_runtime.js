const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const sourcePath = path.join(rootDir, 'cloudfunctions', 'shared', 'generation-runtime.js');
const targets = [
  path.join(rootDir, 'cloudfunctions', 'generateTheme', 'runtime.js'),
  path.join(rootDir, 'cloudfunctions', 'generateRandomTheme', 'runtime.js'),
  path.join(rootDir, 'cloudfunctions', 'generateCombinedTheme', 'runtime.js'),
];

function main() {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const generated = `// Auto-generated from cloudfunctions/shared/generation-runtime.js\n${source}`;

  targets.forEach((targetPath) => {
    fs.writeFileSync(targetPath, generated, 'utf8');
    process.stdout.write(`synced ${path.relative(rootDir, targetPath)}\n`);
  });
}

main();
