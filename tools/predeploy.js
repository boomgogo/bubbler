// Stops a deploy from a tree with uncommitted changes: the version label in the
// corner of the game names the commit, so the build has to match it.
import { execSync } from 'node:child_process';

const dirty = execSync('git status --porcelain').toString().trim();
if (dirty && process.env.ALLOW_DIRTY !== '1') {
  console.error('Uncommitted changes:\n' + dirty);
  console.error('\nCommit first so the version label matches what is deployed, or run with ALLOW_DIRTY=1.');
  process.exit(1);
}
