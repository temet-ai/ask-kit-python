export const meta = {
  purpose:
    "Which locked packages have no wheel for this Python and platform and would build from source (needing a compiler and the build dependencies), which have no sdist either, and which Python versions a package's wheels do cover. Reads uv.lock and predicts it; uv decides in the end. Takes another Python version with python, to ask what an upgrade would break.",
  params: { path: "another project folder, optional", python: "a Python version to test against instead of the virtualenv's, e.g. \"3.15\"", package: "one package to look at in detail, optional", all: "list every package that has a fitting wheel too, default false" },
  returns:
    "{target:{version, platform, machine, source}, lock, packages, fit, buildFromSource:[{name, version, why, covers:[pythons], platforms, advice}], noWheelNoSdist:[...], notNeeded:[...], other:[{name, source}]}",
  example: 'await scripts.run("wheels", { python: "3.15" })',
};

const pretty = (w) => {
  const m = String(w).match(/^.+?-.+?(?:-\d[^-]*)?-([^-]+)-([^-]+)-([^-]+)\.whl$/);
  if (!m) return null;
  const pys = m[1].split(".");
  const arch = (t) => t.match(/(x86_64|aarch64|arm64|ppc64le|s390x|i686|armv7l|universal2|amd64|win32|arm64)$/)?.[1] ?? "";
  const plats = m[3].split(".").map((t) => (t === "any" ? "any" : /^(manylinux|musllinux|linux)/.test(t) ? `${/^musllinux/.test(t) ? "musl linux" : "linux"} ${arch(t)}` : /^macosx/.test(t) ? `macos ${arch(t)}` : /^win/.test(t) ? `windows ${arch(t) || t}` : t));
  return { pys: pys.map((t) => (m[2] === "abi3" && /^cp\d+$/.test(t) ? t + "+abi3" : t)), plats };
};

export default async function ({ py }, { path, python, package: only, all = false } = {}) {
  const p = path ? py.at(path) : py;
  const lock = await p.lock();
  if (!lock) throw new Error("there is no uv.lock in or above the project folder");
  const target = await p.target({ python });
  const venv = await p.venv();
  const installed = venv.exists ? await p.installed() : [];
  const norm = (s) => String(s).toLowerCase().replace(/[-_.]+/g, "-");
  const names = new Set(installed.map((x) => norm(x.name)));
  const filter = venv.exists && lock.packages.some((x) => names.has(norm(x.name)));
  const out = { target: { version: target.version.join("."), implementation: target.implementation, platform: target.platform, machine: target.machine, source: target.source }, lock: lock.file, packages: lock.packages.length, fit: 0, buildFromSource: [], noWheelNoSdist: [], notNeeded: [], other: [] };
  for (const pk of lock.packages) {
    if (only && norm(only) !== norm(pk.name)) continue;
    if (pk.source !== "registry") {
      out.other.push({ name: pk.name, version: pk.version, source: pk.source });
      continue;
    }
    const ok = pk.wheels.some((w) => p.wheelFits(w, target));
    if (ok) {
      out.fit++;
      if (all || only) (out.fitting ??= []).push({ name: pk.name, version: pk.version, wheel: pk.wheels.find((w) => p.wheelFits(w, target)) });
      continue;
    }
    const info = pk.wheels.map(pretty).filter(Boolean);
    const covers = [...new Set(info.flatMap((i) => i.pys))].sort();
    const platforms = [...new Set(info.flatMap((i) => i.plats))].sort();
    const row = { name: pk.name, version: pk.version, wheels: pk.wheels.length, sdist: pk.sdist, covers, platforms };
    if (filter && !names.has(norm(pk.name))) {
      row.why = "no fitting wheel, but it is not installed in the virtualenv (a marker for another platform or Python excludes it, or its group is not synced)";
      out.notNeeded.push(row);
    } else if (pk.sdist) {
      row.why = pk.wheels.length ? `wheels exist only for ${covers.join(", ")} on ${platforms.join(", ")}, none for Python ${out.target.version} on ${target.platform}: uv builds it from the source archive` : "it publishes no wheels at all: uv builds it from the source archive";
      const cps = covers.map((c) => c.match(/^cp(\d)(\d+)/)).filter(Boolean).map((m) => `${m[1]}.${m[2]}`);
      row.advice = cps.length ? `a Python it has wheels for: ${[...new Set(cps)].join(", ")} (uv python pin <version>), or install the compiler and headers it needs, or wait for a release with wheels` : "install the compiler and headers it needs";
      out.buildFromSource.push(row);
    } else {
      row.why = `no wheel for Python ${out.target.version} on ${target.platform} and no source archive: it cannot be installed here`;
      out.noWheelNoSdist.push(row);
    }
  }
  if (!out.notNeeded.length) delete out.notNeeded;
  if (!out.other.length) delete out.other;
  else if (out.other.length > 20) out.other = [...out.other.slice(0, 20), { note: `${out.other.length - 20} more not shown` }];
  out.note = "A source build needs a compiler, headers and the package's build backend; it happens at uv sync and shows as 'Building <name>' there.";
  return out;
}
