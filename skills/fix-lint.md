Fix ruff findings and formatting without changing behaviour

1. `await py.ruff()` for the starting counts: `counts.violations`, `counts.fixable`, `byCode`, and
   `format.wouldReformat`.
2. Fix the safe ones: `py.run("ruff", "check", "--fix", "--no-cache")`, limited to a folder or file
   when the request names one. `--fix` applies only fixes ruff marks safe. Never add
   `--unsafe-fixes` or `--add-noqa` unless the request asks for exactly that.
3. Format: `py.run("ruff", "format", "--no-cache")` when the request says format, or when the
   project already runs `ruff format --check` (a `[tool.ruff.format]` section or a pre-commit
   hook). Otherwise leave formatting alone, and report `wouldReformat` instead.
4. `await py.ruff()` again. What is left needs a decision or an edit of the source: report each
   remaining code with one `file:line`.
5. Run `await py.pytest()` when it is installed, to show that the tests still pass after the
   changes. Report a failure that was not there before.
6. The answer: counts before and after, the files changed (`git status` through the caller, or the
   files ruff reports), and what remains.

A rule that fires in many files and should not is a configuration question: report the rule code
and the `tools.ruff` settings from the `project` script. Do not add `ignore` entries without being
asked.
