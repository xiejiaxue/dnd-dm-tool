# Project workflow

- Production source of truth: GitHub `xiejiaxue/dnd-dm-tool`, branch `main`.
- Canonical local checkout: `/Users/xiejiaxue/developer/dndtool`.
- Preserve the Swiss UI and client-side tool navigation unless the task requests changes.
- Start changes on a task branch and merge through a PR after the required Test and build check passes. main rejects direct pushes, force pushes, and deletion. Concurrent agents must use separate Git worktrees; do not switch another agent's branch or modify its uncommitted work.
- Run `npm ci`, `npm run music:prepare`, `npm test`, and `npm run build` before release. Music bytes must match the checked-in credits manifest.
- GitHub only tests and builds. Never deploy on a push or merge. Deploy only when the user explicitly requests a website release, using `npm run deploy:production` from a clean local main checkout. The command authenticates, prepares music, tests, builds, stamps, deploys, and verifies. Never add Cloudflare credentials or a deploy job to GitHub.
- The release pipeline preserves existing Worker vars and uses pinned D1/R2 resources. Do not recreate resources or run remote database migrations as part of a routine release.
- Check the local release verification and `https://dnd.xiejiaxue.com/release.json` before claiming a release succeeded.
- Never commit `.dev.vars`, `.env` credentials, local state, character exports, or screenshots.
- Open TRPG is a separate unfinished experiment at `/Users/xiejiaxue/developer/experiments/open-trpg-engine`; do not merge or deploy it accidentally.
- Cleanup and rollback instructions: `docs/project-workflow.md`.
