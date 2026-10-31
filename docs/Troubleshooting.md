# Troubleshooting

Start with the matching symptom below. Preserve your writing and existing files while checking; do not delete a note just to remove a view or connection.

## I cannot find a paper or note

On Home, check **Project**, **Document type** and **Source collection**. In search, choose **Find a paper** or **Find notes**, then **Clear filters** if needed. Clear the keywords separately; that button keeps them. Use **Match → Any words** for note titles, or **Author/Paper title** for source metadata. Try the note's own filename or **Recently edited** sorting.

An item removed from a review sheet remains searchable. The removal notice's **Open note** returns directly to it. See [[Help/Search and review|Search and recall]].

## I do not see Resolve question

Use **More → Write question**, and type in **Questions to check** or an existing **Open questions** section. The control is hidden when that section is empty. Move the editing caret outside the managed block, or use **⌘E** to read the note. Confirm that you opened the annotation/result, rather than its source PDF or paper note.

If text is present but the control is still missing, reopen the note and check that the Research Library helper is enabled. Older working-vault builds may not yet contain features being tested locally. See [[Help/Questions|Questions]].

## A question is missing from a review sheet or connection picker

A review sheet is curated: choose the note through **Choose items → Save selection**, and check the project's membership. Resolved questions leave the open-question part of the sheet.

For a connection, open a saved result → **More → Connect results**. **Uses** offers accepted saved results. **Related questions** offers annotation question sections with text, including resolved ones. A question inside a saved result is not a separate annotation entry. Clear the popup search if it is too restrictive. See [[Help/Result connections|Connections]].

## The note disappeared after I removed an item

**Remove from review sheet**, unpinning and unchecking a connection keep the original notes. Use **Find notes**, or follow the removal notice's **Open note** link. If you used **Delete annotation**, use **Undo** or the command palette's **Undo annotation deletion** to recover the linked pair when available.

## The PDF link or highlight does not open correctly

Check that the saved PDF is present locally, and use **Home → More → Files and sync** for missing attachments. On a Drive vault, confirm the folder is **Available offline**. A physical PDF page number can differ from the printed page number.

If the page is reloading, let it finish and retry **Open original passage**. A missing/deleted mark can leave a page link, and a changed PDF version can pause linked operations. Preserve the version you read rather than replacing it in place with another edition. For recovery, see [[Help/Backups and synchronization|Backups]].

## The name or BibTeX is wrong or incomplete

Use the paper's **More → Update bibliography**. Compare its title and authors with the PDF and an exact public source, review the version, and inspect additional citation fields. Confirm and save, then re-export the relevant citation list. Unknown fields and an unavailable DOI do not justify invented metadata. See [[Help/Citations|Citations]].

## Export, save, or recovery is refused

For citations, check the list name, selections and **Selected** tab for unavailable items. A separately edited .bib file is protected from overwrite; preserve it and use a new citation list for another export.

If a popup reports a concurrent change, cancel and reopen it to preserve current data. Duplicate identities or mismatched PDF versions need review. Do not remove internal IDs or delete research to bypass the message. Undo may require the original PDF/version and an intact recovery snapshot; restore/check a backup separately if necessary.

## I see code instead of controls, or math does not render

Use reading mode or Live Preview, and move the caret outside the code block. Check that this vault's Research Library helper and required PDF/math plugins are enabled; do not delete managed research-library blocks. Use [[Help/Design and navigation|Editing and navigation]] for LaTeX syntax and shared commands.

If only a new command is missing, save [[Help/Math commands|Math commands]] and reload Obsidian. Keep its filename and location unchanged.

## AI is unavailable, or another Mac looks out of date

Check [[Help/AI connection and release checks|AI connection and usage]] for this vault/Mac. Cloud generation is intentionally disabled for local-only drafts. Plan permission, remaining allowance, networking and source-image availability can also prevent generation. Manual transcription still works.

For another Mac, close the first vault and wait for Drive **Up to date** before opening the second. Check Drive Desktop rather than relying on Files and sync. This local test vault does not update the working Drive vault. See [[Help/Backups and synchronization|Backups and synchronization]].

## If you still need help

Record the note type, the button/menu path you used, what you expected, and the exact message or behavior you saw. Keep the original files and current writing while the issue is checked. A precise example is more useful than resetting the vault or removing internal identifiers.

[[Help/Start here|Help]] · [[Home|Library]]
