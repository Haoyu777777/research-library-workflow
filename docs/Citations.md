# Citations and bibliography

Build a bibliography for the sources you actually cite. A citation list is separate from your library, project memberships and review sheets.

## Copy one source

On a paper note, use **More → Copy BibTeX** to copy its saved entry, or **Copy citation** for its LaTeX citation command. On a result, **More → Copy citation** uses the source paper's citation key.

If the entry has too little information or the wrong author, correct the paper through **More → Update bibliography** before copying again. Review the paper/version match and additional citation fields; see [[Help/Library setup#Correct metadata or incomplete BibTeX|metadata correction]]. Unknown fields remain absent rather than invented.

## Make a selected bibliography

1. Choose **Home → More → Export citations**. You can start from **More → Add to citation list** on a paper/result too.
2. Select an existing **Citation list**, or start a new one, and give it a useful **List name** for the manuscript.
3. Use the **Papers**, **Saved results**, and **Selected** tabs, search, and project filter to choose the items you cite.
4. Choose **Save list** to keep the selection, or **Export .bib** to save and export it.

Results contribute their source paper's entry. Selecting several results from the same paper includes that source once. The count distinguishes selected items from unique source papers. The picker uses reading-source records; private draft sources are excluded from this standard export flow.

**Save list** stores an editable note under **Citation lists**. **Export .bib** writes under **Exports** and opens a bibliography view inside Obsidian, so a separate application is not needed. Copy the exported file's contents or use the file with your LaTeX manuscript.

## Update an export

Open the citation-list note → **Edit selection** → change choices → **Save list**. Choose **Export .bib** to refresh the file. Updating paper metadata alone does not automatically regenerate an existing export.

Use **More → Copy bibliography** on the list to copy its current entries, or **Open exported file** after exporting. Edit selection and source metadata in their own notes. If the exported file was edited separately, the library refuses to overwrite it; preserve that file and use a new citation list for another export.

Leave **Options → Include older citation keys** off unless an existing manuscript uses keys retained from an earlier import. Updating bibliography preserves the current citation key; routine renaming does not require new manuscript keys.

If export is disabled, check that the list has a name, at least one selection, and no unavailable items in **Selected**. See [[Help/Troubleshooting|Troubleshooting]].

[[Help/Start here|Help]] · [[Home|Library]]
