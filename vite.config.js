import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { REPO_URL } from './site.config.js';

// The commit being built: Cloudflare's git builds set WORKERS_CI_COMMIT_SHA,
// a local `npm run deploy` reads it from git.
function commitSha() {
  if (process.env.WORKERS_CI_COMMIT_SHA) return process.env.WORKERS_CI_COMMIT_SHA;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

export default defineConfig(({ command }) => {
  const sha = command === 'build' ? commitSha() : '';
  const version = sha ? `v.${sha.slice(0, 4)}` : 'v.dev';
  return {
    plugins: [
      {
        name: 'html-vars',
        transformIndexHtml: (html) =>
          html.replaceAll('%APP_VERSION%', version).replaceAll('%REPO_URL%', REPO_URL),
      },
    ],
    build: {
      target: 'es2022',
      modulePreload: { polyfill: false },
      chunkSizeWarningLimit: 900,
    },
  };
});
