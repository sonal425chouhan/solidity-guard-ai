import React from "react";

function formatLines(lines) {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const ranges = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    let end = start;
    while (sorted[i + 1] === end + 1) end = sorted[++i];
    ranges.push(start === end ? String(start) : `${start}–${end}`);
  }
  return ranges.join(", ");
}

export default function FindingCard({ finding, explanation }) {
  const context =
    finding.locations.find((location) => location.type === "function") ??
    finding.locations[0];
  const lines = context?.sourceMapping?.lines;
  const contextName = context?.name ?? context?.type;
  const shortName =
    contextName?.length > 70 ? `${contextName.slice(0, 67)}…` : contextName;
  const tone = ["Critical", "High", "Medium", "Low", "Informational"].includes(
    finding.displaySeverity,
  )
    ? finding.displaySeverity.toLowerCase()
    : "unknown";
  return (
    <details className={`finding ${tone}`}>
      <summary>
        <h3>{finding.detector}</h3>
        <span className={`badge ${tone}`}>{finding.severity}</span>
        <span
          className="muted"
          title="Confidence is the scanner’s certainty in this finding, not its severity."
        >
          Confidence: {finding.confidence}
        </span>
        <span className="finding-context" title={contextName}>
          {shortName || "Source"}
          {lines?.length
            ? ` · Lines ${formatLines(lines)}`
            : " · Location unavailable"}
        </span>
      </summary>
      <div className="finding-body">
        <p className="eyebrow">Scanner details</p>
        <pre className="description">{finding.description}</pre>
        <div className="locations">
          <strong>Source locations</strong>
          {finding.locations.length ? (
            <ul>
              {finding.locations.map((location, index) => (
                <li key={index}>
                  <code>{location.name ?? location.type ?? "Source"}</code>
                  {" · "}
                  {location.sourceMapping.filename_relative ??
                    location.sourceMapping.filename_short ??
                    "Contract.sol"}
                  {location.sourceMapping.lines?.length
                    ? ` · lines ${formatLines(location.sourceMapping.lines)}`
                    : " · line unavailable"}
                  {location.sourceMapping.starting_column
                    ? ` · column ${location.sourceMapping.starting_column}`
                    : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p>Source location unavailable.</p>
          )}
        </div>
        {explanation && (
          <section
            className="ai-explanation"
            aria-label={`AI explanation for ${finding.id}`}
          >
            <p className="eyebrow">AI explanation · suggestion</p>
            <p>{explanation.explanation}</p>
            <dl>
              {[
                ["Why it matters", "whyItMatters"],
                ["Potential impact", "potentialImpact"],
                ["Suggested remediation", "remediation"],
              ].map(([label, key]) => (
                <React.Fragment key={key}>
                  <dt>{label}</dt>
                  <dd>{explanation[key]}</dd>
                </React.Fragment>
              ))}
            </dl>
            {explanation.exampleFix && (
              <>
                <h4>Illustrative fix</h4>
                <pre className="example-code">
                  <code>{explanation.exampleFix}</code>
                </pre>
              </>
            )}
            <small>
              Review this suggestion in context. It does not guarantee security.
            </small>
          </section>
        )}
      </div>
    </details>
  );
}
