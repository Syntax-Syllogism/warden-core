# warden-core

Shared Warden engine: the user-lifecycle library behind the
[`warden`](https://github.com/Syntax-Syllogism/warden) Salesforce CLI plugin,
the Warden VS Code extension, and the Warden SFDX package.

warden-core is a plain Node/TypeScript library with no CLI framework
dependency. Call its functions directly from a script, an editor extension, a
CI job, or any other Node codebase.

## Install

```bash
npm install @syntax-syllogism/warden-core
```

Requires Node.js 22 or later.

## API

| Export | Purpose |
| --- | --- |
| `WardenError` | Base class for every error warden-core throws on purpose. Carries a stable `code`, optional structured `data`, and a default English `message`. |
| `isWardenError(error)` | Structural type guard for `WardenError`; safe across duplicate copies of this package. |

```ts
import { isWardenError } from '@syntax-syllogism/warden-core';

try {
  // call a warden-core function
} catch (error) {
  if (isWardenError(error)) {
    console.error(`${error.code}: ${error.message}`);
  } else {
    throw error;
  }
}
```

## Errors

Errors are reported as `WardenError` instances (or area-specific subclasses).
The `code` and the shape of `data` are part of the public API; the `message`
text is not and may be reworded in any release.

| Code | Thrown by |
| --- | --- |
| _none yet_ | |

## Versioning

warden-core follows [Semantic Versioning](https://semver.org/). Removing or
renaming an export, changing a signature or result shape, changing an error
`code`, or rejecting input that was previously valid is a major change.
Consumers should pin an exact version and upgrade deliberately.

## Development

```bash
npm install
npm run build
npm test          # typecheck, lint, prettier, mocha + coverage
npm run pack:check
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Security

See [SECURITY.md](SECURITY.md) for how to report vulnerabilities.

## License

[MIT](LICENSE) © Jake Richter
