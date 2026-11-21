The caller's Python code fails to import, `uv run` fails, a script is not found, an install fails,
or the caller does not know which Python a project uses. Find the cause in the environment.

1. `await scripts.run("env")`. Read `problems` and `why`. A pin outside `requires-python`, a
   virtualenv on another version than the pin, a missing base interpreter and a missing `.venv`
   each explain a failing `uv run` on their own. Report them first.
2. The error names a module: `await scripts.run("why-fails", { module: "<name>" })`. The error
   names an executable: `await scripts.run("why-fails", { command: "<name>" })`. When the caller
   gave only an error text, take the module from `No module named '<x>'`.
3. `await scripts.run("sync")`. `lockCurrent: false` means `uv.lock` is behind `pyproject.toml`;
   `wouldInstall` lists what the virtualenv lacks.
4. An install or sync that fails while building a package, or an error such as `Failed building
   wheel`, `error: command 'gcc' failed` or `can't be installed because it doesn't have a source
   distribution or wheel`: `skills.read("source-build")`, then `await scripts.run("wheels")`.
5. The answer: the cause in one sentence with its evidence (the pin, the key, the package and
   version), then the command that fixes it, written out, and whether it needs `act`. When the
   request asks for the fix, apply it and run `sync` again to show `envInSync: true`.

Never fix a symptom the evidence does not show. When two causes are present (a stale lock and a
missing group), report both, in the order they must be fixed.
