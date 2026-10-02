# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0/).

## [0.5.0] - 2026-10-02

### Added

- Optional cleanup for failed provisioning
- Provision related records before User saves with context lookups

## [0.4.1] - 2026-09-30

### Fixed

- Provision plan/apply JSON results preserve source context, null match fields, and default error messages from the single-call workflow.
- Provision apply summaries include planned license shortfalls, and provisioning options accept an internal `personasSupplied` override.

## [0.4.0] - 2026-09-27

### Added

- Default English renderer messages, CLI-equivalent provision and access human output, and snapshot-to-lifecycle output adapter.

### Changed

- User and users-file UI hints share one exclusive choice; diff persona-file hints depend on the users file.

## [0.2.0] - 2026-09-26

### Added

- Warden domain logic extracted as a reusable core library for use across Warden CLI and VS Code extension, and a potential future SFDX package
- Zod file-format schemas and generated JSON Schema artifacts for validation and type-safety

## [0.1.0] - 2026-09-26

### Changed

- Internal maintenance and tooling updates
