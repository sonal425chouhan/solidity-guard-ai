# SolidityGuard AI

A local Solidity review tool: scan a contract with Slither, optionally explain findings
with Groq, download an immutable JSON report, and register or verify its SHA-256 hash
on a local Hardhat blockchain. Scanner findings are potential issues requiring review;
no findings detected does not establish security. Blockchain verification checks report
integrity, not contract safety or authorship.

## Requirements and installation

Supported: Linux x86_64 or WSL2 x86_64, Node.js 24, npm 11, Python 3.12,
bash, curl, and sha256sum. Native Windows and macOS setup are not supported by the
current Linux compiler installer and subprocess handling.

Pinned application tools: React 19.3.1, Vite 8.3.8, Express 5.3.0,
Ethers 6.17.0, Hardhat 2.29.2, Slither 0.11.6, Solidity 0.8.28.
Use the lockfile for npm dependencies and `requirements-slither.txt` for Python.

From the extracted **source package** directory, run:

```bash
npm run setup:local
```

This checks Node 24 and Python 3.12, recreates the local virtual environment,
installs locked npm/Python dependencies, verifies/downloads the compiler, and runs
scanner preflight. Install Python 3.12 with venv support first if it is not available;
Python 3.8 is unsupported. Set `PYTHON_BIN=/path/to/python3.12` if necessary.
The script preserves an existing `.venv` under `.venv.backup-...`; remove that backup
only after successful setup. Existing private `.env` files are not overwritten.

**Never copy `.venv`, `node_modules`, `.tools`, or deployment state between machines.**
Virtual environments contain absolute interpreter paths and must be recreated after
moving a project. Installation requires internet; scanning and blockchain operations
then work locally. Python is an external Slither dependency, not an application backend.

Run `npm run doctor -- --scanner-only` to check tooling without a blockchain.
Restart the backend after replacing an already validated toolchain.

## Start locally — three terminals

Run every terminal from the extracted project directory.

Terminal 1 — keep the local blockchain running:

```bash
npm run chain
```

Terminal 2 — deploy once for the current chain session, then start the API:

```bash
npm run deploy:local
npm run doctor
npm run dev:backend
```

Terminal 3 — start the UI:

```bash
npm run dev:frontend
```

Open **http://127.0.0.1:5173**. Vite proxies `/api` to the backend on port 3001.
Hardhat uses port 8545 and chain ID 31337. No MetaMask or wallet extension is needed.
Resetting/restarting Hardhat can erase registrations: redeploy and register reports again.
Scanning and report download remain usable if the blockchain is unavailable.

## Backend configuration

Keep real credentials only in `backend/.env`, never `.env.example`, browser code,
or `VITE_*` variables. The example file contains placeholders, not credentials.

```dotenv
PORT=3001
BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545
BLOCKCHAIN_SIGNER_INDEX=0
GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-20b
AI_TIMEOUT_MS=15000
```

Add your Groq key to enable optional AI. Restart the backend after editing `.env`,
then run a new scan with **Include AI explanations** selected. Existing reports stay
immutable. The model prefix `openai/` identifies a model served by Groq; it does not
use an OpenAI key. Old `OPENAI_API_KEY` settings are ignored.

