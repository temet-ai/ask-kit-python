// A client for a Python project and its environment: which interpreter and virtualenv it uses and
// why, whether the environment matches uv.lock, why an import or `uv run` fails, what pyproject.toml
// declares, and the project's own pytest, ruff, mypy and pyright runs, summarised. When the caller
// asked for a change it also acts: uv sync, add, remove, lock and python pin, ruff --fix and ruff
// format, and a small edit of the project's config files.
//
// Three checks. A call that changes the project or the environment needs `act` (the caller asked
// for a change); answers go to a cloud model, so output never carries a credential (URL passwords
// and tokens are masked, publishing and login commands are refused); and commands that never end
// (watch modes, debuggers, servers) are refused. Programs run with execFile, never through a shell.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const deny = (why) => {
  throw new Error(`not allowed: ${why}`);
};
const notInThisAsk = (what) => {
  throw new Error(`not in this ask: ${what} changes things, and the caller did not ask for a change (act: true), so nothing was done. Answer what you can, and say that this needs \`ask\` with act: true. Do not look for another way to do it.`);
};

const PROGRAMS = new Set(["uv", "ruff", "mypy", "pyright", "pytest", "pip", "python"]);
const flag = (rest, ...names) => rest.some((x) => names.some((n) => x === n || x.startsWith(n + "=")));
const positional = (rest) => rest.filter((x) => !x.startsWith("-"));

// uv options that take their value as the next argument and may come before the subcommand.
const UV_GLOBAL_VALUE = new Set(["--directory", "--project", "--config-file", "--cache-dir", "--color", "--python-preference", "--python-downloads", "--allow-insecure-host"]);

/** Does `<program> <args>` change the project, the environment or anything else on disk? Throws for what never ends or prints credentials. */
function classify(program, args) {
  const a = args.map(String);
  if (!PROGRAMS.has(program)) deny(`py.run runs ${[...PROGRAMS].join(", ")} only, not ${program}`);
  if (flag(a, "--token", "--password", "--username", "--publish-url", "--keyring-provider")) deny("an option that carries a credential");
  switch (program) {
    case "uv": {
      let i = 0;
      for (; i < a.length; i++) {
        if (UV_GLOBAL_VALUE.has(a[i])) i++;
        else if (!a[i].startsWith("-")) break;
      }
      const sub = a[i] ?? "";
      const rest = a.slice(i + 1);
      const pos = positional(rest);
      if (!sub) return false; // uv --version, uv --help
      if (["publish", "auth", "self"].includes(sub)) deny(`uv ${sub} publishes, logs in or changes uv itself`);
      if (flag(rest, "--watch")) deny("watch modes never end");
      switch (sub) {
        case "help": return false;
        case "lock": return !flag(rest, "--check", "--check-exists");
        case "sync": return !flag(rest, "--dry-run", "--check");
        // Without --frozen or --locked, tree and export may rewrite uv.lock first.
        case "tree": case "export": return !flag(rest, "--frozen", "--locked");
        case "version": return pos.length > 0 || flag(rest, "--bump");
        case "python": return !(["list", "find", "dir"].includes(pos[0]) || (pos[0] === "pin" && pos.length === 1));
        case "pip": return !["list", "show", "freeze", "check", "tree"].includes(pos[0]);
        case "tool": return !["list", "dir"].includes(pos[0]);
        case "cache": return pos[0] !== "dir";
        default: return true; // run, add, remove, init, venv, build, ...
      }
    }
    case "ruff": {
      const sub = positional(a)[0] ?? "";
      if (sub === "server") deny("ruff server never ends");
      if (flag(a, "--watch", "-w")) deny("watch modes never end");
      if (!sub) return false; // ruff --version
      if (["rule", "config", "linter", "version", "analyze"].includes(sub)) return flag(a, "--output-file");
      if (sub === "check") return flag(a, "--fix", "--fix-only", "--add-noqa", "--unsafe-fixes", "--output-file");
      if (sub === "format") return !flag(a, "--check", "--diff") || flag(a, "--output-file");
      return true; // clean, and anything unknown
    }
    case "mypy":
      if (flag(a, "--daemon")) deny("mypy as a daemon never ends");
      return flag(a, "--install-types", "--junit-xml", "--html-report", "--xml-report", "--txt-report", "--linecount-report", "--linecoverage-report", "--lineprecision-report", "--any-exprs-report", "--cobertura-xml-report", "--xslt-html-report", "--xslt-txt-report", "--stubgen", "--output");
    case "pyright":
      if (flag(a, "--watch", "-w")) deny("watch modes never end");
      return flag(a, "--createstub");
    case "pytest":
      if (flag(a, "--pdb", "--trace", "--looponfail", "-f", "--stepwise-skip")) deny("a debugger or a watch mode waits for a person");
      return flag(a, "--junitxml", "--junit-xml", "--basetemp", "--resultlog", "--cov-report", "--html", "--report-log");
    case "pip":
      return !["list", "show", "freeze", "check"].includes(positional(a)[0]);
    case "python":
      return !(a.length === 1 && ["--version", "-V", "-VV"].includes(a[0]));
  }
  return true;
}

// user:password@ in a URL, bearer headers and well-known token shapes never reach the model.
const mask = (s) =>
  String(s ?? "")
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, "$1***@")
    .replace(/(authorization:\s*)(bearer|basic)\s+\S+/gi, "$1$2 ***")
    .replace(/\b(pypi-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{16,})/g, "***");

const norm = (s) => String(s).toLowerCase().replace(/[-_.]+/g, "-");
const depName = (s) => String(s).match(/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/)?.[1] ?? String(s);

function exec(file, args, { cwd, timeoutMs = 120_000, env = {} } = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { cwd, timeout: timeoutMs, maxBuffer: 64 << 20, encoding: "utf8", env: { ...process.env, ...env } }, (err, stdout, stderr) => {
      if (err?.code === "ENOENT") resolve({ code: 127, out: "", err: `${path.basename(file)} is not installed`, missing: true });
      else resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: mask(stdout), err: mask(stderr).slice(0, 6000), ...(err?.killed ? { timedOut: true } : {}) });
    });
  });
}

