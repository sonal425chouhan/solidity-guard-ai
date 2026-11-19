import React, { useState, useEffect, useRef } from "react";
import { api } from "./api.js";
import vulnerableExample from "../../fixtures/vulnerable.sol?raw";
import minimalExample from "../../fixtures/minimal.sol?raw";
import ContractInput from "./components/ContractInput.jsx";
import ScanResults from "./components/ScanResults.jsx";
import ReportActions from "./components/ReportActions.jsx";

export default function App() {
  const [screen, setScreen] = useState("analyze");
  const heading = useRef(null);
  useEffect(() => {
    heading.current?.focus();
  }, [screen]);

  function navigate(nextScreen) {
    setError("");
    setScreen(nextScreen);
  }

  const [filename, setFilename] = useState("Contract.sol");
  const [source, setSource] = useState("");
  const [includeAi, setIncludeAi] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [report, setReport] = useState(null);
  const [registration, setRegistration] = useState(null);
  const [verification, setVerification] = useState(null);
  const [verificationMode, setVerificationMode] = useState("saved");
  const [upload, setUpload] = useState(null);

  async function run(action, work) {
    setBusy(action);
    setError("");
    try {
      await work();
    } catch (failure) {
      setError(failure.message || "Something went wrong. Try again.");
    } finally {
      setBusy("");
    }
  }

  async function uploadSource(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await run("file", async () => {
      if (!file.name.endsWith(".sol")) throw new Error("Choose a .sol file.");
      if (file.size > 100 * 1024)
        throw new Error("Solidity files must be 100 KiB or smaller.");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      setFilename(file.name);
      setSource(text);
    });
  }

  function loadExample(kind) {
    if (
      source.trim() &&
      !window.confirm(
        "Replace the current code with this example? Your existing report will be kept.",
      )
    )
      return;
    setFilename(kind === "vulnerable" ? "vulnerable.sol" : "minimal.sol");
    setSource(kind === "vulnerable" ? vulnerableExample : minimalExample);
    setError("");
  }

  async function scan(event) {
    event.preventDefault();
    await run("scan", async () => {
      if (!source.trim())
        throw new Error(
          "Paste Solidity source or upload a .sol file before scanning.",
        );
      if (new TextEncoder().encode(source).length > 100 * 1024)
        throw new Error("Solidity source must be 100 KiB or smaller.");
      if (
        !/^[A-Za-z0-9][A-Za-z0-9._ -]*\.sol$/.test(filename) ||
        filename.length > 128
      )
        throw new Error("Enter a plain filename ending in .sol.");
      const nextReport = await api.scan({ filename, source, includeAi });
      setRegistration(null);
      setVerification(null);
      setUpload(null);
      setVerificationMode("saved");
      setReport(nextReport);
      setScreen("review");
    });
  }

  async function uploadReport(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setVerification(null);
    setUpload(null);
    if (!file) return;
    await run("file", async () => {
      if (!file.name.endsWith(".json") || file.size > 7 * 1024 * 1024)
        throw new Error("Choose a JSON report no larger than 7 MiB.");
      let parsed;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new Error("The selected report is not valid JSON.");
      }
      if (!parsed?.payload || !parsed.integrity)
        throw new Error(
          "Choose the downloaded report package with payload and integrity fields.",
        );
      setUpload({ name: file.name, report: parsed });
    });
  }

  function download() {
    run("download", async () => {
      const current = await api.get(report.payload.reportId);
      setReport(current);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(current, null, 2) + "\n"], {
          type: "application/json",
        }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `solidityguard-${current.payload.reportId}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <svg
            className="brand-icon"
            viewBox="0 0 32 32"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M16 3 27 7v8c0 7-6 11-11 14C11 26 5 22 5 15V7l11-4Z"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="m11 16 3 3 7-8"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>
            SolidityGuard <strong>AI</strong>
          </span>
        </div>
        <span className="workspace-label">Local workspace</span>
      </header>
      <main
        className={screen === "review" ? "review-screen" : "analyze-screen"}
      >
        <div className="page-heading">
          <div className="heading-copy">
            <h1 ref={heading} tabIndex={-1}>
              {screen === "analyze" ? "Analyze Contract" : "Review & Verify"}
            </h1>
            <p>
              {screen === "analyze"
                ? "Upload or paste Solidity code to check for potential security issues."
                : "Review the findings, save your report, and optionally verify it on the local blockchain."}
            </p>
          </div>
          <ol className="workflow" aria-label="Workflow">
            <li aria-current={screen === "analyze" ? "step" : undefined}>
              <span className="workflow-number">01</span> Analyze
            </li>
            <li aria-hidden="true">→</li>
            <li aria-current={screen === "review" ? "step" : undefined}>
              <span className="workflow-number">02</span> Review &amp; Verify
            </li>
          </ol>
          {screen === "review" ? (
            <button
              className="button secondary"
              disabled={Boolean(busy)}
              onClick={() => navigate("analyze")}
            >
              Back to Analyze
            </button>
          ) : (
            report && (
              <button
                className="button secondary"
                disabled={Boolean(busy)}
                onClick={() => navigate("review")}
              >
                Return to Report
              </button>
            )
          )}
        </div>
        {error && (
          <div className="notice error" role="alert">
            <strong>Action could not complete</strong>
            <p>{error}</p>
          </div>
        )}
        <div className="workspace-grid">
          {screen === "analyze" && (
            <ContractInput
              filename={filename}
              source={source}
              includeAi={includeAi}
              busy={busy}
              onFilename={setFilename}
              onSource={setSource}
              onAi={setIncludeAi}
              onUpload={uploadSource}
              onScan={scan}
              onExample={loadExample}
            />
          )}
          <div
            className={
              screen === "review"
                ? "results-column review-grid"
                : "results-column"
            }
            aria-busy={busy === "scan"}
          >
            {busy === "scan" && (
              <div className="notice" role="status">
                <h2>Analyzing your contract…</h2>
                <p>
                  Running Slither and, if requested, optional AI explanations.
                  This may take several seconds.
                </p>
              </div>
            )}
            {screen === "review" && report && (
              <>
                <ScanResults key={report.payload.reportId} report={report} />
                <ReportActions
                  report={report}
                  busy={busy}
                  registration={registration}
                  verification={verification}
                  verificationMode={verificationMode}
                  uploadedName={upload?.name}
                  onMode={(mode) => {
                    setVerificationMode(mode);
                    setVerification(null);
                  }}
                  onUpload={uploadReport}
                  onDownload={download}
                  onRegister={() => {
                    setRegistration(null);
                    setVerification(null);
                    run("register", async () =>
                      setRegistration(
                        await api.register(report.payload.reportId),
                      ),
                    );
                  }}
                  onVerify={(mode) => {
                    setVerification(null);
                    run("verify", async () =>
                      setVerification(
                        await api.verify(
                          report.payload.reportId,
                          mode === "upload" ? upload.report : undefined,
                        ),
                      ),
                    );
                  }}
                />
              </>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
