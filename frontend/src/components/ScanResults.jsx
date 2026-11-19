import React, { useState } from "react";
import FindingCard from "./FindingCard.jsx";

const aiMessages = {
  disabled: "AI was not requested. These are scanner-only results.",
  completed: "AI processing completed. Review suggestions independently.",
  unavailable:
    "AI explanations are unavailable. Your scanner results and report are still available.",
};

const aiErrors = {
  NOT_CONFIGURED: "Add GROQ_API_KEY to backend/.env, restart the backend, and scan again.",
  INVALID_API_KEY: "Groq rejected the API key. Check GROQ_API_KEY in backend/.env and restart the backend.",
  PROVIDER_ACCESS_DENIED: "Groq denied access. Check your project's model permissions.",
  MODEL_UNAVAILABLE: "The configured Groq model is unavailable. Check GROQ_MODEL in backend/.env.",
  PROVIDER_REQUEST_REJECTED: "Groq rejected the request. Use a model that supports strict JSON output.",
  RATE_LIMITED: "Groq's rate limit was reached. Wait before starting a new scan.",
  QUOTA_EXCEEDED: "Groq reports exhausted quota or credits. Check your Groq account limits.",
  TIMEOUT: "The AI request timed out. Try a new scan later.",
  INVALID_CONFIGURATION: "Check the backend AI model and timeout settings.",
};

export default function ScanResults({ report }) {
  const { payload } = report;
  const [severity, setSeverity] = useState("All");
  const severities = ["Critical", "High", "Medium", "Low", "Informational"];
  const severityOf = (finding) =>
    severities.includes(finding.displaySeverity)
      ? finding.displaySeverity
      : "Unclassified";
  const visibleFindings = payload.findings.filter(
    (finding) => severity === "All" || severityOf(finding) === severity,
  );
  const groups = new Map();
  for (const finding of visibleFindings) {
    if (!groups.has(finding.detector)) groups.set(finding.detector, []);
    groups.get(finding.detector).push(finding);
  }
  const ai = payload.ai ?? { status: "disabled", explanations: [] };
  const explainedIds = new Set(ai.explanations.map((item) => item.findingId));
  const explainedCount = payload.findings.filter((finding) =>
    explainedIds.has(finding.id),
  ).length;
  const aiMessage = ai.status === "partial"
    ? `AI explained ${explainedCount} of ${payload.findings.length} findings. All scanner results are available.`
    : aiMessages[ai.status];
  return (
    <section className="panel results-panel" aria-labelledby="results-heading">
      <div className="panel-heading">
        <div>
          <h2 id="results-heading">Security Analysis</h2>
          <p>{payload.contract.filename}</p>
        </div>
        <span className="badge success">Scan completed</span>
      </div>
      <div
        className="risk-heading"
        data-risk={payload.summary.overallRisk.toLowerCase()}
      >
        <div>
          <p className="eyebrow">Overall scanner risk</p>
          <h3>{payload.summary.overallRisk}</h3>
        </div>
        <div className="finding-total">
          <strong>{payload.summary.totalFindings}</strong>
          <span>Total findings</span>
        </div>
      </div>
      <div className="severity-grid">
        {Object.entries(payload.summary.counts).map(([name, count]) => (
          <div key={name} className={name.toLowerCase()}>
            <strong>{count}</strong>
            <span>{name}</span>
          </div>
        ))}
      </div>
      {payload.summary.unclassified > 0 && (
        <p className="notice warning">
          {payload.summary.unclassified} unclassified findings need review.
        </p>
      )}
      <div className="scan-details">
        <span>Scanned {new Date(payload.scannedAt).toLocaleString()}</span>
        <span>
          Slither {payload.scanner.version} · Solidity{" "}
          {payload.scanner.compilerVersion}
        </span>
      </div>
      <div
        className={`notice ai-status ${ai.status === "unavailable" || ai.status === "partial" ? "warning" : ""}`}
      >
        <strong>AI status: {ai.status}</strong>
        {ai.status !== "disabled" && <p>{aiMessage}</p>}
        {ai.status === "unavailable" && ai.provider === "groq" && aiErrors[ai.reason] && <p>{aiErrors[ai.reason]}</p>}
      </div>
      <div className="findings-heading">
        <h3>Scanner findings</h3>
        {payload.findings.length > 0 && <span>Click to see details</span>}
      </div>
      {payload.findings.length > 0 && (
        <div className="finding-filters">
          <label htmlFor="severity-filter">Filter by severity</label>
          <select
            id="severity-filter"
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
          >
            {[
              "All",
              ...severities,
              ...(payload.findings.some((f) => severityOf(f) === "Unclassified")
                ? ["Unclassified"]
                : []),
            ].map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <span role="status">
            Showing {visibleFindings.length} of {payload.findings.length}{" "}
            findings
          </span>
        </div>
      )}
      {payload.findings.length === 0 ? (
        <div className="empty-findings">
          <h3>No findings detected</h3>
          <p>
            This does not establish that the contract is secure. Manual review
            and testing are still needed.
          </p>
        </div>
      ) : (
        <div className="finding-list">
          {visibleFindings.length === 0 && (
            <p className="filter-empty">
              No {severity.toLowerCase()} findings in this report. Select All to
              see the other findings.
            </p>
          )}
          {[...groups].map(([detector, findings]) => {
            const cards = findings.map((finding) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                explanation={ai.explanations.find(
                  (item) => item.findingId === finding.id,
                )}
              />
            ));
            return findings.length === 1 ? (
              cards
            ) : (
              <details
                key={`${severity}-${detector}`}
                className="finding-group"
              >
                <summary>
                  <strong>{detector}</strong>
                  <span>{findings.length} findings</span>
                </summary>
                <div className="group-findings">{cards}</div>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}
