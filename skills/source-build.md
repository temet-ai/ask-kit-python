A package builds from source, or an install fails with no wheel

1. `await scripts.run("wheels")` lists `buildFromSource` (an sdist exists, no wheel fits this
   Python and platform) and `noWheelNoSdist` (nothing can be installed here). Each row says which
   Pythons and platforms its wheels cover and what the package would need.
2. The cause is the interpreter, the platform or the release: wheels are built per Python minor
   version (`cp312`) and per platform. A new Python release often has no wheels for compiled
   packages for a while.
3. Options, in this order:
   - a Python the package has wheels for: `await scripts.run("wheels", { python: "3.12" })` shows
     what would remain, then follow `skills.read("pin-python")`;
   - a newer release of the package that has wheels for this Python: `uv lock --upgrade-package
     <name>` (needs act and the request's agreement; it changes `uv.lock`);
   - build it: the compiler (`gcc`, `clang`), `python3-dev` headers and the package's own system
     libraries must be installed. The first line of the build error names the missing one.
4. A build that already failed: take the first error line of the output, not the last. It names the
   missing header, library or tool.
5. The answer: the package and version, why no wheel fits (the covered Pythons against the project's
   Python), and the option that fits the request, with its command.
