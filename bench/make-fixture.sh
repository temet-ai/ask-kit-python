#!/bin/sh
# Builds the virtualenvs the bench questions are about, in bench/fixtures/clacks/.venv and
# bench/fixtures/overseer/.venv (ignored by git). The projects themselves are committed.
# clacks gets pytest and ruff when uv can install them (network or a warm uv cache); without them
# the bench still runs its environment shots. Run it once before the bench.
set -e
here=$(cd "$(dirname "$0")" && pwd)
for p in clacks overseer; do
  rm -rf "$here/fixtures/$p/.venv"
  python3 -m venv "$here/fixtures/$p/.venv"
done
if command -v uv >/dev/null 2>&1; then
  uv pip install --quiet --python "$here/fixtures/clacks/.venv/bin/python" pytest ruff \
    || echo "make-fixture: pytest and ruff were not installed; the check shots will report them missing" >&2
else
  echo "make-fixture: uv is not installed; pytest and ruff were not added to the clacks venv" >&2
fi
