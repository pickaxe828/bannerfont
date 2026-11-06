# Share one version across tools and font variants

bannerfont's build tools and generated fonts share one project version so consumers can identify the source and tooling behind a published font without reconciling independent version sequences. Publish fonts through GitHub Releases on intentional `vX.Y.Z` tags; ordinary pushes to `main` continue producing temporary CI artifacts.

The maintainer chooses the next version and approves a release PR; automation synchronizes and checks version metadata. The first release is `v1.0.0`. Major versions mark changes to the meaning, encoding, or placement of existing banner text; minor versions add compatible capabilities or patterns; patch versions correct rendering or build problems while preserving that contract. These categories do not authorize encoding changes, which still require an explicit user request under AGENTS.md.

Publish only the `highres` visual-detail variant, using the current default Minecraft input `1.21.2` and recording that input in release notes. Release font filenames follow `bannerfont_<variant>_mc<Minecraft version>_v<project version>.ttf`; the first release asset will be `bannerfont_highres_mc1.21.2_v1.0.0.ttf`. Keeping the variant field permits future additions without changing the filename convention.
