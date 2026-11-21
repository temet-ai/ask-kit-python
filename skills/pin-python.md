Choose or change the Python version a project uses

1. `await scripts.run("env")`. Read `pins`, `project.requiresPython`, `venv.version` and
   `uv.python`.
2. The version must satisfy `requires-python`; check with `py.satisfies("3.12", ">=3.11")`. When
   the request asks for a version outside it, say so and stop unless it also asks to change
   `requires-python`.
3. List what is installed: `py.run("uv", "python", "list", "--only-installed")`. A version that is
   not installed is installed by `py.run("uv", "python", "install", "3.12")` (downloads an
   interpreter; only when the request asks for that version).
4. Pin: `py.run("uv", "python", "pin", "3.12")` writes `.python-version`. Give two parts (`3.12`)
   unless the request names a patch release.
5. A pin does not rebuild an existing virtualenv. Recreate it with `py.run("uv", "sync", "--python",
   "3.12")` or `uv venv --python 3.12` followed by `uv sync`. Warn first when `sync` shows
   packages with no wheel for the new version: `await scripts.run("wheels", { python: "3.12" })`.
6. Changing `requires-python` is `py.edit("pyproject.toml", 'requires-python = ">=3.11"',
   'requires-python = ">=3.12"')`, then `uv lock` so the lock follows.
7. The answer: the pin file's content, the virtualenv's version, and `envInSync` from a fresh
   `sync` run.

pyenv and mise read `.python-version` as well; a different `.tool-versions` or `mise.toml` entry in
a parent folder can disagree with it (`pins` lists them nearest first).
