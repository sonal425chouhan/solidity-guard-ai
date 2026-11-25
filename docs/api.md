# API reference

[README](../README.md) · [Architecture](architecture.md) · [Development](development.md) · [Troubleshooting](troubleshooting.md)

The default backend base URL is `http://127.0.0.1:3001/api`. The frontend uses Vite's
`/api` proxy. Send POST bodies as UTF-8 JSON with `Content-Type: application/json`.
Report IDs must be lowercase UUID v4 strings. Routes are defined in
[routes.js](../backend/src/routes.js); response handling is in
[controllers.js](../backend/src/controllers.js).

## Response envelopes

Successful calls use `{"success":true,"data":...}`. Ordinary errors use:

```json
{"success":false,"error":{"code":"INVALID_INPUT","message":"..."}}
```

Blockchain unavailability is an intentional exception: HTTP 503 contains
`success: false` and a `data` object with `status: "unavailable"`,
`reason: "BLOCKCHAIN_UNAVAILABLE"` and a recovery message. Clients must handle both shapes.
A successful verification request can return `mismatch` or `unregistered`; HTTP success
means the check completed, not that the report was verified.

## Create a report

`POST /reports` returns HTTP 201 with the report package and a `Location` header.

```json
{
  "filename": "Vault.sol",
  "source": "// SPDX-License-Identifier: MIT\npragma solidity 0.8.28;\ncontract Vault {}",
  "includeAi": false
}
```

`filename` must be a plain `.sol` filename, at most 128 characters, beginning with an
ASCII letter or digit and containing only letters, digits, dots, underscores, spaces
or hyphens. `source` must be nonempty and contain no null bytes. `includeAi` is an
optional boolean, defaulting to false; unknown input keys are rejected.
See [input limits](../README.md#scope-and-security).

The returned package contains `payload` and `integrity`. The payload includes
`reportId`, `scanStatus`, `findings`, `ai` and `summary`, along with metadata detailed
in [architecture](architecture.md). AI failure is represented in `payload.ai` and does
not turn a successful scan into an HTTP failure.

## Retrieve a report

`GET /reports/:id` returns HTTP 200 with the saved package and `Cache-Control: no-store`.
It can include `registration` or `registrationWarning` when reading the separate receipt
cache. Retrieval validates the payload hash but does not refresh blockchain state.
Use verification for a live chain check.

## Register a report

`POST /reports/:id/register` with `{}` returns HTTP 200 after confirmed registration:

```text
{ success: true, data: {
    status: "confirmed",
    alreadyRegistered: false,
    registration: { reportHash, chainId, registryAddress, registrar, registeredAt,
                    transactionHash, blockNumber, blockHash }
} }
```

This is a response-shape illustration; field names without values are not literal JSON.
Clients cannot provide a registration hash or metadata. The backend loads and rehashes
the saved report. A duplicate request returns the existing confirmed record with
`alreadyRegistered: true` where recovered. A confirmed transaction whose local receipt
cannot be saved includes `registrationWarning`; retry after repairing storage to cache it.
Unconfirmed or inaccessible chain state returns the unavailable envelope described above.

## Verify a report

`POST /reports/:id/verify` with `{}` checks the selected saved report. To check a copy,
send `{ "reportPackage": <complete downloaded JSON object> }` instead.

HTTP 200 `data` contains `status`, `computedHash`, `expectedHash`,
`matchesExpectedHash`, `matchesDeclaredHash`, `registeredOnChain`,
`expectedRegisteredOnChain`, `chainId` and `registryAddress`.

| Status | Meaning |
| --- | --- |
| `verified` | Digest matches the selected saved report and declared hash, and is registered |
| `mismatch` | Digest differs from the selected saved report or declared hash |
| `unregistered` | Digests match, but the hash is not registered |
| `unavailable` | Live registry checks could not complete; returned with HTTP 503 |

The supplied package must have supported schema/integrity fields and a findings array.
Malformed packages return 400 rather than a verification result. A damaged stored payload
fails integrity validation before chain access. A different registered report cannot pass
for the selected ID. RPC failure yields unavailable even if an uploaded digest differs.

## Errors and request limits

[app.js](../backend/src/app.js) limits verification JSON bodies to 8 MiB and other JSON
bodies to 1 MiB. The decoded source has its separate 100 KiB limit. These are distinct
from the frontend's 7 MiB downloaded-report upload limit.

| HTTP status | Examples |
| --- | --- |
| 400 | Invalid source fields, report ID, package or malformed JSON |
| 403 | Disallowed local Host/Origin |
| 404 | Unknown endpoint or missing report |
| 409 | Existing report publication or wrong configured registrar |
| 413 | Source/request body too large |
| 415 | Unsupported media type, charset or encoding |
| 422 | Compilation/analysis failure, including unsupported imports |
| 429 | Scanner or registrar already busy |
| 500 | Stored report integrity error or unexpected internal failure |
| 502 | Invalid scanner findings |
| 503 | Missing/mismatched scanner tools or unavailable blockchain |
| 504 | Scanner timeout |

Errors do not return raw compiler diagnostics that might echo submitted source.
For recovery steps, see [troubleshooting](troubleshooting.md).
