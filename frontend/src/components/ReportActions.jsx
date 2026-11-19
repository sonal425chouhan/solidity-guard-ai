import React from "react";

const verificationMessages = {
  verified:
    "Verified — this payload matches the selected report and its hash exists in the local registry.",
  mismatch:
    "Mismatch — this content or its declared hash does not match the selected report.",
  unregistered:
    "Unregistered — the content matches, but its hash is not registered on the current local blockchain.",
  unavailable:
    "Blockchain unavailable — verification could not complete. This is not a hash mismatch.",
};

export default function ReportActions({
  report,
  busy,
  registration,
  verification,
  verificationMode,
  uploadedName,
  onMode,
  onUpload,
  onDownload,
  onRegister,
  onVerify,
}) {
  const receipt = registration?.registration ?? report.registration;
  return (
    <section className="panel report-panel" aria-labelledby="report-heading">
      <div className="panel-heading">
        <div>
          <h2 id="report-heading">Save and Verify Report</h2>
        </div>
      </div>
      {report.registrationWarning && registration?.status !== "confirmed" && (
        <p className="notice warning">{report.registrationWarning}</p>
      )}
      <div className="report-download">
        <div className="button-row">
          <button
            className="button primary"
            disabled={Boolean(busy)}
            onClick={onDownload}
          >
            {busy === "download" ? "Retrieving report…" : "Download Report"}
          </button>
        </div>
      </div>
      <div className="blockchain-actions">
        <div className="action-heading">
          <h3>Blockchain record</h3>
          <span className="optional-label">Optional</span>
        </div>
        <p className="action-description">
          Record your report to detect later changes.
        </p>
        <div className="button-row">
          <button
            className="button secondary"
            disabled={Boolean(busy)}
            onClick={onRegister}
          >
            {busy === "register"
              ? "Waiting for confirmation…"
              : "Register on Blockchain"}
          </button>
        </div>
        <div role="status" className="registration-status">
          {busy === "register" ? (
            <p>
              Submitting to the local registry and waiting for a confirmed
              transaction.
            </p>
          ) : registration?.status === "confirmed" ? (
            <p className="positive">
              <strong>
                {registration.alreadyRegistered
                  ? "Already registered"
                  : "Registration confirmed"}
              </strong>{" "}
            </p>
          ) : registration?.status === "unavailable" ? (
            <p className="notice warning">
              Blockchain unavailable. Start Hardhat, check the deployment, then
              retry. A pending transaction may need reconciliation.
            </p>
          ) : (
            <p className="muted">
              {receipt
                ? "Saved receipt available. Verify to check current chain state."
                : "Not registered yet."}
            </p>
          )}
        </div>
      </div>
      {registration?.registrationWarning && (
        <p className="notice warning" role="status">
          {registration.registrationWarning}
        </p>
      )}
      <div className="verify-section">
        <p className="verification-help">
          Check this saved report against the local blockchain.
        </p>
        <button
          className="button secondary"
          disabled={Boolean(busy)}
          onClick={() => {
            onMode("saved");
            onVerify("saved");
          }}
        >
          {busy === "verify" && verificationMode === "saved"
            ? "Checking live registry…"
            : "Verify Report"}
        </button>
        <button
          type="button"
          className="downloaded-report-toggle"
          aria-expanded={verificationMode === "upload"}
          aria-controls="downloaded-report-check"
          disabled={Boolean(busy)}
          onClick={() =>
            onMode(verificationMode === "upload" ? "saved" : "upload")
          }
        >
          <span aria-hidden="true">
            {verificationMode === "upload" ? "▾" : "▸"}
          </span>{" "}
          Check a downloaded report
        </button>
        {verificationMode === "upload" && (
          <div className="report-upload" id="downloaded-report-check">
            <p className="verification-help">
              Upload a copy to check whether its contents have changed.
            </p>
            <label htmlFor="report-upload">
              Upload original or modified report JSON
            </label>
            <input
              id="report-upload"
              type="file"
              accept=".json,application/json"
              disabled={Boolean(busy)}
              onChange={onUpload}
            />
            <small>
              {uploadedName ||
                "Select a report downloaded from this tool. Maximum 7 MiB."}
            </small>
            <button
              className="button secondary"
              disabled={Boolean(busy) || !uploadedName}
              onClick={() => onVerify("upload")}
            >
              {busy === "verify" && verificationMode === "upload"
                ? "Checking uploaded report…"
                : "Verify Uploaded Report"}
            </button>
          </div>
        )}
        <p className="verification-help">
          Verification checks report integrity, not contract security.
        </p>
        {verification && (
          <div
            role="status"
            className={`notice verification ${verification.status === "verified" ? "verified" : "warning"}`}
          >
            <strong>{verificationMessages[verification.status]}</strong>
          </div>
        )}
      </div>
    </section>
  );
}
