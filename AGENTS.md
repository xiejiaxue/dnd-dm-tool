# Project workflow

- Production source of truth: GitHub `xiejiaxue/dnd-dm-tool`, branch `main`.
- Canonical local checkout: `/Users/xiejiaxue/developer/dndtool`.
- Preserve the Swiss UI and client-side tool navigation unless the task requests changes.
- Start changes on a task branch. Concurrent agents must use separate Git worktrees; do not switch another agent's branch or modify its uncommitted work.
- Run `npm ci`, `npm test`, `npm run music:prepare`, and `npm run build` before release. Music bytes must match the checked-in credits manifest.
- Production releases run only through `.github/workflows/production.yml` after main is updated. Never deploy directly from a worktree, a detached HEAD, or an uncommitted checkout.
- The release pipeline preserves existing Worker vars and uses pinned D1/R2 resources. Do not recreate resources or run remote database migrations as part of a routine release.
- Check the workflow's deploy verification and `https://dnd.xiejiaxue.com/release.json` before claiming a release succeeded.
- Never commit `.dev.vars`, `.env` credentials, local state, character exports, or screenshots.
- Open TRPG is a separate unfinished experiment at `/Users/xiejiaxue/developer/experiments/open-trpg-engine`; do not merge or deploy it accidentally.
- Cleanup and rollback instructions: `docs/project-workflow.md`.