The backend uses one fixed Groq Chat Completions endpoint and no additional SDK.
The model must support [strict structured outputs](https://console.groq.com/docs/structured-outputs).
Timeouts are configurable between 1 and 30,000 milliseconds. API availability,
rate limits, account limits, and model accuracy remain provider-dependent.

## Demo workflow

1. Paste source, upload a `.sol` file, or choose the vulnerable/minimal example.
2. Leave AI unchecked for local-only scanning, or opt in to external processing.
3. Scan; review severity counts and expand findings for original scanner evidence.
4. Download Report to save the complete JSON package.
5. Optionally Register on Blockchain; success requires transaction confirmation.
6. Verify Report to check the current saved report against actual registry state.
7. Expand Check a downloaded report and upload the JSON copy to verify it.
8. Modify a field inside that copy's `payload` and verify again: expect `mismatch`.

Changing wrapper metadata does not change the payload hash. Uploading a different
registered report also fails verification for the selected report.

Expected pinned-scanner examples:

| Source | Expected result |
| --- | --- |
| `fixtures/vulnerable.sol` | `reentrancy-eth` (High), `low-level-calls` (Informational) |
| `fixtures/minimal.sol` | Successful scan, zero findings |

Only one self-contained UTF-8 Solidity file is supported: maximum 100 KiB, compatible
with Solidity 0.8.28, without imports. Submitted contracts are never deployed for scanning.

## API

Responses use `{ "success": true, "data": ... }` or
`{ "success": false, "error": { "code": ..., "message": ... } }`.
POST requests require UTF-8 `application/json`.

| Endpoint | Request | Result |
| --- | --- | --- |
| `POST /api/reports` | `{ "filename": "Vault.sol", "source": "...", "includeAi": false }` | 201 with saved report package |
| `GET /api/reports/:id` | None | Report package, with cached receipt when available |
| `POST /api/reports/:id/register` | `{}` | Confirmed registration or unavailable |
| `POST /api/reports/:id/verify` | `{}` or `{ "reportPackage": <downloaded JSON> }` | Verified, mismatch, unregistered, or unavailable |

Blockchain unavailable responses use HTTP 503 with `success: false` and a `data`
object containing the unavailable status. This is not a hash mismatch. Invalid input
uses 4xx; compilation failures use 422; toolchain mismatches or failed version checks
use 503 with reinstall/restart instructions; a busy scanner/registrar uses 429. Scanner
failure never becomes a successful zero-findings report.

Registration loads and rehashes the saved report; callers cannot supply a registration
hash. Duplicate requests recover the existing confirmed registration. If confirmation
succeeds but local receipt storage fails, the response remains confirmed with a
`registrationWarning`; repair local storage and retry to recover the cached receipt.

## Report integrity and storage

`backend/data/reports/<uuid>.json` stores `{ payload, integrity }`. Payload contains
contract metadata, source hash, scan timestamp, original normalized findings, optional
AI explanations, summary, and limitations. It does not persist the complete uploaded source.
Scanner descriptions and AI examples can contain code excerpts.

`integrity` contains `algorithm: "SHA-256"`, `canonicalization: "sg-json-v1"`, and a
hex hash. Canonicalization sorts object keys recursively, preserves array order, and
hashes UTF-8 JSON. Non-JSON values are rejected. The hash excludes wrapper metadata.
AI explanations are assembled before hashing; old reports are never enriched in place.

Report publication uses a same-directory temporary file and atomic hard link, refusing
an overwrite. Receipt metadata is written atomically to a separate
`registrations/<uuid>.json`. Corrupt or unreadable receipt metadata does not invalidate an intact payload or block
live verification. A warning identifies cache problems; repair permissions or the
receipt path before retrying registration to restore the cache.
Report hashes are checked on read. These checks protect consistency; a local user with
full filesystem access can replace files, so the blockchain comparison remains important.

The registry accepts nonzero, unique `bytes32` hashes only from its authorized registrar.
Anyone can query hashes and registration details. Deployment configuration records the
address, chain, deployment transaction/block, and runtime code hash. Backend operations
check live deployment identity and actual contract state rather than trusting cached receipts.

## AI behavior and privacy

AI is disabled by default. Enabling it sends bounded finding details and source snippets
to Groq, as disclosed beside the checkbox. No full-source upload option exists.

One request covers at most eight findings. Snippets prioritize affected statements and
nearby checks; shared line references keep context associated with multiple findings.
At most six line references per finding and 256 characters per source line are selected.
Unique snippet text is capped at 2,048 characters or one quarter of the source length,
whichever is smaller. Statements that do not fit are omitted rather than truncated.
Descriptions are sanitized first lines capped at 384 characters. The entire request is
limited to 32 KiB, the response to 128 KiB, and completion output to 4,000 tokens.

Every finding explicitly has incomplete context. The prompt instructs the model to
check supplied error handling, avoid inferring absent checks, and avoid presenting
`transfer()`/`send()` as automatic security fixes. These instructions reduce mistakes;
they do not guarantee correct advice. External processing is subject to Groq's data policies.

Output validation checks finding IDs, required fields, duplicates, text lengths, and JSON
shape. It cannot prove the explanation or remediation is technically correct. Scanner
severity/confidence never change. Explanations remain separate from scanner evidence.

AI statuses: disabled, completed, partial, unavailable. Partial coverage displays the
number explained against all findings, independent of UI filters. `requestedFindings`
means total findings requested by the user, not the number sent within the eight-finding cap.
Timeouts and provider errors preserve the report and scanner results. Raw provider errors,
credentials, and request bodies are not logged or stored.

## Project structure

- `frontend/src/App.jsx`: SPA navigation and workflow state.
- `frontend/src/api.js`: HTTP calls and request deadlines.
- `frontend/src/components/`: input, results, individual findings, report actions.
- `frontend/src/styles.css`: shared styling and responsive screen layouts.
- `backend/src/routes.js`, `controllers.js`, `app.js`: routing, HTTP handling, validation boundary.
- `backend/src/services/`: scanner execution, report creation, Groq explanations, registry operations.
- `backend/src/storage.js`, `hashing.js`: atomic persistence and deterministic integrity checks.
- `backend/src/scanner-files.js`, `scanner-toolchain.js`: bounded result reads, cleanup, version validation.
- `blockchain/contracts/`, `scripts/`, `config.js`: registry, deployment, local RPC configuration.
- `backend/tests/`, `blockchain/test/`, `frontend/tests/`: focused unit/integration/browser checks.
- `fixtures/`: local examples; `scripts/`: installation, compilation, scanning and demo commands.

## Validation

Keep the local Hardhat node running and deploy the registry before integration/browser tests.

```bash
npm run test:all
npm run build
.venv/bin/python -m pip check
npm audit
npm audit --omit=dev
npm run scan -- fixtures/vulnerable.sol
npm run scan -- fixtures/minimal.sol
npm run demo:blockchain
```

Stop development API/UI servers before browser tests: tests start their own servers on
3001/5173 with temporary report storage and AI credentials disabled.

```bash
npx playwright install chromium
npm run test:frontend
```

Alternatively, use an installed Chrome executable:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/google/chrome/chrome npm run test:frontend
```

Run blockchain and browser suites sequentially because mining-state tests use the local
node. Browser tests cover real scans, downloads, registration, original/modified verification,
errors, mobile layouts, and mocked AI presentation. They regenerate screenshots in
`docs/screenshots/`. They do not make live AI requests.

Review-fix validation on 2026-11-19: a source-only archive was extracted into a new
path containing spaces on the same Linux host. Fresh `npm ci`, a recreated Python 3.12
virtual environment, pinned Python dependencies, and verified compiler installation
passed via `npm run setup:local`. From that copy, 52 backend/AI tests, 11 blockchain
tests, 13 browser tests, the production build, and immutable-aware live registry
preflight passed. Browser tests exercised scan/download/register/verify and rejection
of modified reports. This is a fresh-path installation test on the supported host,
not verification on every machine. No live paid AI request was made.

Revalidation on 2026-11-20 passed 53 backend/AI tests, 12 blockchain/integration
tests, 13 browser tests, the production build, and Python dependency consistency.
The live demo registered a new report, verified the original and rejected a modified
payload. No live AI provider request was made during this validation.

Dependency audit on 2026-11-20 reported 14 affected development-package entries
(11 low, 3 moderate, no high or critical), including transitive effects. Runtime-only
audit reported zero. No dependencies were changed during this submission review;
advisory results can change as registry data changes. `serialize-javascript` and
`tmp` remain pinned to their targeted fixes. Re-run both audits before delivery.
Development dependencies are still used by local Vite and Hardhat, so zero runtime
advisories does not mean the entire toolchain is unaffected.

## Preparing a submission

Create the distributable source archive using:

```bash
npm run package:source
```

Output: `dist/SolidityGuard-AI-source.tar.gz`. An existing archive is not overwritten;
choose another destination with `npm run package:source -- /tmp/submission-v2.tar.gz`.
The packager uses an explicit source allowlist, refuses symlinks, and checks text for
known key patterns, private-key markers, nonblank template credentials, and copies of
local configured key values. It never packages `.env`, virtual environments, dependencies,
reports, runtime deployment files, compiler downloads, caches, traces, or logs.
This reduces accidental leakage; review screenshots and archive contents too.

Extract into a new directory and run `npm run setup:local`. Then start Hardhat, deploy
for that chain session, and run `npm run doctor`. With development API/UI servers stopped,
`npm run validate:local` runs preflight, backend/blockchain tests, browser tests, and build
sequentially. Install the Playwright browser or set the Chrome executable as documented above.
No Git initialization, commits, remote CI, or publishing is involved.

Keep real keys only in your private `backend/.env`. If a previous ZIP included that file,
**revoke both exposed OpenAI/Groq keys through the providers and generate a new Groq key**.
Deleting a key from a later archive does not revoke it. Provider-side revocation requires
the account owner and is not performed by these scripts. The recipient uses their own key.

### Clarifications from the external review

The review examined a copied Downloads directory, not this development installation.
Its missing interpreter/stale shebangs are consistent with copying `.venv`; the source
archive and setup script prevent shipping that environment. Private `.env` is expected
locally but must never be included in a shared snapshot. Generated files being present
locally does not establish that they were committed; this project has no Git requirement.

A raw hash of `artifact.deployedBytecode` is **not** the runtime hash for this contract:
Solidity replaces its immutable `authorizedRegistrar` placeholders during construction.
`npm run doctor` reads compiler immutable offsets, substitutes the configured registrar,
and checks current source/build-info, expected runtime, deployment receipt/block, chain
ID, and live registrar. An actual missing/reset chain still requires redeployment. Do not
copy or commit local deployment metadata as a substitute for deploying on the target chain.

Authentication, general rate limiting, a wallet UI, TypeScript, report history, registrar
rotation, and remote CI remain out of this approved local MVP. The immutable single
registrar is intentional; changing authority means a new deployment/trust anchor.
Transaction metadata is included in downloaded reports after successful receipt caching;
full technical fields were intentionally removed from the simple UI. A public service
would require a separate threat model and broader controls.

### Review disposition — 2026-11-20

| Review concern | Resolution or remaining boundary |
| --- | --- |
| Credentials in the copied snapshot | Source packaging excludes environment files and checks credential patterns. Previously exposed keys still require provider-side revocation by their owner. |
| Broken copied Python environment | Setup recreates Python 3.12 environments at the destination; doctor checks actual scanner/compiler versions. Share the generated source archive, not the working directory. |
| Artifact/deployment drift | Doctor compares immutable-patched runtime, current source, receipt and live chain state. Raw artifact hashing alone is not a valid comparison for this contract. |
| Reproducible validation | `validate:local` runs preflight, tests and build; a fresh-path install was also tested. Remote CI remains outside the local-only requirement. |
| Integrity and contract test depth | Generated nested payload tests exercise key permutations, JSON round trips and location edits across 100 cases. Contract sequence tests check write authorization, duplicate rejection, record stability and public reads across multiple hashes/accounts. These are bounded property/invariant checks, not exhaustive fuzzing or a formal audit. |
| Transaction observability | Confirmation, unavailable and mismatch states remain visible; downloaded reports contain cached receipt metadata. Timeout reconciliation is documented. Detailed transaction UI was removed at the user's request. |
| Authentication, broader rate limits, operational logging | Loopback-only deployment and local Host/Origin checks remain the supported boundary. Scanner concurrency is bounded. Public/multi-user deployment is unsupported and would need separate controls. |
| Registrar rotation, history, TypeScript and richer protocol roles | Intentional scope decisions, not outstanding local-MVP defects; no architecture migration or new product features were added. |

This checklist does not claim that previously distributed secrets have been revoked,
that development dependency advisories are eliminated, or that the application is
suitable for public hosting.

## Local MVP limitations

No authentication, database, cloud hosting, remote blockchain, or multi-user support.
The backend validates local Host/Origin and binds to loopback. The configured Hardhat
signer is for local development only. Frontend requests time out after 90 seconds;
a timed-out registration may still confirm, so verify or retry to reconcile it.

Browser refresh clears frontend selection; reports remain retrievable through the API by ID.
There is no report history browser. Production build validates the bundle; the documented
UI uses Vite's local development server. Scanner execution has time/output limits and safe
temporary files, but is not an OS sandbox for a public hostile-upload service.

Desktop and mobile examples: [desktop](docs/screenshots/desktop.png),
[mobile](docs/screenshots/mobile.png).
