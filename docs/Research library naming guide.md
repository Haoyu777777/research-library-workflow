# Paper and note names

The naming rule is **Authors - Year - Title - Version**. Confirm metadata during import so PDFs, paper notes and their related folders stay consistent.

## Papers and versions

A PDF and its paper note share a basename, for example:

- `Papers/Martin Kassabov - 2003 - Kazhdan Constants for SLn(Z) - arXiv v1.pdf`
- `References/Martin Kassabov - 2003 - Kazhdan Constants for SLn(Z) - arXiv v1.md`

Up to three saved authors are listed. Longer lists usually use the first two followed by et al; very long names may shorten further. Missing authors appear as **Unattributed** and missing years as **Undated**. These labels mean the information remains unknown, not that you should substitute a PDF creation date.

Punctuation and very long names are cleaned while retaining the version. Distinct files with the same proposed name get a numbered suffix. An exact PDF duplicate reuses the existing record. A saved title, citation key and version remain part of the metadata; ordinary renaming does not create a new mathematical version or change a manuscript's citation key.

## Annotations and results

Their paper/version folder uses the same paper name. Inside it, short filenames begin with a physical PDF page:

- `Annotations/<paper name>/p0003 - A useful definition.md`
- `Results/<paper name>/p0003 - Lemma - A reusable bound.md`

The result type is included when needed. Distinct notes with the same title gain numbered suffixes; long internal identifiers stay out of visible filenames. **All paper comments** and the paper's `_Comments.md` index browse annotations in page order.

Use **Edit title → Rename note** on an annotation to keep its displayed name, filename and source association together. A vague or isolated-symbol highlight can need your own descriptive title. Source-context suggestions remain suggestions; the captured source image and your writing are preserved.

## Correct a paper name

Open the paper note → **More → Update bibliography**. Correct title/authors/year/version, inspect **Proposed filenames**, and **Confirm update**. This uses reviewed metadata rather than asking you to rename each PDF, note and folder separately.

For a larger cleanup, use **Home → More → Preview naming changes**. Review old/new paths before applying; applying creates a local backup. A stable library should propose no further changes on the next preview. Avoid bulk manual Finder renaming of linked library files.

Keep the metadata evidence you review with each paper. Current importing instructions are in [[Help/Library setup|Adding papers and projects]].

[[Help/Start here|Help]] · [[Home|Library]]