const BASE_ENV = { NO_COLOR: "1", TERM: "dumb", UV_NO_PROGRESS: "1", PYTHONDONTWRITEBYTECODE: "1", PIP_NO_INPUT: "1", PIP_DISABLE_PIP_VERSION_CHECK: "1", PYTHONUNBUFFERED: "1" };

function which(name) {
  for (const d of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!d) continue;
    const p = path.join(d, name);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      if (fs.statSync(p).isFile()) return p;
    } catch {}
  }
  return null;
}

const exists = (p) => {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
};

const MARKERS = ["pyproject.toml", "setup.py", "setup.cfg", "Pipfile", "requirements.txt"];

const TOML_PY = "import sys,json,tomllib\nwith open(sys.argv[1],'rb') as f:\n    d=tomllib.load(f)\nprint(json.dumps(d,default=str))";
const LOCK_PY = `import sys,json,tomllib
with open(sys.argv[1],'rb') as f:
    d=tomllib.load(f)
out=[]
for p in d.get('package',[]):
    s=p.get('source',{})
    kind=next(iter(s),'unknown')
    w=[]
    for x in p.get('wheels',[]):
        u=x.get('url') or x.get('path') or x.get('filename') or ''
        w.append(u.rsplit('/',1)[-1])
    out.append({'name':p['name'],'version':p.get('version'),'source':kind,'location':s.get(kind) if isinstance(s.get(kind),str) else None,'sdist':'sdist' in p,'wheels':w,'deps':[x['name'] for x in p.get('dependencies',[])],'groups':{g:[x['name'] for x in v] for g,v in p.get('dev-dependencies',{}).items()},'extras':{g:[x['name'] for x in v] for g,v in p.get('optional-dependencies',{}).items()}})
print(json.dumps({'requiresPython':d.get('requires-python'),'version':d.get('version'),'revision':d.get('revision'),'packages':out}))`;
const INFO_PY = `import json,sys,sysconfig,platform
print(json.dumps({'version':list(sys.version_info[:3]),'executable':sys.executable,'prefix':sys.prefix,'basePrefix':sys.base_prefix,'platform':sysconfig.get_platform(),'machine':platform.machine(),'implementation':sys.implementation.name,'freeThreaded':bool(sysconfig.get_config_var('Py_GIL_DISABLED')),'libc':list(platform.libc_ver())}))`;
const DISTS_PY = `import json,importlib.metadata as m
rows=[]
for d in m.distributions():
    try:
        rows.append({'name':d.metadata['Name'],'version':d.version,'top':sorted({(f.parts[0] if len(f.parts)>1 else f.stem) for f in (d.files or []) if f.suffix in ('.py','.so','.pyd') or f.name=='__init__.py'} - {'__pycache__'})[:8]})
    except Exception:
        pass
print(json.dumps(rows))`;
const IMPORT_PY = `import sys,json,importlib.util,traceback
name=sys.argv[1]
r={'module':name}
try:
    spec=importlib.util.find_spec(name)
except BaseException as e:
    spec=None
    r['findError']=type(e).__name__+': '+str(e)
r['found']=spec is not None
if spec is not None:
    r['origin']=spec.origin
    try:
        __import__(name)
        r['imported']=True
    except BaseException as e:
        r['imported']=False
        r['error']=type(e).__name__+': '+str(e)
        r['traceback']=traceback.format_exc().splitlines()[-14:]
try:
    import importlib.metadata as m
    r['distributions']=m.packages_distributions().get(name.split('.')[0],[])
except Exception:
    r['distributions']=[]
sys.stdout.write('\\n@@RESULT@@'+json.dumps(r)+'\\n')`;

const decodeXml = (s) =>
  String(s ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], decodeXml(m[2])]));
const clip = (s, n) => (s == null ? s : String(s).length > n ? String(s).slice(0, n) + ` [cut ${String(s).length - n} more characters]` : String(s));

/** Does a wheel file name fit this interpreter and platform? Mirrors the tag rules of PEP 425 closely enough to predict "no wheel for this Python"; uv decides in the end. */
export function wheelFits(file, info) {
  const m = String(file).match(/^(.+?)-(.+?)(?:-(\d[^-]*))?-([^-]+)-([^-]+)-([^-]+)\.whl$/);
  if (!m) return null;
  const [maj, min] = info.version;
  const pys = m[4].split("."), abis = m[5].split("."), plats = m[6].split(".");
  const impl = info.implementation === "cpython" ? "cp" : info.implementation === "pypy" ? "pp" : info.implementation;
  const pyOk = pys.some((t) => t === `py${maj}` || t === `py${maj}${min}` || t === `${impl}${maj}${min}` || t === `${impl}${maj}`
    || (t.startsWith(`cp${maj}`) && abis.includes("abi3") && impl === "cp" && +t.slice(`cp${maj}`.length) <= min));
  if (!pyOk) return false;
  const abiOk = abis.some((t) => {
    if (t === "none") return true;
    if (t === "abi3") return impl === "cp" && !info.freeThreaded;
    return t === `${impl}${maj}${min}${info.freeThreaded ? "t" : ""}` || t === `${impl}${maj}${min}`;
  });
  if (!abiOk) return false;
  const plat = info.platform ?? "";
  const arch = String(info.machine ?? "").toLowerCase();
  return plats.some((t) => {
    if (t === "any") return true;
    if (/^linux-/.test(plat)) {
      const archs = arch === "amd64" ? ["x86_64"] : [arch];
      const mm = t.match(/^(manylinux\w*|linux)_(.+)$/) ;
      return !!mm && archs.some((x) => t.endsWith("_" + x)) && !/^musllinux/.test(t);
    }
    if (/^macosx-/.test(plat)) return /^macosx_/.test(t) && (/universal2$/.test(t) || t.endsWith("_" + arch) || (arch === "arm64" && /arm64$/.test(t)));
    if (/^win/.test(plat)) return /^win/.test(t) && (plat === "win-amd64" ? t === "win_amd64" : plat === "win-arm64" ? t === "win_arm64" : t === "win32");
    return false;
  });
}


