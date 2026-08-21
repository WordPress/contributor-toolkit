# CLAUDE.md

Read **[AGENTS.md](AGENTS.md)** — it holds the instructions for this repository, and is written to be read by any agent. Nothing that belongs there should be duplicated here.

Claude Code specifics only:

- `/self-review` (`.claude/skills/self-review/SKILL.md`) is the entry point for the pre-PR review that AGENTS.md asks for. It runs the procedure in `.github/instructions/code-review.instructions.md` and dispatches the judgement pass to a subagent, so the session that wrote the change is not the one grading it.
