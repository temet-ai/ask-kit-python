interface PyResult { code: number; out: string; err: string; missing?: boolean; timedOut?: boolean }
interface Venv {
  dir: string; exists: boolean;
  source: string;            // "UV_PROJECT_ENVIRONMENT" | ".venv in the project" | "VIRTUAL_ENV (an activated environment)"
  // Only when exists:
  cfg?: Record<string, string>; home?: string | null; homeExists?: boolean | null; createdBy?: string; bin?: string; executable?: string | null;
  version?: string; versionParts?: number[]; implementation?: string; platform?: string; machine?: string; freeThreaded?: boolean; libc?: string[];
  broken?: string;           // set when the interpreter does not start
}
interface Pin { file: string; folder: string | null; kind: string; value: string }
interface LockPackage { name: string; version: string | null; source: string; location: string | null; sdist: boolean; wheels: string[]; deps: string[]; groups: Record<string, string[]>; extras: Record<string, string[]> }
interface Target { version: number[]; implementation: string; platform: string; machine: string; freeThreaded: boolean; source: string }
interface Failure { test: string; file: string | null; line: number | null; kind: string; message: string; assertion?: string; trace: string }

declare const py: {
  cwd: string;  // the folder the calls run in: the project the calling agent works in
  act: boolean; // true when this ask may change things

  // One of uv, ruff, mypy, pyright, pytest, pip, python, with its arguments (no shell: pass each argument separately),
  // run in the project folder. ruff, mypy, pyright, pytest and pip come from the project's virtualenv (ruff also from PATH); uv from the
  // virtualenv or PATH. Never throws on a non-zero exit; {missing: true} when the program is not installed. It throws for:
  //  - a command that changes things when py.act is false: uv sync, lock, add, remove, run, venv, python install or pin <version>, pip install;
  //    ruff check --fix, ruff format (without --check); python with anything but --version. Reading forms are allowed:
  //    uv lock --check, uv sync --dry-run, uv tree --frozen, uv python list|find|dir, uv pip list|show|freeze|check, ruff check, ruff format --check,
  //    mypy, pyright, pytest, pip list|show|freeze|check;
  //  - what never ends or waits for a person: --watch, --pdb, mypy --daemon, ruff server; what publishes or logs in: uv publish, uv auth, --token, --password.
  // Output is masked for URL passwords and tokens. Reading calls stop after 120 seconds, changing calls after 600.
  run(program: string, ...args: string[]): Promise<PyResult>;
  // As run, but returns stdout (trailing newlines removed) and throws the program's own error on a non-zero exit.
  text(program: string, ...args: string[]): Promise<string>;

  // The same client for another project folder: py.at("../my-app"). A relative path is taken from this one.
  at(dir: string): typeof py;

  // The project folder (nearest folder at or above cwd with pyproject.toml, setup.py, setup.cfg, Pipfile or requirements.txt) and, when a
  // uv.lock sits at or above it, the folder holding it (a uv workspace keeps one lock and one .venv at its top). Throws when there is no project.
  root(): { root: string; lockRoot: string | null };

  // A TOML file as an object (python3's tomllib, so python3 3.11 or newer must be on PATH).
  toml(file: string): Promise<any>;

  // The project's virtualenv: UV_PROJECT_ENVIRONMENT, else .venv at the lock folder, else an activated VIRTUAL_ENV. When it exists,
  // its interpreter version, the base interpreter it was built from (home, and whether that folder still exists), and what created it.
  venv(): Promise<Venv>;

  // Installed distributions in the virtualenv, sorted by name: {name, version, top: some of its top-level modules}. [] when there is no working virtualenv.
  installed(): Promise<{ name: string; version: string; top: string[] }[]>;

  // Python version pins in reach, nearest first, up to the filesystem root: .python-version, .tool-versions, mise.toml, runtime.txt, and PYENV_VERSION.
  pins(): Pin[];

  // What pyproject.toml declares. packaged: whether uv installs the project itself into the virtualenv (a [build-system] or tool.uv.package = true);
  // when false, [project.scripts] are NOT created in the virtualenv and a package of the project is not importable except through the path.
  // dependencies, optionalDependencies, dependencyGroups: requirement strings (long lists are cut with a final entry saying how many).
  // tools: the settings of ruff, mypy, pytest (ini_options), pyright, coverage, black, isort, from pyproject.toml or ruff.toml.
  // declaredNames: every declared distribution name, normalised (lower case, dashes): use it for "is X declared".
  project(): Promise<{
    root: string; lockRoot: string | null; file: string | null; configFiles: string[];
    name?: string | null; version?: string | null; requiresPython?: string | null; buildBackend?: string | null; packaged?: boolean; packagedNote?: string;
    scripts?: Record<string, string>; guiScripts?: Record<string, string>; entryPoints?: Record<string, Record<string, string>>;
    dependencies?: string[]; optionalDependencies?: Record<string, string[]>; dependencyGroups?: Record<string, string[]>; legacyDevDependencies?: string[];
    uv?: { package: boolean | null; defaultGroups: string[] | null; sources: Record<string, string>; indexes: { name: string | null; url: string; default: boolean; explicit: boolean }[]; workspace: any; pythonPreference: string | null };
    toolSections?: string[]; tools?: Record<string, any>; declaredNames?: string[];
  }>;

  // uv.lock as rows, or null when there is none. source is the key uv wrote: "registry", "virtual", "editable", "directory", "path", "git", "url".
  // wheels are file names; sdist says a source archive exists; deps, groups and extras list the names a package depends on (for the project's own entry: what the lock recorded of pyproject.toml).
  lock(): Promise<{ file: string; requiresPython: string | null; version: number; revision: number; packages: LockPackage[] } | null>;

  // Does a wheel file name fit an interpreter? true, false, or null when the name is not a wheel. Predicts "no wheel for this Python, building from source"; uv decides in the end.
  wheelFits(file: string, target: Target): boolean | null;

  // The interpreter wheels must fit: the virtualenv's, else python3's on PATH; python: "3.15" overrides the version ("would it have a wheel on 3.15").
  target(o?: { python?: string }): Promise<Target>;

  // Does a Python version satisfy a requires-python specifier (">=3.11,<3.14")? null when either does not parse.
  satisfies(version: string, spec: string): boolean | null;

  // What is on this machine outside the project: python3, uv, ruff, mypy, pyright, pytest on PATH ({path, version}), pyenv (and its current version), mise. null for missing.
  toolchain(): Promise<Record<string, any>>;

  // Import a module in the virtualenv's own interpreter, from the project folder. Runs the module's import-time code.
  // {module, found (a spec exists), imported, origin, error, traceback (last lines), distributions (installed distributions that provide its top-level name), printedOnImport}.
  tryImport(module: string): Promise<{ module: string; found: boolean; imported?: boolean; origin?: string | null; error?: string; traceback?: string[]; distributions?: string[]; printedOnImport?: string; findError?: string }>;

  // The project's tests, summarised. o.path: a file, folder or node id (or a list); k: -k expression; maxfail; full: whole tracebacks; max: failures listed (default 10).
  // Runs from the virtualenv only (it must import the project's packages); {skipped} when pytest is not installed there. Writes no cache. counts has passed, failed, errors, skipped, total.
  // failures: each failing test as a node id with file:line, the exception line, the assertion lines (E ... lines) and the tail of the traceback.
  pytest(o?: { path?: string | string[]; k?: string; maxfail?: number; full?: boolean; max?: number }): Promise<{ tool: "pytest"; command: string; code: number; seconds: number; meaning: string; version: string | null; counts?: { passed: number; failed: number; errors: number; skipped: number; total: number }; failures?: Failure[]; more?: string; tail?: string; skipped?: string; timedOut?: string }>;

  // ruff check (and ruff format --check unless format: false), summarised: counts, byCode, the first `max` violations (default 15) with their file:line and whether a fix exists, and the files format would change. Changes nothing.
  ruff(o?: { path?: string | string[]; format?: boolean; max?: number }): Promise<{ tool: "ruff"; command: string; code: number; version: string | null; counts?: { violations: number; fixable: number; files: number }; byCode?: Record<string, number>; violations?: { file: string; line: number; column: number; code: string | null; message: string; fixable: string | false }[]; format?: { code: number; wouldReformat: string[] }; more?: string; error?: string; skipped?: string }>;

  // mypy, summarised: its summary line, counts, byCode, the first `max` errors (default 15) with file:line, code and message. With no path it uses the config's targets, else ".". Writes no cache.
  mypy(o?: { path?: string | string[]; max?: number }): Promise<{ tool: "mypy"; command: string; code: number; seconds: number; version: string | null; summary: string | null; counts: { errors: number; files: number }; byCode: Record<string, number>; errors: { file: string; line: number; column: number | null; severity: string; code: string | null; message: string; notes?: string[] }[]; more?: string; error?: string; skipped?: string; timedOut?: string }>;

  // pyright, summarised: counts, byRule, the first `max` diagnostics (default 15).
  pyright(o?: { path?: string | string[]; max?: number }): Promise<{ tool: "pyright"; command: string; code: number; seconds: number; version?: string | null; counts?: { errors: number; warnings: number; files: number | null }; byRule?: Record<string, number>; diagnostics?: { file: string; line: number; severity: string; rule: string | null; message: string }[]; more?: string; error?: string; skipped?: string; timedOut?: string }>;

  // Needs act. Replaces one exact piece of text, which must occur exactly once, in pyproject.toml, ruff.toml, .ruff.toml, mypy.ini, .mypy.ini, pytest.ini,
  // setup.cfg, tox.ini, pyrightconfig.json or .python-version in the project folder. Dependencies are changed with uv add and uv remove, not here.
  edit(file: string, find: string, replace: string): { file: string; replaced: true };
};
