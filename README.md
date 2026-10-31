# Research Library Workflow

A free, MIT-licensed research workflow for Obsidian by [Haoyu](https://github.com/Haoyu777777). Keep PDF passages, Markdown thoughts, reusable mathematical results, questions and project review sheets connected.

**0.1.1 is a macOS alpha for a new dedicated vault.** It is not yet published in the Community directory. Windows, Linux, mobile and migration of existing research collections are not supported by this alpha.

## Install the alpha

1. Use macOS and Obsidian 1.12.7 or later. Create a **new empty vault**. If Obsidian adds a Welcome note, move it elsewhere first. Do not use your only copy of an existing research collection.
2. Install and enable **PDF++** from Obsidian Settings → Community plugins. The tested version is **0.40.31**. Research Library detects its required annotation interface. It never installs or updates dependencies itself.
3. Extract the alpha ZIP. Copy the `research-library-workflow` folder containing `main.js`, `manifest.json` and `styles.css` into your vault's `.obsidian/plugins/` folder. If you use a custom configuration directory, use that directory's `plugins/` folder.
4. Reload Obsidian and enable **Research Library Workflow** under Community plugins.
5. Read the welcome, check **Set up this empty vault**, and choose **Create my research library**. Home, Help, the Research project and templates are created automatically. No example papers are inserted.

If PDF++ is missing, enable it manually, then use **Check again**. If the vault already has notes, setup stops without migrating them. Local backups are optional and off by default.

## First reading session

1. On Home, choose **Add a paper**, select a public PDF and confirm its title/author/year/version before saving.
2. Read the PDF, select a passage and choose **Add research comment** (or Cmd–Shift–M).
3. Write your thoughts and questions in the linked Markdown note. **Open original passage** returns to the source. Standard PDF annotation writes depend on PDF++'s native editing support/settings; Research Library enables deletion confirmations when the integration starts.
4. Save a useful definition or theorem as a result. Choose a direct use or an adaptation; keep your proposed changes and proof work separate from the source statement.
5. Resolve or reopen questions, connect related work, and select key items for a project's review sheet.
6. Export citations for a chosen subset of public sources. Home → Help explains these workflows and deletion/Undo.

Standard LaTeX works through Obsidian. A separate custom-macro extension/preamble is not bundled. Manual transcription is available; cloud AI and account connections are excluded from this alpha. No AI subscription is needed for the core workflow.

## Privacy, files and network access

- Core notes, PDF annotations, search, results and review are local to the vault. There is no analytics or telemetry in this plugin.
- Explicit paper lookup/download can contact arXiv, Crossref, DOI resolvers and publisher/source URLs through the import/metadata functions. Review metadata before saving. Do not use external lookups for private drafts; draft import takes the local-only route.
- PDF annotations modify the PDF. Keep backups and use deletion confirmation/Undo. Managed state is stored in this plugin's `data.json`; it is user data, never a release asset.
- Optional macOS backups write full-vault ZIPs and hash manifests outside the vault in `~/Documents/Research Library Backups`. They can run daily while opted in. These archives may contain private research and settings; keep them private.
- The plugin does not provide synchronization or web hosting. Use your chosen sync service separately and finish syncing before switching devices. Simultaneous edits to shared PDFs are not supported.
- Disabling or uninstalling the plugin keeps your papers and Markdown notes. Dynamic dashboards and plugin-specific controls require the plugin. No uninstall routine deletes research, backup archives or other plugins.

## Development

Node.js 20 or later is sufficient; the build has no downloaded build dependencies:

```sh
node scripts/sync-guides.cjs
node scripts/build.cjs
node --test tests/*.test.cjs
```

`dist/` contains the three standard install assets. Do not commit vaults, `.obsidian`, `data.json`, research, credentials, backups, local test artifacts or private absolute paths. This source project is separate from the author's working library and browser showcase.

## Credits and related work

Research Library integrates [PDF++ by Ryota Ushio](https://github.com/RyotaUshio/obsidian-pdf-plus), distributed separately under MIT. It uses PDF++'s annotation I/O interface and Obsidian's PDF viewer/editor; it does not claim to implement those engines. Upstream interface changes may require compatibility updates. Imported records export citations directly without BibLib. Dependency provenance and credits are maintained in THIRD_PARTY_NOTICES.md.

Related projects include [PaperFlow](https://github.com/quan-meng/paperflow), [Paper Manager](https://github.com/yuhang-dong/obsidian-paper-manager) and [LaTeX-like Theorem & Equation Referencer](https://github.com/RyotaUshio/obsidian-latex-theorem-equation-referencer). Our focus is a source-version-aware mathematical result, question and project-review workflow. Individual import/annotation features are established ideas; no exclusive novelty is claimed. No source from these related projects is included merely by listing them.

## Support and release status

This is a local alpha candidate. Report the Obsidian/PDF++ versions and reproducible steps to the author; do not include private PDFs, notes or credentials. A public repository/issue tracker will be linked when the reviewed release is published. MIT applies to this project's original code; separate dependencies keep their own terms. No warranty or permanent maintenance promise is made.
