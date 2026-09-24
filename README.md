# Fun Tracks / Ignition decompilation progress

Public progress tracker for the **Fun Tracks / Ignition** decompilation project.

**Live treemap:** https://karlos-fr.github.io/fun-tracks-decomp-progress/

This repository intentionally publishes only progress metadata and the interactive visualization. The private decompilation source repository is **not** mirrored here.

The map supports two levels:

- **Probable units** — reviewed probable original C compilation units, with drill-down to functions.
- **All functions** — every tracked function independently, including functions not yet assigned to an original compilation unit.

Rectangle area is proportional to function size. Colors represent reconstruction progress.


## Deployment

GitHub Pages is published automatically from the `main/docs` branch source whenever the public repository receives a push.

The progress JSON is generated from the private project using a strict public allow-list. Only public progress metadata is copied to `docs/data/progress.json`; private source paths, internal evidence, notes, and dependency data are not published.
