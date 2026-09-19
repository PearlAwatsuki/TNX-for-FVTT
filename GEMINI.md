# Agent Directives

## CRITICAL SAFETY RULE: NO GIT CLEAN
- **NEVER, UNDER ANY CIRCUMSTANCES, run `git clean` (e.g., `git clean -f -d`).**
- This rule is absolute and permanent. 
- Using `git clean` has previously resulted in the catastrophic and unrecoverable loss of the user's untracked files.
- Even if you are trying to "clean up" your own mistakes or reset the workspace, you must NOT use `git clean`.
- If a workspace needs to be reset, only modify tracked files (e.g., `git checkout` or `git restore`), and NEVER delete untracked files.

