# Changelog automation

Status: complete

1. Generate CHANGELOG.md from stable tags using GitHub-generated PR notes and the complete Git commit history between tags; create missing historical GitHub releases from the same sections.
2. Add a stable-tag workflow job that generates the changelog, creates a release, and commits the result to main without overwriting concurrent changes. Document operation and permissions.
3. Verify generated tag coverage, release notes, workflow behavior and existing tests; publish changes and historical releases.

A missing tag, PR, or direct commit in its release section, a failed regeneration, or a workflow that cannot push the changelog would disprove correctness.
