# Architecture

[README](../README.md) · [API](api.md) · [Development](development.md) · [Troubleshooting](troubleshooting.md)

## Components and data flow

See the [README architecture diagram](../README.md#architecture) for component connections.

[App.jsx](../frontend/src/App.jsx) keeps navigation and report state for the Analyze
and Review screens. Components handle input, findings and report actions;
[api.js](../frontend/src/api.js) centralizes requests and a 90-second client deadline.

[Routes](../backend/src/routes.js) and [controllers](../backend/src/controllers.js)
handle HTTP concerns. Business logic lives in [services](../backend/src/services/).
There is no database or separate Python service.

A scan POST passes through input validation, scanner execution and optional AI processing.
The report service finalizes, hashes and saves the payload before the controller returns
HTTP 201 with the report package. React keeps the result in state and switches screens
without a reload. Downloads retrieve the saved package through GET; registration and
verification are separate POST requests, not automatic scan steps.

## Error handling and availability

[app.js](../backend/src/app.js) centralizes HTTP errors and hides unexpected internal
messages. Scanner failure stops report creation; AI timeout/provider/response failures
instead produce an AI status while retaining scanner findings. Neither failure invents
findings or changes their severity.

Registry operations return unavailable when live deployment/state checks cannot complete.
The controller responds with HTTP 503; it does not report a hash mismatch or rely on a
cached receipt to claim success. Report creation/retrieval does not depend on registry
availability. Storage failure can still prevent saving a report. The frontend handles
errors and request deadlines; detailed response shapes belong in the [API reference](api.md).

## Scan and report creation

The [report service](../backend/src/services/reports.js) validates input and allows
one report-creation operation at a time per service instance, including AI processing.
The [scanner](../backend/src/services/scan.js) invokes Slither without a shell, uses
temporary source files, bounds process execution/output, and cleans up afterward.
[Toolchain checks](../backend/src/scanner-toolchain.js) validate installed versions;
[file handling](../backend/src/scanner-files.js) bounds result reads and removes stale scans.

Successful scanner JSON is authoritative: Slither can exit nonzero when findings exist.
Compilation/process failures are not converted into empty results.
Normalization preserves detector, severity, confidence, description, scanner ID and source
mappings. `Optimization` contributes to the Informational display count while the original
severity remains unchanged. Unknown severities are explicitly unclassified.

The payload contains schema version, UUID, scan time, filename/source hash/source size,
scanner/compiler versions, normalized findings, AI results, summary and limitations.
AI processing completes before payload hashing. Original scanner evidence and AI
suggestions occupy separate fields; explanations reference original finding IDs.

## Deterministic integrity and persistence

[hashing.js](../backend/src/hashing.js) implements `sg-json-v1`: recursively sorted
object keys, preserved array order, JSON escaping, finite numbers and UTF-8 encoding.
Unsupported values and cycles are rejected. SHA-256 produces a `0x`-prefixed digest.
Equivalent object-key ordering or JSON formatting does not change the digest;
array ordering and payload values do.

Default generated storage paths:

```text
backend/data/reports/<uuid>.json                  # { payload, integrity }
backend/data/reports/registrations/<uuid>.json    # mutable receipt cache
```

`integrity` declares `algorithm`, `canonicalization` and `hash`; it is outside the
hashed payload. A retrieved package can also include registration metadata or a warning.

[storage.js](../backend/src/storage.js) publishes reports through a same-directory
exclusive temporary file, file sync and atomic hard link that refuses overwrite.
Receipt writes use a temporary file and atomic rename. Payload hashes are validated
on read; malformed payload files fail retrieval. Missing receipts are allowed, while
corrupt/unreadable receipts produce warnings without invalidating intact reports.
These are application-level write protections, not filesystem immutability: someone
with write access can replace files. Hash checking on read detects inconsistency but is
not independent evidence if that person also replaces the declared hash. Live registry
comparison supplies the separate reference within the local trust boundary.
See [recovery guidance](troubleshooting.md) for cache versus payload failures.

## AI boundaries

[ai.js](../backend/src/services/ai.js) uses one fixed Groq Chat Completions endpoint,
without an SDK or retry loop. The configured model must accept the strict JSON schema
sent by the service. The request selects the first eight normalized findings at most.

Implementation limits, not additional environment settings:

| Limit | Value |
| --- | --- |
| Unique snippet text | Smaller of 2,048 characters or one quarter of source length |
| References per finding | Six source lines |
| Individual source line | 256 characters; oversized statements are omitted |
| Finding description | Sanitized first line, capped at 384 characters |
| Serialized request / response | 32 KiB / 128 KiB |
| Completion budget | 4,000 tokens |
| `AI_TIMEOUT_MS` | Integer 1–30,000; default 15,000 |

Snippets prioritize affected statements and nearby lines. Shared line references avoid
repeating source text. Every finding declares incomplete context. The prompt treats
source as untrusted data, asks the model to inspect available success checks and prohibits
claiming guaranteed fixes or recommending `transfer()`/`send()` as automatic remedies.

Validation checks JSON shape, permitted finding IDs, duplicates, required fields and
text lengths. It checks structure, not technical correctness. Raw provider errors,
request bodies and credentials are not logged or persisted by this service.

`requestedFindings` counts all findings requested by the user, not just those sent under
the cap. UI explanation coverage is independent of severity filters. An enabled scan
with zero findings completes without a provider call. Other failures retain scanner results.
See the [README](../README.md) for opt-in privacy disclosure and configuration.

## Registry and trust boundary

[AuditRegistry.sol](../blockchain/contracts/AuditRegistry.sol) has an immutable authorized
registrar. It rejects a zero registrar at construction and zero/duplicate report hashes
on registration. `registerReport(bytes32)` stores registrar and timestamp and emits
`ReportRegistered`. Anyone can call `verifyReport(bytes32)` or `getRegistration(bytes32)`.
No source code or complete report is stored on-chain. Changing authority requires a new deployment.

The [registry service](../backend/src/services/registry.js) checks chain ID, live runtime
hash, deployment receipt/block hash and authorized registrar before using contract state.
Deployment identity is stored in generated `blockchain/deployments/localhost.json`.
Registration rehashes the stored payload, waits for one confirmation (up to 30 seconds),
and validates the event/receipt. Existing confirmed registrations are recovered before
sending another transaction. A receipt-cache write failure cannot undo on-chain confirmation.

Verification compares the current payload digest with both the selected saved payload's
digest and the supplied declared digest, then queries the contract. Cached receipt metadata
alone cannot establish verification. See [API semantics](api.md) for result states.

[doctor.js](../scripts/doctor.js) additionally compares current contract source/build-info
and compiled runtime with deployment evidence. Solidity patches `authorizedRegistrar`
into immutable bytecode offsets during construction, so hashing the raw artifact alone
is not a valid deployed-runtime comparison. Doctor substitutes the registrar before comparison.

The local operator controls the filesystem and Hardhat node. This design demonstrates
integrity checks within that trust boundary; it does not provide independent public
attestation. User-facing security and hosting limits are listed in the [README](../README.md).
