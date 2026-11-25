# Development and validation

[README](../README.md) · [Architecture](architecture.md) · [API](api.md) · [Troubleshooting](troubleshooting.md)

Use the [README setup and startup sequence](../README.md#installation) first.
All commands below run from the project root. Scripts are defined in
[package.json](../package.json); JavaScript dependencies use the lockfile and Python
dependencies use [requirements-slither.txt](../requirements-slither.txt).

## Test commands

Keep Hardhat running and deploy the registry before blockchain/browser tests.
Stop normal API/UI development servers before browser tests: Playwright starts isolated
servers on 3001/5173, with temporary report storage and AI credentials disabled.
Install the browser using the [README check instructions](../README.md#checks-and-build).

| Command | Coverage |
| --- | --- |
| `npm test` | Backend unit/service/API tests, including scanner and mocked AI cases |
| `npm run compile:registry` | Compile the Solidity registry |
| `npm run test:blockchain` | Contract and backend blockchain integration tests; requires compiled artifact and live chain |
| `npm run test:all` | Compile registry, run backend tests, then blockchain tests |
| `npm run test:frontend` | Playwright browser tests; requires live chain and deployment |
| `npm run build` | Production frontend bundle; does not start a hosting server |
| `npm run validate:local` | Doctor, `test:all`, browser tests and build, sequentially |

Do not run blockchain and browser suites concurrently: integration tests change mining
state on the shared local node. Browser tests exercise scans, downloads, registration,
original/modified verification, error states and mobile layouts. They regenerate
[desktop](screenshots/desktop.png) and [mobile](screenshots/mobile.png) screenshots.
AI presentation is mocked; these checks do not establish live Groq availability.

To use installed Chrome instead of Playwright's downloaded browser:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/google/chrome/chrome npm run test:frontend
```

That path is an example and must exist on your machine. The same environment variable
can prefix `npm run validate:local`. Browser configuration is in
[playwright.config.js](../frontend/playwright.config.js).

## Supplementary checks

These are not included in `validate:local`:

```bash
npm audit
npm audit --omit=dev
.venv/bin/python -m pip check
npm run scan -- fixtures/vulnerable.sol
npm run scan -- fixtures/minimal.sol
npm run demo:blockchain
```

The standalone demo creates a report and registration on the current local chain, checks
the original, and rejects a changed payload. It is not a read-only check.

| Fixture | Expected pinned-scanner result |
| --- | --- |
| [vulnerable.sol](../fixtures/vulnerable.sol) | `reentrancy-eth` (High), `low-level-calls` (Informational) |
| [minimal.sol](../fixtures/minimal.sol) | Successful scan with zero findings |

Record actual results when executing checks; test counts and registry advisories can
change. Runtime-only audit excludes development packages used by Vite/Hardhat.
The root manifest contains targeted `serialize-javascript` and `tmp` overrides;
review compatible updates individually rather than using forced broad upgrades.

## Safe sharing

For a manually prepared ZIP/TAR, inspect the contents before sharing. Exclude private
`.env` files (retain the blank `backend/.env.example`), credentials/directories such as
`.aws` and `.ssh`, `.venv` and backups, `node_modules`, `.tools`, report data, generated
artifacts/cache/deployments, build output, logs, traces and test results.
Check screenshots for private content. The recipient rebuilds tools and deploys locally.
Credential revocation requirements are in the [README security notes](../README.md#scope-and-security).

An optional existing utility is available if you choose to use it:

```bash
npm run package:source
```

It requires `tar` and writes `dist/SolidityGuard-AI-source.tar.gz`. It refuses to overwrite
an existing destination; choose another with
`npm run package:source -- /tmp/submission-v2.tar.gz`.
[package-source.js](../scripts/package-source.js) uses a source allowlist, rejects symlinks,
and checks text for known credential patterns and copies of configured local key values.
These checks reduce accidental exposure but do not replace inspecting the archive.

To check installation reproducibility, extract a clean source copy into a new directory,
run setup, then follow the normal startup and validation instructions. Do not reuse copied
environments or deployment metadata. This is a procedure, not a claim that a fresh install
or dependency audit has been executed for every documentation update.
