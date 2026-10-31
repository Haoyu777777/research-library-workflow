# Reading and annotations

Use an annotation for thoughts tied to a source passage. Use a [[Help/Result reuse|saved result]] for an editable mathematical statement you plan to reuse.

## Open a paper

1. Find it on [[Home|Library]] by title, author or filename.
2. Choose **Read PDF** to read it, its title to open the paper note, or **Comments** to browse its annotations.
3. In the paper note, keep general writing under **Notes**. **Annotations** lists passage notes; **Reference details** holds the collapsed bibliography separately.

Use the PDF reader's find command to search text anywhere in that PDF. Library search covers saved metadata, notes and captured passages; see [[Help/Search and review|Search and recall]].

## Highlight and write a comment

1. Select the passage in the PDF.
2. Right-click **Add research comment**, click the PDF toolbar's comment icon, or press **⌘⇧M**.
3. A standard Markdown annotation opens beside the PDF. Write under **My thoughts**; use **Questions to check** for questions and **Possible changes / proof ideas** for mathematical changes.

The note has a source image and link. The highlight/comment is also stored in the vault PDF. With no selected passage, the PDF toolbar's comment icon creates a page note.

Use **Write my thoughts** to focus the editor, or **More → Write question** for a question. Markdown and LaTeX work in your writing; see [[Help/Design and navigation|Editing and navigation]].

## Return to the source and browse comments

Click a linked highlight in the library's PDF reader to open its annotation. From the annotation, **Open original passage** returns to that mark or page. **Previous comment**, **Next comment**, and **All paper comments** browse the same paper/version in PDF page order.

Use **Edit title → Rename note** for a description you will recognize. This changes the note's displayed title and managed filename while keeping its source association. The p0003 prefix means physical PDF page 3, which can differ from the printed page number.

For existing highlights/comments in an imported PDF, choose **Home → More → Import PDF annotations**, select the PDF, and **Import annotations**.

## What is saved in the PDF

Your **My thoughts**, **Questions to check**, and **Possible changes / proof ideas** are mirrored to the linked PDF comment. Ordinary PDF readers can show the native highlight/comment. Obsidian renders the math; ordinary PDF popups display the LaTeX text.

**Your original comment**, when present, preserves the imported comment. Put new writing in the editable sections above. Edits made to PDF comment text in an external reader are not automatically merged back into an existing Markdown annotation. Use the library note as the main editor for your research writing.

## Delete or undo

To remove an annotation and its linked highlight, use **More → Delete annotation** and review the confirmation. Deleting a linked highlight also removes its associated note once the saved PDF change is detected.

To reverse a deletion, click **Undo** in the notice, use the command palette's **Undo annotation deletion**, or press **⌘Z** while the PDF pane is active. This restores the linked pair when its recovery snapshot and original source version are available. Ordinary text-edit Undo works inside the editor. Saved results and separate proof notes are retained.

Removing a review-sheet item or connection keeps the annotation and PDF mark. For a missing note or refused recovery, see [[Help/Troubleshooting|Troubleshooting]] and [[Help/Backups and synchronization|Backups]].

[[Help/Start here|Help]] · [[Home|Library]]
