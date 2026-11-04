# Temporary analysis source selection

The issue workspace can select one explicitly chosen Markdown or UTF-8 text file at a time from the currently bound local project. Selection creates a read-only in-memory copy and SHA-256 digest. The list contains metadata; source text is returned only when the same authorized connection requests a bounded preview. This feature does not send content to a model, analyze it, persist a source snapshot, or modify the selected file.

The bridge rejects paths outside the project, symbolic links/junctions, hard-linked files, non-local drives, invalid UTF-8, binary content, files over 1 MiB, and common secret/configuration or generated directories and filenames. Name-based exclusions cannot detect all sensitive content; the user must review the selection. Limits are 16 files and 4 MiB per connection, with a 32 MiB bridge-wide accounting limit. Preview chunks are limited to 8,192 UTF-16 units and preserve surrogate pairs.

Copies are scoped to the selected project generation and an explicitly confirmed viewing grant, and cleared on disconnect, grant expiry or release, or project reselection. A changed file is not automatically refreshed; remove and reselect it to obtain another snapshot. Selecting the same path with a different digest is rejected until the old snapshot is removed. Hashes identify captured bytes, not the current state of a file.

The bridge checks canonical paths, file identity, size and metadata, and compares two reads. Filesystem paths can still race against a malicious process running as the same OS user; these checks do not provide an OS-level sandbox against that actor. No schema migration, deployment, or irreversible data operation is needed.

## Analysis input preparation

An authorized connection can prepare an ephemeral input snapshot for all of its selected source copies and an optional request of at most 1,024 UTF-16 units. The browser supplies only the expected project revision and source IDs/digests; the bridge compares these against its own session and current project state. Every source must have been selected at that project revision. If the project revision or selection has changed, the user must refresh and reselect as needed.

The bridge divides each nonempty copy into contiguous segments of at most 8,192 UTF-16 units, without splitting surrogate pairs. Segment IDs are deterministic for the session source ID, source digest and offsets. The returned summary exposes the source metadata and segment counts, but neither source content nor the additional request. All segments are initially unprocessed; empty sources have no segments. No requirement extraction, candidate creation, model call, or transmission occurs at this step.

The snapshot and request remain only in memory, scoped to the same view grant as the source copies. Adding or removing a source invalidates the snapshot, as do disconnect, expiry, view release, or project reselection. Editing the request in the browser hides the displayed summary; a new preparation replaces the server copy. Any future analysis dispatch must recheck the snapshot ID, active view, selected sources, project revision, and current file hashes, and must explicitly ask the user to start the external model operation. Preparation by itself gives no execution or network permission.

## Checking selected originals

The authorized connection may explicitly request a freshness check for a prepared snapshot. The bridge derives each path from the server-owned selection, reopens and validates each local file with the same path and content restrictions used during selection, and compares its size and SHA-256 digest. The response contains one of `unchanged`, `changed`, or `unavailable` for each selected source; it does not return file contents or operating-system error details. Grant, snapshot and project identity/revision are checked again after asynchronous reads. A source change or unreadable source is not considered analysis success. This is a point-in-time observation: an original can change again immediately afterward, so future analysis dispatch must recheck independently.
