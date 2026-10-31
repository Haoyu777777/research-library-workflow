# Dependencies and provenance

The distributed JavaScript is built from the original Research Library source modules developed for Haoyu's research workflow, with AI assistance. It does not contain a copied vault, third-party plugin binary, personal credential registration or a downloaded PDF engine.

Runtime dependencies supplied by the user's installation:

- **Obsidian** and its plugin API, PDF viewer, editor and MathJax renderer. Obsidian is a separate application; its proprietary application code is not bundled in this release. API reference: https://docs.obsidian.md/
- **PDF++**, Ryota Ushio, MIT: https://github.com/RyotaUshio/obsidian-pdf-plus . Its native annotation I/O and the PDF library exposed through that interface are used at runtime. PDF++ is installed separately by the user; neither its source nor compiled binary is redistributed in our ZIP. Honor its own upstream notices.
- BibLib is not required or called by this distribution. The personal-vault legacy export fallback has been removed; imported records export citations directly.

Related-work links are acknowledgements of overlapping features, not claims that their code is incorporated or that their authors endorse this project. Their licenses do not change to MIT because our project uses MIT. In particular, publicly visible source is not automatically permission to incorporate it.

Before public submission, recheck this dependency inventory against the final build and preserve any notices required by material actually incorporated. The alpha release excludes cloud AI clients and account/credential modules from both the source bundle and compiled module graph.
