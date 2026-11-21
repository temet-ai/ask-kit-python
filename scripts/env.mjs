export const meta = {
  purpose:
    "Which Python and which virtualenv a project uses, and why: the version pins (.python-version, .tool-versions, mise, pyenv), requires-python, the lock's requires-python, the .venv and the interpreter it was built from, what uv python find would pick, and a list of problems (a pin outside requires-python, a virtualenv on another version than the pin, a base interpreter that is gone, no .venv yet).",
  params: { path: "another project folder to look at, optional (default: the caller's)" },
  returns:
    "{root, lockRoot, project:{name, requiresPython, packaged}, pins:[{file, folder, kind, value}], lock:{file, requiresPython}|null, venv:{dir, exists, source, version, createdBy, home, homeExists}, uv:{version, python:{path, version, error}}, machine:{python3, pyenv, mise}, why:[sentences], problems:[sentences]}",
  example: 'await scripts.run("env")',
};

export default async function ({ py }, { path } = {}) {
  const p = path ? py.at(path) : py;
  const { root, lockRoot } = p.root();
  const project = await p.project();
  const pins = p.pins();
  const lock = await p.lock().catch(() => null);
  const venv = await p.venv();
  const box = await p.toolchain();
  const why = [];
  const problems = [];

  const requires = project.requiresPython;
  const nearest = pins.find((x) => x.value);
  const uv = { version: box.uv?.version ?? null };
  if (box.uv) {
    const f = await p.run("uv", "python", "find");
    if (f.code === 0) {
      const found = f.out.trim().split("\n")[0];
      const v = await p.run("python", "--version").catch(() => null);
      uv.python = { path: found };
      const ver = await new Promise((resolve) => {
        import("node:child_process").then(({ execFile }) => execFile(found, ["--version"], { timeout: 15000 }, (e, o, er) => resolve(e ? null : (o || er).trim().replace(/^Python\s+/, ""))));
      });
      uv.python.version = ver;
    } else uv.python = { error: (f.err || f.out).trim().split("\n").slice(0, 3).join(" ") };
  }

  // Why this interpreter.
  if (venv.exists) {
    why.push(`the virtualenv ${venv.dir} (${venv.source}) is what uv run and uv sync use; it runs Python ${venv.version ?? "?"} (${venv.implementation ?? "?"}) and was created by ${venv.createdBy} from the interpreter at ${venv.home ?? "?"}`);
  } else {
    why.push(`no virtualenv exists yet (looked for ${venv.dir}); uv sync or uv run creates it`);
    if (box.uv) why.push(`the new one would use ${uv.python?.path ? `${uv.python.path} (Python ${uv.python.version ?? "?"}), which is what uv python find returns` : "the interpreter uv python find returns, and that call failed"}`);
  }
  if (nearest) why.push(`the nearest pin is ${nearest.file} = ${nearest.value}${nearest.folder ? ` in ${nearest.folder}` : ""} (read by ${nearest.kind}); a pin chooses the interpreter when a new virtualenv is created`);
  else why.push("no version pin file is in reach, so uv takes an installed interpreter that satisfies requires-python (uv python find shows which)");
  if (requires) why.push(`requires-python is ${requires} (pyproject.toml); uv refuses an interpreter outside it`);
  else if (project.file) why.push("pyproject.toml has no requires-python, so any interpreter is accepted");
  if (lock) why.push(`uv.lock at ${lock.file} was resolved for requires-python ${lock.requiresPython ?? "?"} and has ${lock.packages.length} packages`);

  // Problems.
  const pinVer = nearest?.value;
  if (pinVer && requires && p.satisfies(pinVer, requires) === false) problems.push(`the pin ${nearest.file} = ${pinVer} is outside requires-python ${requires}: uv will not accept that interpreter`);
  if (venv.exists && venv.version && requires && p.satisfies(venv.version, requires) === false) problems.push(`the virtualenv runs Python ${venv.version}, outside requires-python ${requires}: recreate it (uv venv, or uv sync after fixing the pin)`);
  if (venv.exists && venv.version && pinVer) {
    const m = String(pinVer).match(/(\d+)\.(\d+)(?:\.(\d+))?/);
    if (m && (venv.versionParts[0] !== +m[1] || venv.versionParts[1] !== +m[2] || (m[3] && venv.versionParts[2] !== +m[3]))) problems.push(`the virtualenv runs Python ${venv.version} but the pin says ${pinVer}: the .venv was built before the pin changed or from another interpreter`);
  }
  if (venv.exists && venv.homeExists === false) problems.push(`the virtualenv's base interpreter ${venv.home} is gone, so the .venv is broken: recreate it`);
  if (venv.exists && venv.broken) problems.push(`the virtualenv's interpreter does not run: ${venv.broken}`);
  if (lock && requires && lock.requiresPython && lock.requiresPython.replace(/\s/g, "") !== requires.replace(/\s/g, "")) problems.push(`uv.lock was resolved for requires-python ${lock.requiresPython} but pyproject.toml says ${requires}: the lock is stale (uv lock)`);
  if (box.uv && uv.python?.error) problems.push(`uv python find fails: ${uv.python.error}`);
  if (!box.uv) problems.push("uv is not installed (or not on PATH), so the project cannot be synced with uv here");
  if (process.env.VIRTUAL_ENV && venv.exists && process.env.VIRTUAL_ENV !== venv.dir) problems.push(`a different virtualenv is activated in this shell (${process.env.VIRTUAL_ENV}); uv run ignores it with a warning, plain python and pip use it`);
  if (project.file && !lock && box.uv) problems.push("no uv.lock: uv sync would resolve and write one");
  if (!project.file) problems.push("no pyproject.toml here: this is a setup.py, setup.cfg or requirements.txt project");

  return {
    root,
    lockRoot,
    project: { name: project.name ?? null, requiresPython: requires ?? null, packaged: project.packaged ?? null },
    pins,
    lock: lock ? { file: lock.file, requiresPython: lock.requiresPython, packages: lock.packages.length } : null,
    venv: venv.exists
      ? { dir: venv.dir, exists: true, source: venv.source, version: venv.version, implementation: venv.implementation, createdBy: venv.createdBy, home: venv.home, homeExists: venv.homeExists, broken: venv.broken ?? null }
      : { dir: venv.dir, exists: false, source: venv.source },
    uv,
    machine: { python3: box.python3, pyenv: box.pyenv, mise: box.mise },
    why,
    problems,
  };
}
