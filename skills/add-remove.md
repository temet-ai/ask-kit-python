Add or remove a dependency with uv and leave the lock and the virtualenv in line

1. `await scripts.run("sync")` first. Note `lockCurrent` and `envInSync`; a project that is already
   out of line is reported before anything is changed.
2. `await scripts.run("project", { only: ["dependencies", "optionalDependencies", "dependencyGroups"] })`
   to see where the package belongs. A tool used only for development (pytest, ruff, mypy) goes
   in a group: `uv add --dev <name>` or `uv add --group <group> <name>`. An optional feature goes in
   an extra: `uv add --optional <extra> <name>`. Everything else is a plain dependency.
3. Add: `py.run("uv", "add", "<name>")` with a version bound only when the request gives one
   (`"requests>=2.31"`). Remove: `py.run("uv", "remove", "<name>")` with the same `--dev`,
   `--group` or `--optional` flag it was added with.
4. A package that lives in the repository: `uv add --editable ../path` or a `[tool.uv.sources]`
   entry; do not copy it.
5. `uv add` and `uv remove` lock and sync in one step. Run `await scripts.run("sync")` again:
   `lockCurrent` and `envInSync` must both be true.
6. A resolution failure prints the conflicting requirements. Report them as printed and stop; do
   not loosen bounds the request did not mention.
7. The answer: the line that changed in `pyproject.toml` (read it back with the `project` script),
   the version `uv.lock` now holds, and the `sync` result.

Never edit `uv.lock` by hand. Never use `pip install` in a uv project: the next `uv sync` removes
the package again.
