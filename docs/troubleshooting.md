# Troubleshooting

[README](../README.md) · [Architecture](architecture.md) · [API](api.md) · [Development](development.md)

## Copied or missing scanner tooling

If Slither reports a missing interpreter, an old absolute path or mismatched tools:

```bash
npm run doctor -- --scanner-only
npm run setup:local
```

Use the supported prerequisites in the [README](../README.md#requirements). Setup recreates
the environment at the current path; it preserves the previous `.venv` as a backup.
Set `PYTHON_BIN=/path/to/python3.12` when Python is installed under another executable.
Restart the backend after replacing tooling because successful version checks are cached.
A compiler syntax/import error instead requires correcting the submitted source; reinstalling
tools does not make unsupported contracts compatible.

## Port or browser-test conflicts

Do not start another Hardhat/API/Vite instance on an occupied port. Stop only the relevant
process you own. Follow the [port configuration note](../README.md#start-locally--three-terminals)
if changing backend `PORT`; Vite does not automatically read it from `backend/.env`.
Browser tests use fixed 3001/5173 ports and refuse to reuse existing servers.
For missing browser executables, follow [browser setup](development.md#test-commands).

## AI unavailable or partial

Confirm `GROQ_API_KEY` is configured privately, restart the backend and run a new scan
with AI enabled. The backend reads Groq settings, not `OPENAI_API_KEY`. Existing reports
are finalized and are not enriched after configuration changes.

Inspect the downloaded report's `payload.ai.reason` without sharing its contents publicly:

| Reason | Action |
| --- | --- |
| `NOT_CONFIGURED` | Check the backend environment contains a nonblank Groq key |
| `INVALID_CONFIGURATION` | Check model name and integer timeout within 1–30,000 ms |
| `INVALID_API_KEY` / `PROVIDER_ACCESS_DENIED` | Check credentials and provider permissions |
| `MODEL_UNAVAILABLE` / `PROVIDER_REQUEST_REJECTED` | Check model access and strict structured-output compatibility |
| `RATE_LIMITED` / `QUOTA_EXCEEDED` | Check provider limits; avoid repeated immediate requests |
| `TIMEOUT` / `PROVIDER_ERROR` | Check connectivity/provider status; retry a new scan later |
| `INPUT_LIMIT` | Bounded request exceeded the service limit |
| `INVALID_EXPLANATIONS` / `MALFORMED_OR_FAILED_RESPONSE` | No usable validated result; scanner evidence remains available |
| `INCOMPLETE_COVERAGE` | Partial validated explanations; some findings were omitted or rejected |

Partial results can also follow the eight-finding request cap. See
[AI boundaries](architecture.md#ai-boundaries) for exact limits. Do not replace scanner
findings with unvalidated model output to force a completed status.

## Blockchain unavailable or stale deployment

Keep Hardhat running using the [startup sequence](../README.md#start-locally--three-terminals),
then run `npm run doctor` in another terminal to inspect the deployment.

If the chain was reset or the deployment is missing/stale, run `npm run deploy:local`,
then doctor again. A new deployment is a new registry; old registrations do not migrate.
Re-register the reports needed for the demo. Do not copy deployment metadata from another
machine as a substitute for deploying. `BLOCKCHAIN_RPC_URL` must point to a local HTTP
RPC with chain ID 31337. Restore the authorized `BLOCKCHAIN_SIGNER_INDEX` if the API reports
`WRONG_REGISTRAR`; changing a signer setting does not transfer contract authority.

A raw artifact/runtime hash difference can result from Solidity immutables. Use doctor's
[immutable-aware comparison](architecture.md#registry-and-trust-boundary) rather than
assuming a mismatch proves deployment corruption.

## Registration timeout or receipt warning

A frontend timeout (90 seconds) or unavailable response is not proof that a transaction
failed. Once RPC access is restored, verify the report or retry registration. The backend
recovers existing confirmed registrations from chain state, events and receipts.

If registration is confirmed but a `registrationWarning` appears, the local receipt cache
could not be saved. Check ownership, write permissions, free disk space and whether the
receipt path is a file/directory conflict. Repair it, then retry registration to cache the
confirmed record. Verification reads live chain state but does not rewrite the receipt cache.
Corrupt/unreadable cache metadata does not by itself invalidate an intact report payload.

## Payload integrity errors and verification results

Do not edit the stored original to demonstrate tampering. Download a copy and change a
field inside its `payload`, then upload it through the verification UI. Wrapper metadata
changes are outside the payload digest. A supplied package with invalid structure produces
an input error; a well-formed changed payload produces mismatch when the chain is available.

If the stored original fails its hash check, restore a trusted original backup or create
a new report by rescanning. Editing its declared hash to silence the error does not recover
the registered original. A new scan has a new report identity.

For the distinction between verified, mismatch, unregistered and unavailable, use the
[API status table](api.md#verify-a-report). For report-data paths, see
[persistence details](architecture.md#deterministic-integrity-and-persistence).