const verOf = (s) => {
  const m = String(s ?? "").match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return m ? [+m[1], +m[2], m[3] != null ? +m[3] : null] : null;
};
const cmp = (a, b) => {
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
};

/** Does a Python version ("3.12", "3.12.4", "cpython-3.12") satisfy a requires-python specifier (">=3.11,<3.14", "~=3.12", "==3.12.*")? true, false, or null when either does not parse. */
export function satisfies(version, spec) {
  const v = verOf(version);
  if (!v || !spec) return null;
  for (const raw of String(spec).split(",")) {
    const m = raw.trim().match(/^(>=|<=|==|!=|~=|>|<|===)\s*(\d+(?:\.\d+)*)(\.\*)?/);
    if (!m) return null;
    const want = m[2].split(".").map(Number);
    const [op, star] = [m[1], !!m[3]];
    const v2 = [v[0], v[1], v[2]];
    let ok;
    if (op === "==" || op === "===" || op === "!=") {
      const n = star ? want.length : Math.min(want.length, v[2] == null ? 2 : 3);
      const same = want.slice(0, n).every((x, i) => x === (v2[i] ?? 0));
      ok = op === "!=" ? !same : same;
    } else if (op === "~=") ok = cmp(v2, want) >= 0 && want.slice(0, Math.max(1, want.length - 1)).every((x, i) => x === (v2[i] ?? 0));
    else {
      const c = cmp(v2, want);
      ok = op === ">=" ? c >= 0 : op === ">" ? c > 0 : op === "<=" ? c <= 0 : c < 0;
    }
    if (!ok) return false;
  }
  return true;
}

// The module source: make(ctx) returns the `py` global, for the project the caller works in.
export function make({ settings, push, cwd, act }) {
  const start = cwd || process.cwd();
  const timeout = Math.max(10, Number(settings?.PY_CHECK_TIMEOUT_SECONDS) || 300);
  return makePy({ cwd: start, push, act: !!act, timeoutSeconds: timeout });
}

