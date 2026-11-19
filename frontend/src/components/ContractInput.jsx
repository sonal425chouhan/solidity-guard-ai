import React, { useRef, useEffect } from "react";

export default function ContractInput({
  filename,
  source,
  includeAi,
  busy,
  onFilename,
  onSource,
  onAi,
  onUpload,
  onScan,
  onExample,
}) {
  const gutter = useRef(null);
  const editor = useRef(null);
  const lineCount = source.split("\n").length;
  useEffect(() => {
    gutter.current.scrollTop = editor.current.scrollTop;
  }, [source]);
  return (
    <section className="panel input-panel" aria-labelledby="input-heading">
      <div className="panel-heading">
        <span className="source-icon" aria-hidden="true">
          &lt;/&gt;
        </span>
        <div>
          <h2 id="input-heading">Upload Contract</h2>
          <p>Paste Solidity or upload a single file.</p>
        </div>
      </div>
      <form onSubmit={onScan}>
        <fieldset disabled={Boolean(busy)}>
          <div className="example-tools">
            <span>Try an example</span>
            <button
              type="button"
              className="example-button"
              onClick={() => onExample("vulnerable")}
            >
              Vulnerable contract
            </button>
            <button
              type="button"
              className="example-button"
              onClick={() => onExample("minimal")}
            >
              Minimal contract
            </button>
            <small>
              Demo code only · never deploy the vulnerable example with real
              funds.
            </small>
          </div>
          <div className="input-tools">
            <label className="filename-label" htmlFor="filename">
              Filename
              <input
                id="filename"
                value={filename}
                onChange={(event) => onFilename(event.target.value)}
                maxLength={128}
              />
            </label>
            <label className="upload-button">
              Upload .sol
              <input
                aria-label="Upload Solidity file"
                type="file"
                accept=".sol"
                onChange={onUpload}
              />
            </label>
          </div>
          <label className="editor-label" htmlFor="source">
            Solidity source <span>0.8.28 · max 100 KiB · no imports</span>
          </label>
          <div className="numbered-editor">
            <pre ref={gutter} className="line-numbers" aria-hidden="true">
              {Array.from({ length: lineCount }, (_, i) => i + 1).join("\n")}
            </pre>
            <textarea
              ref={editor}
              wrap="off"
              onScroll={(event) => {
                gutter.current.scrollTop = event.currentTarget.scrollTop;
              }}
              id="source"
              className="code-editor"
              value={source}
              onChange={(event) => onSource(event.target.value)}
              spellCheck={false}
              placeholder={
                "// Paste your self-contained Solidity contract here\npragma solidity 0.8.28;\n\ncontract Example {\n    // Your code\n}"
              }
            />
          </div>
          <div className="editor-footer">
            <span>{source ? source.split("\n").length : 0} lines</span>
            <span>Source is never deployed for scanning</span>
          </div>
          <label className="ai-toggle">
            <input
              type="checkbox"
              checked={includeAi}
              onChange={(event) => onAi(event.target.checked)}
            />
            <span>
              <strong>Include AI explanations</strong>
              <small>
                Optional · sends bounded findings and source snippets to Groq.
                Source scanning works without AI.
              </small>
            </span>
          </label>
          <button className="button primary scan-button" type="submit">
            {busy === "scan" ? "Analyzing contract…" : "Scan Contract"}
            <span aria-hidden="true">→</span>
          </button>
        </fieldset>
      </form>
      <p className="fine-print">
        Static analysis is a starting point. Findings and suggested fixes
        require review.
      </p>
    </section>
  );
}
