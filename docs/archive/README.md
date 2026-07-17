# Documentation Archive

**Status:** AUTHORITATIVE ARCHIVE POLICY

This folder is for superseded, historical, or implementation-specific documents that remain useful for context but no longer govern future design.

## What belongs here

- completed phase plans after their enduring guidance has been merged into current docs
- obsolete architecture proposals
- earlier design bibles replaced by authoritative documents
- implementation reports tied to a specific release
- migration notes that are no longer active
- duplicate specifications retained for historical traceability

## What should not be archived

- the current executive vision
- the design constitution
- the active V2 master roadmap
- current gameplay, UX, technical, content, or Studio specifications
- active setup instructions required to run or deploy the project

## Retirement procedure

Before moving a document into the archive:

1. Read the full document.
2. Identify guidance that is still valid.
3. Merge valid guidance into the appropriate authoritative document.
4. Correct conflicts rather than preserving two competing instructions.
5. Add a retirement banner to the archived copy.
6. Update links and indexes.
7. Preserve historical implementation evidence and measurements.
8. Confirm no active automation or setup process depends on the old path.

## Retirement banner

Archived documents should begin with:

> **HISTORICAL:** This document is retained for context and does not override the current documentation library. See `docs/README.md` for authoritative guidance.

## Existing numbered documents

The existing numbered documents represent substantial project history. They should not be bulk-moved or deleted without review. Retire them incrementally as their enduring content is consolidated.

The completed retention and performance document is an implementation record and remains valuable evidence of root causes, fixes, tests, and release limitations. It may later move under an implementation-history subfolder after references are updated.

## Archive organization

As the archive grows, use:

- `archive/implementation-history/`
- `archive/superseded-design/`
- `archive/migrations/`
- `archive/release-plans/`

Do not use the archive as a dumping ground. Every archived item should have a clear successor or a clear reason for historical retention.