export function makePy({ cwd, push = () => {}, act = false, timeoutSeconds = 300 }) {
  const tomlCache = new Map();

  /** Nearest folder with a Python project marker, going up from cwd; the lock folder is the nearest at or above it that holds uv.lock (a uv workspace keeps one lock and one .venv at its top). */
  function findRoot(from = cwd) {
    let d = path.resolve(from);
    let root = null;
    for (;;) {
      if (!root && (MARKERS.some((m) => exists(path.join(d, m))) || fs.readdirSync(d).some((f) => /^requirements.*\.txt$/.test(f)))) root = d;
      if (root && exists(path.join(d, "uv.lock"))) return { root, lockRoot: d };
      const up = path.dirname(d);
      if (up === d) break;
      d = up;
    }
    if (!root) throw new Error(`no Python project at or above ${cwd}: no pyproject.toml, setup.py, setup.cfg, Pipfile or requirements.txt`);
    return { root, lockRoot: null };
  }

  const envFor = (extra = {}) => ({ ...BASE_ENV, ...(act ? {} : { UV_PYTHON_DOWNLOADS: "manual" }), ...extra });

  async function toml(file, script = TOML_PY) {
    const p = path.resolve(cwd, file);
    const key = p + ":" + (script === TOML_PY ? "t" : "l") + ":" + fs.statSync(p).mtimeMs;
    if (tomlCache.has(key)) return tomlCache.get(key);
    const r = await exec("python3", ["-I", "-c", script, p], { cwd, timeoutMs: 30_000 });
    if (r.code !== 0) throw new Error(/tomllib/.test(r.err) ? "reading TOML needs python3 3.11 or newer (tomllib) on PATH" : `could not read ${p}: ${r.err.trim().slice(0, 300)}`);
    const v = JSON.parse(r.out);
    tomlCache.set(key, v);
    return v;
  }

  /** Where this project's virtualenv is, and why: UV_PROJECT_ENVIRONMENT, else .venv at the lock folder (or project folder), else an active VIRTUAL_ENV. */
  function venvDir() {
    const { root, lockRoot } = findRoot();
    const base = lockRoot ?? root;
    const candidates = [];
    if (process.env.UV_PROJECT_ENVIRONMENT) candidates.push({ dir: path.resolve(base, process.env.UV_PROJECT_ENVIRONMENT), source: "UV_PROJECT_ENVIRONMENT" });
    candidates.push({ dir: path.join(base, ".venv"), source: ".venv in the project" });
    if (process.env.VIRTUAL_ENV) candidates.push({ dir: process.env.VIRTUAL_ENV, source: "VIRTUAL_ENV (an activated environment)" });
    for (const c of candidates) if (exists(path.join(c.dir, "pyvenv.cfg"))) return { ...c, exists: true };
    return { dir: candidates[0].dir, source: candidates[0].source, exists: false };
  }

  const binDir = (v) => (exists(path.join(v.dir, "bin")) ? path.join(v.dir, "bin") : path.join(v.dir, "Scripts"));

  /** A program: the project's virtualenv first, else PATH. `venvOnly` programs (they import the project's packages) are not taken from PATH. */
  function tool(name, { venvOnly = false } = {}) {
    const v = venvDir();
    const exe = process.platform === "win32" ? [name + ".exe", name] : [name];
    if (v.exists) for (const e of exe) if (exists(path.join(binDir(v), e))) return { path: path.join(binDir(v), e), from: "venv" };
    if (venvOnly) return null;
    const p = which(name);
    return p ? { path: p, from: "PATH" } : null;
  }

  function resolveProgram(program) {
    if (program === "python") return tool("python", { venvOnly: true })?.path ?? which("python3") ?? which("python");
    return tool(program, { venvOnly: ["mypy", "pyright", "pytest", "pip"].includes(program) })?.path ?? null;
  }

  async function run(program, ...args) {
    const changing = classify(program, args);
    if (!act && changing) notInThisAsk(`${program} ${args.map(String).join(" ").slice(0, 80)}`);
    const exe = resolveProgram(program);
    if (!exe) return { code: 127, out: "", err: `${program} is not installed in this project's virtualenv or on PATH`, missing: true };
    const started = Date.now();
    const r = await exec(exe, args.map(String), { cwd: findRoot().root, timeoutMs: (changing ? 600 : 120) * 1000, env: envFor() });
    push({ kind: "python", detail: `${program} ${args.join(" ")}`.slice(0, 200), ms: Date.now() - started, code: r.code, size: r.out.length });
    return r;
  }
  const text = async (program, ...args) => {
    const r = await run(program, ...args);
    if (r.code !== 0) throw new Error(`${program} ${args.slice(0, 3).join(" ")}: ${(r.err || r.out).trim().slice(0, 500)}`);
    return r.out.replace(/\n+$/, "");
  };

  // Fixed code in the project's interpreter, for facts that only the interpreter knows.
  async function inVenv(code, args = [], { timeoutMs = 60_000, plain = false } = {}) {
    const v = venvDir();
    const py = v.exists ? tool("python", { venvOnly: true })?.path : null;
    if (!py) return { code: 127, out: "", err: "the project has no virtualenv", missing: true };
    return exec(py, [...(plain ? [] : ["-I"]), "-c", code, ...args], { cwd: findRoot().root, timeoutMs, env: envFor() });
  }

  const api = {
    /** The folder the calls run in. */
    cwd,
    /** True when this ask may change things. */
    act,

    /** One of uv, ruff, mypy, pyright, pytest, pip, python, with its arguments (no shell). {code, out, err, missing?, timedOut?}; never throws on a non-zero exit, only on a refusal. */
    run,
    /** As run, but returns stdout and throws the program's own error on a non-zero exit. */
    text,

    /** The same client for another project folder: py.at("../my-app"). A relative path is taken from this one. */
    at(dir) {
      const p = path.resolve(cwd, String(dir).replace(/^~(?=\/|$)/, process.env.HOME ?? "~"));
      if (!exists(p)) throw new Error(`no such folder: ${p}`);
      return makePy({ cwd: p, push, act, timeoutSeconds });
    },


    /** Does a Python version satisfy a requires-python specifier? true, false, or null when it does not parse. */
    satisfies,

    /** The interpreter a wheel must fit: {version: [3, 13], implementation, platform, machine, freeThreaded, source}. From the virtualenv, else python3 on PATH; o.python ("3.15") overrides the version only. */
    async target(o = {}) {
      const v = await api.venv();
      let info;
      if (v.exists && v.versionParts) info = { version: v.versionParts.slice(0, 2), implementation: v.implementation, platform: v.platform, machine: v.machine, freeThreaded: v.freeThreaded, source: "the project's virtualenv" };
      else {
        const p = which("python3") ?? which("python");
        const r = p ? await exec(p, ["-I", "-c", INFO_PY], { timeoutMs: 20_000 }) : null;
        if (!r || r.code !== 0) throw new Error("no virtualenv and no python3 on PATH to take the platform from");
        const j = JSON.parse(r.out);
        info = { version: j.version.slice(0, 2), implementation: j.implementation, platform: j.platform, machine: j.machine, freeThreaded: j.freeThreaded, source: "python3 on PATH (the project has no virtualenv)" };
      }
      const m = o.python ? String(o.python).match(/^(\d+)\.(\d+)/) : null;
      if (o.python && !m) throw new Error(`not a Python version: ${o.python}`);
      if (m) Object.assign(info, { version: [+m[1], +m[2]], source: info.source + `, with Python ${m[1]}.${m[2]} as asked` });
      return info;
    },

    /** What is on this machine: {python3: {path, version}, uv: {path, version}, pyenv: {path, version, current}, mise: {path, current}, ruff, mypy, pyright, pytest (on PATH, outside any virtualenv)}. null for what is missing. */
    async toolchain() {
      const out = {};
      const ver = async (name, ...a) => {
        const p = which(name);
        if (!p) return null;
        const r = await exec(p, a.length ? a : ["--version"], { cwd, timeoutMs: 15_000, env: { ...BASE_ENV } });
        return { path: p, version: (r.out || r.err).trim().split("\n")[0].replace(/^\S+\s+/, "") || null };
      };
      for (const n of ["python3", "uv", "ruff", "mypy", "pyright", "pytest"]) out[n] = await ver(n);
      if (out.python3) out.python3.version = out.python3.version;
      const pyenv = await ver("pyenv");
      if (pyenv) pyenv.current = (await exec(pyenv.path, ["version-name"], { cwd: findRoot().root, timeoutMs: 15_000, env: BASE_ENV })).out.trim() || null;
      out.pyenv = pyenv;
      const mise = which("mise");
      out.mise = mise ? { path: mise, current: (await exec(mise, ["current", "python"], { cwd: findRoot().root, timeoutMs: 15_000, env: BASE_ENV })).out.trim() || null } : null;
      return out;
    },

    /** {root, lockRoot}: the project folder and, when a uv.lock sits at or above it, the folder that holds it (a workspace root). */
    root: () => findRoot(),

    /** A TOML file as an object (read through python3's tomllib). */
    toml: (file) => toml(file),

    /** The virtualenv: {dir, exists, source, version, home, uv, executable, platform, implementation, bin, homeExists, packages}. */
    async venv() {
      const v = venvDir();
      const out = { dir: v.dir, source: v.source, exists: v.exists };
      if (!v.exists) return out;
      const cfg = {};
      for (const l of fs.readFileSync(path.join(v.dir, "pyvenv.cfg"), "utf8").split("\n")) {
        const m = l.match(/^([\w-]+)\s*=\s*(.*)$/);
        if (m) cfg[m[1]] = m[2].trim();
      }
      out.cfg = cfg;
      out.home = cfg.home ?? null;
      out.homeExists = cfg.home ? exists(cfg.home) : null;
      out.createdBy = cfg.uv ? `uv ${cfg.uv}` : cfg.virtualenv ? `virtualenv ${cfg.virtualenv}` : "python -m venv";
      out.bin = binDir(v);
      const py = tool("python", { venvOnly: true })?.path;
      out.executable = py ?? null;
      if (py) {
        const r = await inVenv(INFO_PY, [], { timeoutMs: 20_000 });
        if (r.code === 0) {
          const info = JSON.parse(r.out);
          Object.assign(out, { version: info.version.join("."), versionParts: info.version, implementation: info.implementation, platform: info.platform, machine: info.machine, freeThreaded: info.freeThreaded, libc: info.libc });
        } else out.broken = r.err.trim().slice(0, 300) || "the interpreter did not start";
      } else out.broken = "no python executable in the virtualenv's bin folder";
      return out;
    },

    /** Installed distributions in the virtualenv: [{name, version, top: its top-level modules}], sorted by name. Empty when there is no working virtualenv. */
    async installed() {
      const r = await inVenv(DISTS_PY);
      if (r.code !== 0) return [];
      return JSON.parse(r.out).sort((a, b) => a.name.localeCompare(b.name));
    },

    /** The Python version pins in reach: [{file, folder, kind, value}] from .python-version, .tool-versions, mise files and runtime.txt, nearest first, up to the filesystem root; plus PYENV_VERSION when set. */
    pins() {
      const { root } = findRoot();
      const rows = [];
      let d = root;
      for (;;) {
        const read = (f) => {
          try {
            return fs.readFileSync(path.join(d, f), "utf8");
          } catch {
            return null;
          }
        };
        const pv = read(".python-version");
        if (pv != null) rows.push({ file: ".python-version", folder: d, kind: "pyenv, mise and uv", value: pv.split("\n").map((x) => x.trim()).filter((x) => x && !x.startsWith("#")).join(", ") });
        const tv = read(".tool-versions");
        const tvm = tv?.match(/^python\s+(.+)$/m);
        if (tvm) rows.push({ file: ".tool-versions", folder: d, kind: "asdf and mise", value: tvm[1].trim() });
        for (const f of ["mise.toml", ".mise.toml", "mise.local.toml"]) {
          const mt = read(f);
          const m = mt?.match(/^\s*python\s*=\s*(?:\{[^}]*version\s*=\s*)?["']([^"']+)["']/m);
          if (m) rows.push({ file: f, folder: d, kind: "mise", value: m[1] });
        }
        const rt = read("runtime.txt");
        if (rt && /^python-/.test(rt.trim())) rows.push({ file: "runtime.txt", folder: d, kind: "a hosting platform", value: rt.trim().replace(/^python-/, "") });
        const up = path.dirname(d);
        if (up === d) break;
        d = up;
      }
      if (process.env.PYENV_VERSION) rows.unshift({ file: "PYENV_VERSION", folder: null, kind: "environment variable", value: process.env.PYENV_VERSION });
      return rows;
    },

    /** The project as pyproject.toml declares it: {root, file, name, version, requiresPython, buildBackend, packaged, scripts, guiScripts, entryPoints, dependencies, optionalDependencies, dependencyGroups, uv, tools, toolSections, configFiles}. Long lists are cut and say how many. */
    async project() {
      const { root, lockRoot } = findRoot();
      const file = path.join(root, "pyproject.toml");
      const configFiles = ["ruff.toml", ".ruff.toml", "mypy.ini", ".mypy.ini", "setup.cfg", "setup.py", "pytest.ini", "tox.ini", "pyrightconfig.json", ".pre-commit-config.yaml", "noxfile.py", "Makefile", "justfile", "conftest.py", "tests/conftest.py", "uv.toml", ".python-version", "uv.lock", "Pipfile", "poetry.lock", "requirements.txt"]
        .filter((f) => exists(path.join(root, f)));
      const out = { root, lockRoot, file: exists(file) ? file : null, configFiles };
      if (!out.file) return out;
      const t = await toml(file);
      const p = t.project ?? {};
      const cap = (list, n = 60) => (list.length > n ? [...list.slice(0, n), `[${list.length - n} more not shown; ${list.length} in all]`] : list);
      const tool = t.tool ?? {};
      out.name = p.name ?? null;
      out.version = p.version ?? (p.dynamic?.includes("version") ? "(dynamic)" : null);
      out.requiresPython = p["requires-python"] ?? null;
      out.buildBackend = t["build-system"]?.["build-backend"] ?? null;
      out.packaged = tool.uv?.package === false ? false : tool.uv?.package === true || !!t["build-system"];
      out.packagedNote = out.packaged ? "uv installs this project into the virtualenv, so its scripts exist there" : "no [build-system] and tool.uv.package is not true: uv does not install the project itself, so [project.scripts] are not created in the virtualenv";
      out.scripts = p.scripts ?? {};
      out.guiScripts = p["gui-scripts"] ?? {};
      out.entryPoints = p["entry-points"] ?? {};
      out.dependencies = cap((p.dependencies ?? []).map(String));
      out.optionalDependencies = Object.fromEntries(Object.entries(p["optional-dependencies"] ?? {}).map(([k, v]) => [k, cap(v.map(String), 30)]));
      out.dependencyGroups = Object.fromEntries(
        Object.entries(t["dependency-groups"] ?? {}).map(([k, v]) => [k, cap(v.map((x) => (typeof x === "string" ? x : `include-group: ${x["include-group"]}`)), 40)]),
      );
      if (tool.uv?.["dev-dependencies"]) out.legacyDevDependencies = cap(tool.uv["dev-dependencies"].map(String));
      const uv = tool.uv ?? {};
      out.uv = {
        package: uv.package ?? null,
        defaultGroups: uv["default-groups"] ?? null,
        sources: Object.fromEntries(Object.entries(uv.sources ?? {}).map(([k, v]) => [k, Array.isArray(v) ? "(several, by marker)" : Object.keys(v).join(", ")])),
        indexes: (uv.index ?? []).map((i) => ({ name: i.name ?? null, url: mask(i.url ?? ""), default: !!i.default, explicit: !!i.explicit })),
        workspace: uv.workspace ?? null,
        pythonPreference: uv["python-preference"] ?? null,
      };
      out.toolSections = Object.keys(tool);
      out.tools = {};
      for (const k of ["ruff", "mypy", "pytest", "pyright", "coverage", "black", "isort"]) {
        if (tool[k] !== undefined) out.tools[k] = k === "pytest" ? tool.pytest.ini_options ?? tool.pytest : tool[k];
      }
      for (const [f, k] of [["ruff.toml", "ruff"], [".ruff.toml", "ruff"]]) {
        if (configFiles.includes(f) && !out.tools[k]) out.tools[k] = { file: f, ...(await toml(path.join(root, f))) };
      }
      for (const k of Object.keys(out.tools)) {
        const s = JSON.stringify(out.tools[k]);
        if (s.length > 3000) out.tools[k] = { cut: `${s.length} characters of config; first part`, text: s.slice(0, 3000) };
      }
      // The names of every declared package, for "is X declared" questions.
      const names = new Set((p.dependencies ?? []).map(depName));
      for (const v of Object.values(p["optional-dependencies"] ?? {})) for (const x of v) names.add(depName(x));
      for (const v of Object.values(t["dependency-groups"] ?? {})) for (const x of v) if (typeof x === "string") names.add(depName(x));
      for (const x of uv["dev-dependencies"] ?? []) names.add(depName(x));
      out.declaredNames = [...names].map(norm).sort();
      return out;
    },

    /** uv.lock as rows: {file, requiresPython, version, revision, packages:[{name, version, source, location, sdist, wheels:[file names], deps}]}, or null when there is no uv.lock. */
    async lock() {
      const { lockRoot } = findRoot();
      if (!lockRoot) return null;
      const file = path.join(lockRoot, "uv.lock");
      const l = await toml(file, LOCK_PY);
      for (const p of l.packages) if (p.location) p.location = mask(p.location);
      return { file, ...l };
    },

    /** Does this wheel file name fit an interpreter? info: {version: [3, 13], implementation, platform, machine, freeThreaded}. true, false, or null for a name that is not a wheel. */
    wheelFits,

    /** Import a module in the project's own interpreter, with the project folder as the working directory: {module, found, imported, origin, error, traceback, distributions (which installed distributions provide its top-level name)}. Runs the module's import-time code. */
    async tryImport(module) {
      if (!/^[A-Za-z_][\w.]*$/.test(module)) throw new Error(`not a module name: ${module}`);
      const r = await inVenv(IMPORT_PY, [module], { plain: true, timeoutMs: 60_000 });
      if (r.missing) return { module, found: false, error: r.err };
      const m = r.out.match(/@@RESULT@@(.*)\n?$/m);
      if (!m) return { module, found: false, imported: false, error: clip((r.err || r.out).trim(), 600), exitCode: r.code, timedOut: !!r.timedOut };
      const res = JSON.parse(m[1]);
      if (r.out.split("@@RESULT@@")[0].trim()) res.printedOnImport = clip(r.out.split("@@RESULT@@")[0].trim(), 300);
      return res;
    },

    /**
     * pytest in the project's virtualenv, summarised. o: path (a file, folder or node id, or a list of them), k (-k expression), maxfail, full (keep each failure's whole traceback), max (failures listed, default 10).
     * {tool, version, command, code, seconds, counts:{passed, failed, errors, skipped}, failures:[{test, file, line, kind, message, trace}], more, tail}.
     */
    async pytest(o = {}) {
      const exe = tool("pytest", { venvOnly: true });
      if (!exe) return { tool: "pytest", skipped: "pytest is not installed in the project's virtualenv" };
      const { root } = findRoot();
      const junit = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-python-")), "junit.xml");
      const args = ["-q", "--no-header", "--tb=short", "-p", "no:cacheprovider", `--junitxml=${junit}`, "-o", "junit_family=xunit1"];
      if (o.k) args.push("-k", String(o.k));
      if (o.maxfail) args.push(`--maxfail=${+o.maxfail}`);
      args.push(...[].concat(o.path ?? []).map(String));
      const started = Date.now();
      const r = await exec(exe.path, args, { cwd: root, timeoutMs: timeoutSeconds * 1000, env: envFor() });
      push({ kind: "python", detail: `pytest ${args.slice(5).join(" ")}`.slice(0, 200), ms: Date.now() - started, code: r.code, size: r.out.length });
      const res = { tool: "pytest", command: `pytest ${[].concat(o.path ?? []).join(" ")}${o.k ? ` -k ${o.k}` : ""}`.trim(), code: r.code, seconds: Math.round((Date.now() - started) / 100) / 10 };
      if (r.timedOut) res.timedOut = `stopped after ${timeoutSeconds} seconds`;
      const meaning = { 0: "all collected tests passed", 1: "some tests failed", 2: "interrupted (a collection error or a keyboard interrupt)", 3: "internal error in pytest", 4: "pytest was called wrongly (bad option or path)", 5: "no tests were collected" };
      res.meaning = meaning[r.code] ?? "pytest ended abnormally";
      let xml = null;
      try {
        xml = fs.readFileSync(junit, "utf8");
      } catch {}
      try {
        fs.rmSync(path.dirname(junit), { recursive: true, force: true });
      } catch {}
      res.version = (await exec(exe.path, ["--version"], { cwd: root, timeoutMs: 20_000, env: envFor() })).out.trim().replace(/^pytest\s*/i, "") || null;
      if (!xml) {
        res.tail = clip((r.out + "\n" + r.err).trim().split("\n").slice(-25).join("\n"), 2500);
        return res;
      }
      const suite = attrs(xml.match(/<testsuite\b[^>]*>/)?.[0] ?? "");
      const total = +suite.tests || 0, failed = +suite.failures || 0, errors = +suite.errors || 0, skipped = +suite.skipped || 0;
      res.counts = { passed: Math.max(0, total - failed - errors - skipped), failed, errors, skipped, total };
      const failures = [];
      for (const m of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
        const body = m[2] ?? "";
        const f = body.match(/<(failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/);
        if (!f) continue;
        const tc = attrs(m[1]);
        const fa = attrs(f[2]);
        const trace = decodeXml(f[3] ?? "").trim();
        const locs = [...trace.matchAll(/^([^\s:][^\n]*?\.py):(\d+): /gm)];
        const where = locs.length ? locs[locs.length - 1] : null;
        const eLines = trace.split("\n").filter((l) => /^E\s/.test(l)).map((l) => l.replace(/^E\s+/, "")).slice(0, 8);
        const parts = (tc.classname ?? "").split(".").filter(Boolean);
        let n = parts.length;
        while (n > 0 && !exists(path.join(root, ...parts.slice(0, n)) + ".py")) n--;
        const testFile = n ? parts.slice(0, n).join("/") + ".py" : null;
        failures.push({
          test: [testFile ?? parts.join("."), ...parts.slice(n), tc.name].join("::"),
          file: where?.[1] ?? testFile,
          line: where ? +where[2] : tc.line ? +tc.line : null,
          kind: f[1] === "error" ? "error (setup, teardown or collection)" : "failure",
          message: clip(fa.message || eLines[0] || "", 400),
          ...(eLines.length > 1 ? { assertion: eLines.join("\n") } : {}),
          trace: o.full ? clip(trace, 6000) : clip(trace.split("\n").slice(-12).join("\n"), 1200),
        });
      }
      const max = o.max ?? 10;
      res.failures = failures.slice(0, max);
      if (failures.length > max) res.more = `${failures.length - max} more failures not shown; pass max or narrow with path`;
      return res;
    },

    /**
     * ruff check and, unless format is false, ruff format --check, summarised. o: path, format (default true), max (diagnostics listed, default 15).
     * {tool, version, command, code, counts:{violations, fixable, files}, byCode:{E501: 3}, violations:[{file, line, column, code, message, fixable}], format:{wouldReformat:[files]}}. Changes nothing.
     */
    async ruff(o = {}) {
      const exe = tool("ruff");
      if (!exe) return { tool: "ruff", skipped: "ruff is not installed in the project's virtualenv or on PATH" };
      const { root } = findRoot();
      const targets = [].concat(o.path ?? []).map(String);
      const started = Date.now();
      const r = await exec(exe.path, ["check", "--output-format=json", "--no-cache", ...targets], { cwd: root, timeoutMs: timeoutSeconds * 1000, env: envFor() });
      push({ kind: "python", detail: `ruff check ${targets.join(" ")}`.slice(0, 200), ms: Date.now() - started, code: r.code, size: r.out.length });
      const res = { tool: "ruff", from: exe.from, command: `ruff check ${targets.join(" ")}`.trim(), code: r.code };
      res.version = (await exec(exe.path, ["--version"], { cwd: root, timeoutMs: 20_000 })).out.trim().replace(/^ruff\s*/, "") || null;
      let rows = null;
      try {
        rows = JSON.parse(r.out);
      } catch {}
      if (!rows) {
        res.error = clip((r.err || r.out).trim(), 1500);
      } else {
        const rel = (f) => path.relative(root, f);
        res.counts = { violations: rows.length, fixable: rows.filter((x) => x.fix).length, files: new Set(rows.map((x) => x.filename)).size };
        res.byCode = Object.fromEntries(Object.entries(rows.reduce((a, x) => ((a[x.code ?? "syntax"] = (a[x.code ?? "syntax"] ?? 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).slice(0, 20));
        const max = o.max ?? 15;
        res.violations = rows.slice(0, max).map((x) => ({ file: rel(x.filename), line: x.location?.row, column: x.location?.column, code: x.code ?? null, message: x.message, fixable: x.fix ? x.fix.applicability : false }));
        if (rows.length > max) res.more = `${rows.length - max} more violations not shown; narrow with path`;
      }
      if (o.format !== false) {
        const f = await exec(exe.path, ["format", "--check", "--no-cache", ...targets], { cwd: root, timeoutMs: timeoutSeconds * 1000, env: envFor() });
        // Older ruff prints "Would reformat: path"; newer prints "unformatted: File would be reformatted" and "--> path:line:col".
        const both = f.out + "\n" + f.err;
        const files = [...new Set([...both.matchAll(/^Would reformat: (.+)$/gm), ...both.matchAll(/^\s*--> (.+?):\d+:\d+\s*$/gm)].map((m) => m[1].trim()))];
        res.format = { code: f.code, wouldReformat: files.slice(0, 30) };
        if (files.length > 30) res.format.more = `${files.length - 30} more files`;
        if (f.code > 1) res.format.error = clip((f.err || f.out).trim(), 600);
      }
      return res;
    },

    /**
     * mypy in the project's virtualenv, summarised. o: path (default: what the config names, else the project folder), max (errors listed, default 15).
     * {tool, version, command, code, summary, counts:{errors, files}, byCode, errors:[{file, line, column, code, message, notes}]}. Writes no cache.
     */
    async mypy(o = {}) {
      const exe = tool("mypy", { venvOnly: true });
      if (!exe) return { tool: "mypy", skipped: "mypy is not installed in the project's virtualenv" };
      const { root } = findRoot();
      const base = ["--no-color-output", "--no-pretty", "--show-error-codes", "--show-column-numbers", "--cache-dir=" + os.devNull];
      const targets = [].concat(o.path ?? []).map(String);
      const started = Date.now();
      let r = await exec(exe.path, [...base, ...targets], { cwd: root, timeoutMs: timeoutSeconds * 1000, env: envFor() });
      let ran = targets.length ? targets : ["(the config's targets)"];
      if (!targets.length && /Missing target module, package, files, or command/.test(r.out + r.err)) {
        r = await exec(exe.path, [...base, "."], { cwd: root, timeoutMs: timeoutSeconds * 1000, env: envFor() });
        ran = ["."];
      }
      push({ kind: "python", detail: `mypy ${ran.join(" ")}`.slice(0, 200), ms: Date.now() - started, code: r.code, size: r.out.length });
      const res = { tool: "mypy", command: `mypy ${ran.join(" ")}`, code: r.code, seconds: Math.round((Date.now() - started) / 100) / 10 };
      if (r.timedOut) res.timedOut = `stopped after ${timeoutSeconds} seconds`;
      res.version = (await exec(exe.path, ["--version"], { cwd: root, timeoutMs: 20_000, env: envFor() })).out.trim().replace(/^mypy\s*/, "") || null;
      const errors = [];
      let last = null;
      for (const l of r.out.split("\n")) {
        const m = l.match(/^(.+?):(\d+)(?::(\d+))?: (error|warning|note): (.*?)(?:\s+\[([\w-]+)\])?$/);
        if (!m) continue;
        if (m[4] === "note") {
          if (last) (last.notes ??= []).push(clip(m[5], 200));
          continue;
        }
        last = { file: m[1], line: +m[2], column: m[3] ? +m[3] : null, severity: m[4], code: m[6] ?? null, message: m[5] };
        errors.push(last);
      }
      res.summary = r.out.split("\n").reverse().find((l) => /^(Found \d+ error|Success:)/.test(l)) ?? null;
      const found = res.summary?.match(/Found (\d+) errors? in (\d+) files?/);
      res.counts = { errors: found ? +found[1] : errors.filter((e) => e.severity === "error").length, files: found ? +found[2] : new Set(errors.map((e) => e.file)).size };
      res.byCode = Object.fromEntries(Object.entries(errors.reduce((a, x) => ((a[x.code ?? "none"] = (a[x.code ?? "none"] ?? 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).slice(0, 20));
      const max = o.max ?? 15;
      res.errors = errors.slice(0, max);
      if (errors.length > max) res.more = `${errors.length - max} more not shown; narrow with path`;
      if (!errors.length && r.code > 1) res.error = clip((r.err || r.out).trim(), 1500);
      return res;
    },

    /**
     * pyright in the project's virtualenv, summarised. o: path, max (diagnostics listed, default 15).
     * {tool, version, command, code, counts:{errors, warnings, files}, byRule, diagnostics:[{file, line, severity, rule, message}]}.
     */
    async pyright(o = {}) {
      const exe = tool("pyright", { venvOnly: true });
      if (!exe) return { tool: "pyright", skipped: "pyright is not installed in the project's virtualenv" };
      const { root } = findRoot();
      const targets = [].concat(o.path ?? []).map(String);
      const started = Date.now();
      const r = await exec(exe.path, ["--outputjson", ...targets], { cwd: root, timeoutMs: timeoutSeconds * 1000, env: envFor() });
      push({ kind: "python", detail: `pyright ${targets.join(" ")}`.slice(0, 200), ms: Date.now() - started, code: r.code, size: r.out.length });
      const res = { tool: "pyright", command: `pyright ${targets.join(" ")}`.trim(), code: r.code, seconds: Math.round((Date.now() - started) / 100) / 10 };
      if (r.timedOut) res.timedOut = `stopped after ${timeoutSeconds} seconds`;
      let j = null;
      try {
        j = JSON.parse(r.out.slice(r.out.indexOf("{")));
      } catch {}
      if (!j) {
        res.error = clip((r.err || r.out).trim(), 1500);
        return res;
      }
      res.version = j.version ?? null;
      const d = j.generalDiagnostics ?? [];
      res.counts = { errors: j.summary?.errorCount ?? 0, warnings: j.summary?.warningCount ?? 0, files: j.summary?.filesAnalyzed ?? null };
      res.byRule = Object.fromEntries(Object.entries(d.reduce((a, x) => ((a[x.rule ?? "none"] = (a[x.rule ?? "none"] ?? 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).slice(0, 20));
      const max = o.max ?? 15;
      res.diagnostics = d.slice(0, max).map((x) => ({ file: path.relative(root, x.file), line: (x.range?.start?.line ?? 0) + 1, severity: x.severity, rule: x.rule ?? null, message: clip(x.message, 300) }));
      if (d.length > max) res.more = `${d.length - max} more not shown; narrow with path`;
      return res;
    },

    /**
     * Replace one exact piece of text in one of the project's config files (pyproject.toml, ruff.toml, .ruff.toml, mypy.ini, .mypy.ini, pytest.ini, setup.cfg, tox.ini,
     * pyrightconfig.json, .python-version). `find` must occur exactly once. Needs act. {file, replaced: true}.
     */
    edit(file, find, replace) {
      if (!act) notInThisAsk(`py.edit(${file})`);
      const { root } = findRoot();
      const p = path.resolve(root, file);
      const allowed = ["pyproject.toml", "ruff.toml", ".ruff.toml", "mypy.ini", ".mypy.ini", "pytest.ini", "setup.cfg", "tox.ini", "pyrightconfig.json", ".python-version"];
      if (path.dirname(p) !== root || !allowed.includes(path.basename(p))) deny(`py.edit changes ${allowed.join(", ")} in the project folder only (use uv add, remove or lock for dependencies and uv.lock)`);
      const src = fs.readFileSync(p, "utf8");
      const n = src.split(find).length - 1;
      if (!find || n !== 1) throw new Error(`${path.basename(p)}: the text to replace occurs ${n} times, it must occur exactly once`);
      fs.writeFileSync(p, src.replace(find, () => replace));
      tomlCache.clear();
      return { file: p, replaced: true };
    },
  };
  return api;
}
