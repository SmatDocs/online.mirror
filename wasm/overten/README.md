# Overten browser-engine experiments

This recipe builds an **experimental Writer-only headless reference**, not the
production Collabora revision. It retains JS UNO and the exact reference
patches so results can be compared with the three-application headless trial.

- Core: `7528c0d406012e10c6ce34c3f24bf277302ec695`.
- Wrapper/patch source: `eze-paz/libreoffice-wasm`, commit
  `ff4178cc8c5e599ffd05eed4d163bfb493a2bcd7`.
- Emsdk: 4.0.10, commit `62a853cd3b3134398ce85cde8bb5cbb2ef0194cb`.
- Difference: `--with-wasm-module=writer`; build parallelism is four.
- Vendored reference build files retain their upstream MIT license. Patch
  context padding is normalized for repository whitespace checks; provenance
  records both the original upstream patch hashes and the stored hashes.

Run `build-writer.sh` in a disposable Ubuntu 24.04 container, with a dedicated
writable `/work` directory and this directory mounted read-only at `/recipe`.
Cap the container at four CPUs and 12 GiB RAM, low CPU shares; publish no ports
and mount no credentials or application directories. Use an experiment host,
never Finland or a serving API process. This first core build can take hours.

The script installs container-only prerequisites, then builds as an unprivileged
user. Downloads/setup have finite attempts/timeouts. Build stages, logs, raw
and cooperative-packed outputs and `manifest.json` stay under `/work`. A second
make follows the upstream package instructions. Existing outputs are not
deleted to repair a failed build. Inspect failures before a manual resumption.

This recipe alone proves no speed, memory, JS-plan or document-fidelity result.
Test exported artifacts in the real browser fixture before product integration.
No push, merge, release publication or deployment is performed by these scripts.


## Independent component variants

The running first build applies only `reference-build/lo-source.patch` and the
four patches under `reference-build/patches/`. The manifest records applied
patches, optional unapplied patches and the actual source-diff hash. Merely
being present in this recipe directory does not mean a patch was built.

- `package-resources.py`: makes a separate resource overlay. The `ui-pruned`
  profile removes notebookbar/example resources without deleting fonts. Its
  measured compressed saving was about 0.7 MB, with exact five-image parity.
  `lazy-fonts` and `combined` are experiments; the tested 8 MiB decompressed
  font cache was rejected because it added about three seconds to startup.
- `prepare-writer-bindings.py` and `writer-bindings.patch`: prepare and build a
  focused JS UNO bridge. Pass `--seeds writer-protocol-types.json` for the
  current Word action protocol, plus UDK/bootstrap/dependency closure. On the
  pinned core this selects 495 of 4,297 IDL entities. The full RDBs remain
  secondary providers. Native binding generation and a reversible registration
  filter passed the current Word contract; a smaller WASM build is still pending.
  This is not a port of every Python UNO operation or a general UNO API promise.
- `portable-font-registration.patch`: exposes the existing portable `addfont`
  implementation to Emscripten for a later starter-font experiment. It has not
  been compiled/runtime-qualified. It deletes no fonts. Late font registration,
  layout fidelity and offline behavior must pass before adoption.
- `clear-render-buffer.patch`: zeroes the reference renderer's allocated pixel
  buffer before painting. This removed uninitialized unused-margin differences
  in comparisons. It changes the diagnostic reference renderer, not core code.

Preserve the complete Writer-only artifact before applying optional changes to
its source/build tree. Test each independent artifact; do not apply all cuts at
once and attribute their combined effect to one component.

Writer-only selection sets the upstream grouped Basic/Draw/Math/Impress strip
flag. Test real equations, images, charts and tables before accepting this
profile. Keep the complete three-application reference available. No resource,
binding or application cut here is a production default.
