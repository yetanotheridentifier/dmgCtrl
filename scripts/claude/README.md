# Autonomous runs

The user can let Claude run the whole ticket workflow unattended for a bounded time: choose tickets,
move them on the project board, branch, commit, push, open MRs, merge them once CI passes, and file
tickets for issues it finds. The rules Claude follows during a run are in `CLAUDE.md` under
"Autonomous runs". This folder holds the part that is enforced rather than instructed.

## Granting and revoking

Create `.claude/autonomy.md` (gitignored, local to this machine):

```
expires: 2026-09-16T00:00:00+01:00
merge: yes
file_tickets: yes
```

- `expires` is an ISO date and time with its offset. Once it passes, the grant is gone.
- `merge: yes` lets Claude merge MRs after the required checks pass. **Merging to `main` deploys
  dmgctrl.app.**
- `file_tickets: yes` lets Claude file new tickets for issues it finds.

Prose around those lines is ignored. Edit `expires` to extend or shorten a run, or delete the file to
revoke the grant at once.

## The guard

`grantGuard.mjs` is a PreToolUse hook on Bash. Before every shell command it blocks `git commit`,
`git push`, `gh pr create`, `gh pr merge`, `gh project item-edit`, `gh project item-add` and
`gh issue create` unless the grant is present and unexpired, and blocks merging or filing tickets when
the grant says `no` to them. A blocked command exits 2 with the reason, which Claude reads.

It is deliberately conservative: a guarded phrase anywhere in a command blocks it, including inside a
quoted message. It fails open only if its own input is unreadable, never on a missing or expired grant.

Registered locally in `.claude/settings.local.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/scripts/claude/grantGuard.mjs\"" }]
      }
    ]
  }
}
```

Tests: `npm run test:pwa -- scripts/claude/grantGuard.test.mjs`.

## Settings that go with it

Also in `.claude/settings.local.json`:

- `"attribution": { "commit": "", "pr": "" }` so commits and MRs carry no Claude attribution. Work
  goes out on the user's behalf.
- `"autoContinueAtUsageLimit": true` so a session stopped by a usage limit waits for the reset and
  carries on. Progress is also written to `.claude/run-state.md` at every step, so a fresh session can
  resume from it.
