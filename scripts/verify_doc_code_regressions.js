const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function requireProjectFile(relativePath) {
  return require(path.join(rootDir, relativePath));
}

function testAchievementExports() {
  const shared = requireProjectFile('cloudfunctions/shared/achievement-runtime.js');
  const localCopy = requireProjectFile('cloudfunctions/listMyAchievements/achievement.js');

  assert(Array.isArray(shared.ACHIEVEMENTS), 'shared achievement runtime must export ACHIEVEMENTS');
  assert(shared.ACHIEVEMENTS.length > 0, 'ACHIEVEMENTS should not be empty');
  assert(Array.isArray(localCopy.ACHIEVEMENTS), 'listMyAchievements achievement copy must export ACHIEVEMENTS');
  assert.strictEqual(localCopy.ACHIEVEMENTS.length, shared.ACHIEVEMENTS.length);
}

function testLockedDistanceAchievementHasNoUnlockedLabel() {
  const { computeAchievements } = requireProjectFile('cloudfunctions/shared/achievement-runtime.js');
  const endedAt = Date.parse('2026-01-02T10:00:00Z');
  const result = computeAchievements([
    {
      _id: 'short-walk',
      status: 'finished',
      endedAt,
      createdAt: endedAt,
      routeStats: { distance: 1200 },
      themeSnapshot: { category: '声音' },
    },
  ]);
  const marathon = result.achievements.find((item) => item.id === 'cat_marathon');

  assert(marathon, 'cat_marathon achievement should exist');
  assert.strictEqual(marathon.unlocked, false, 'cat_marathon should stay locked below 5km');
  assert.strictEqual(marathon.unlockedAt, null, 'locked cat_marathon should not expose unlockedAt');
  assert.strictEqual(marathon.unlockedAtLabel, '', 'locked cat_marathon should not display an unlock label');
}

function testRecentAchievementsSortsByUnlockTime() {
  const source = readProjectFile('miniprogram/pages/history/history.js');

  assert(
    /buildRecentAchievements[\s\S]*sort\(/.test(source) && /unlockedAt/.test(source),
    'buildRecentAchievements should sort unlocked achievements by unlockedAt before slicing'
  );
}

function testRecordSaveRequiresCheckInForMissionContent() {
  const source = readProjectFile('miniprogram/pages/record/record.js');

  assert(
    /findUnconfirmedMissionContent/.test(source),
    'record save should find missions with content that have not been checked in'
  );
  assert(
    /请先完成打卡/.test(source),
    'record save should tell the user to check in recorded content before saving'
  );
}

function testTeamRoomFinishShowsPendingMemberNames() {
  const source = readProjectFile('miniprogram/pages/team-room/team-room.js');

  assert(
    /pending_member_sync/.test(source),
    'team-room finish should handle pending_member_sync errors explicitly'
  );
}

testAchievementExports();
testLockedDistanceAchievementHasNoUnlockedLabel();
testRecentAchievementsSortsByUnlockTime();
testRecordSaveRequiresCheckInForMissionContent();
testTeamRoomFinishShowsPendingMemberNames();

console.log('doc/code regression checks passed');
