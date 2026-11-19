import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const vulnerable = fileURLToPath(
  new URL("../../fixtures/vulnerable.sol", import.meta.url),
);
const minimal = fileURLToPath(
  new URL("../../fixtures/minimal.sol", import.meta.url),
);
const sourceInput = (page) =>
  page.getByLabel("Solidity source", { exact: false });
async function scanFile(page, filename = vulnerable) {
  await page.getByLabel("Upload Solidity file").setInputFiles(filename);
  await expect(
    page.getByRole("button", { name: "Scan Contract" }),
  ).toBeEnabled();
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/reports") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Scan Contract" }).click();
  await expect(page.getByText("Scan completed", { exact: true })).toBeVisible();
  return (await (await response).json()).data;
}
async function uploadedReport(page, report) {
  if (
    (await page
      .getByRole("button", { name: "Check a downloaded report" })
      .getAttribute("aria-expanded")) === "false"
  ) {
    await page
      .getByRole("button", { name: "Check a downloaded report" })
      .click();
  }
  await page
    .getByLabel("Upload original or modified report JSON")
    .setInputFiles({
      name: "report.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(report)),
    });
  await expect(
    page.getByRole("button", { name: "Verify Uploaded Report" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Verify Uploaded Report" }).click();
}

test("real scan, retrieve/download, register, verify original and detect modified report", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("checkbox", { name: /Include AI/ }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("heading", { name: "Security Analysis" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Save and Verify Report" }),
  ).toHaveCount(0);
  const scanned = await scanFile(page);
  const finding = page
    .locator("details.finding")
    .filter({ hasText: "reentrancy-eth" });
  await expect(finding).not.toHaveAttribute("open", "");
  await expect(finding.locator(".description")).not.toBeVisible();
  await finding.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(finding.locator(".description")).toBeVisible();
  await expect(
    finding.getByText("Source locations", { exact: true }),
  ).toBeVisible();
  await expect(finding.locator(".locations")).toContainText("lines 12–18");
  await finding.locator("summary").click();
  await expect(finding.locator(".description")).not.toBeVisible();
  await expect(
    page.getByText("Technical Details", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "reentrancy-eth" }),
  ).toBeVisible();
  await expect(
    page.getByText("Confidence: Medium", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("AI status: disabled", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Verify Report" }).click();
  await expect(page.getByText(/^Unregistered —/)).toBeVisible();
  const id = scanned.payload.reportId;
  const retrieved = await (await request.get(`/api/reports/${id}`)).json();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Report" }).click();
  const download = await downloadPromise;
  const downloaded = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(downloaded).toEqual(retrieved.data);
  await page.getByRole("button", { name: "Register on Blockchain" }).click();
  await expect(
    page.getByText("Registration confirmed", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Verify Report" }).click();
  await expect(page.getByText(/^Verified —/)).toBeVisible();
  await uploadedReport(page, downloaded);
  await expect(page.getByText(/^Verified —/)).toBeVisible();
  downloaded.payload.findings[0].description += " modified";
  await uploadedReport(page, downloaded);
  await expect(page.getByText(/^Mismatch —/)).toBeVisible();
});

test("minimal contract, source validation, malformed uploads and compiler failure", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Scan Contract" }).click();
  await expect(page.getByRole("alert")).toContainText("Paste Solidity source");
  await page.getByLabel("Upload Solidity file").setInputFiles({
    name: "bad.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("x"),
  });
  await expect(page.getByRole("alert")).toContainText("Choose a .sol");
  await scanFile(page, minimal);
  await expect(
    page.getByText("This does not establish that the contract is secure.", {
      exact: false,
    }),
  ).toBeVisible();
  if (
    (await page
      .getByRole("button", { name: "Check a downloaded report" })
      .getAttribute("aria-expanded")) === "false"
  ) {
    await page
      .getByRole("button", { name: "Check a downloaded report" })
      .click();
  }
  await page
    .getByLabel("Upload original or modified report JSON")
    .setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from("{broken"),
    });
  await expect(page.getByRole("alert")).toContainText("not valid JSON");
  await page.getByRole("button", { name: "Back to Analyze" }).click();
  await sourceInput(page).fill("pragma solidity 0.8.28; contract Broken {");
  await page.getByRole("button", { name: "Scan Contract" }).click();
  await expect(page.getByRole("alert")).toContainText("Analysis failed");
  await expect(page.getByText("Scan completed", { exact: true })).toHaveCount(
    0,
  );
});

test("opt-in AI is disclosed and unavailable AI preserves real scan results", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByText(/sends bounded findings and source snippets to Groq/),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: /Include AI/ }).check();
  await scanFile(page);
  await expect(
    page.getByText("AI status: unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "reentrancy-eth" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download Report" }),
  ).toBeEnabled();
});

test("loading and backend outage are shown without fake results", async ({
  page,
}) => {
  await page.goto("/");
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/reports", async (route) => {
    await gate;
    await route.abort();
  });
  await sourceInput(page).fill(await readFile(minimal, "utf8"));
  await page.getByRole("button", { name: "Scan Contract" }).click();
  await expect(
    page.getByRole("heading", { name: "Analyzing your contract…" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Analyzing contract…" }),
  ).toBeDisabled();
  release();
  await expect(page.getByRole("alert")).toContainText(
    "Cannot reach the backend",
  );
  await expect(page.getByText("Scan completed", { exact: true })).toHaveCount(
    0,
  );
});

test("blockchain unavailable is distinct from mismatch and clears old verification", async ({
  page,
}) => {
  await page.goto("/");
  await scanFile(page, minimal);
  await page.route("**/api/reports/*/verify", (route) =>
    route.fulfill({
      status: 503,
      json: { success: false, data: { status: "unavailable" } },
    }),
  );
  await page.getByRole("button", { name: "Verify Report" }).click();
  await expect(page.getByText(/^Blockchain unavailable —/)).toBeVisible();
  if (
    (await page
      .getByRole("button", { name: "Check a downloaded report" })
      .getAttribute("aria-expanded")) === "false"
  ) {
    await page
      .getByRole("button", { name: "Check a downloaded report" })
      .click();
  }
  await expect(page.getByText(/^Blockchain unavailable —/)).toHaveCount(0);
  await page.route("**/api/reports/*/register", (route) =>
    route.fulfill({
      status: 503,
      json: { success: false, data: { status: "unavailable" } },
    }),
  );
  await page.getByRole("button", { name: "Register on Blockchain" }).click();
  await expect(
    page.getByText(/Blockchain unavailable. Start Hardhat/),
  ).toBeVisible();
  await expect(
    page.getByText("Registration confirmed", { exact: true }),
  ).toHaveCount(0);
});

test("AI explanation rendering stays separate and mobile layout has no overflow", async ({
  page,
  request,
}) => {
  const result = await (
    await request.post("/api/reports", {
      data: {
        filename: "vulnerable.sol",
        source: await readFile(vulnerable, "utf8"),
      },
    })
  ).json();
  const report = result.data;
  report.payload.ai = {
    status: "partial",
    reason: "INCOMPLETE_COVERAGE",
    explanations: [
      {
        findingId: report.payload.findings[0].id,
        explanation: "<script>unsafe()</script>",
        whyItMatters: "State changes after the external call.",
        potentialImpact: "Repeated withdrawals.",
        remediation: "Review state updates.",
        exampleFix: "balances[msg.sender] = 0;",
      },
    ],
  };
  // This fixture is only for presentation tests; no synthetic report is registered.
  await page.route("**/api/reports", (route) =>
    route.fulfill({ status: 201, json: { success: true, data: report } }),
  );
  await page.goto("/");
  await scanFile(page);
  await expect(
    page.getByText("AI status: partial", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "AI explained 1 of 2 findings. All scanner results are available.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByLabel("Filter by severity").selectOption("High");
  await expect(
    page.getByText(
      "AI explained 1 of 2 findings. All scanner results are available.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByLabel("Filter by severity").selectOption("All");
  await page.locator("details.finding summary").first().click();
  await expect(
    page.getByText("<script>unsafe()</script>", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Suggested remediation", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to Analyze" }).click();
  report.payload.ai.status = "completed";
  report.payload.ai.explanations = report.payload.findings.map((finding) => ({
    ...report.payload.ai.explanations[0],
    findingId: finding.id,
  }));
  await page.getByRole("button", { name: "Scan Contract" }).click();
  await expect(
    page.getByText("AI status: completed", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("details.finding summary").first().click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Register on Blockchain" }),
  ).toBeVisible();
});

test("capture actual desktop and mobile scan screenshots", async ({ page }) => {
  await page.goto("/");
  await scanFile(page);
  await mkdir("docs/screenshots", { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "docs/screenshots/desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "docs/screenshots/mobile.png",
    fullPage: true,
  });
});

test("SPA navigation preserves report and input, and failed scans stay on Analyze", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.navigationMarker = "same-document";
  });
  await expect(
    page.getByRole("heading", { name: "Analyze Contract", exact: true }),
  ).toBeVisible();
  const scanned = await scanFile(page);
  await expect(
    page.getByRole("heading", { name: "Review & Verify", exact: true }),
  ).toBeFocused();
  await expect(sourceInput(page)).toHaveCount(0);
  const id = scanned.payload.reportId;
  await page.getByRole("button", { name: "Verify Report" }).click();
  await expect(page.getByText(/^Unregistered —/)).toBeVisible();
  await page.getByRole("button", { name: "Back to Analyze" }).click();
  await expect(sourceInput(page)).toHaveValue(
    await readFile(vulnerable, "utf8"),
  );
  await expect(
    page.getByRole("heading", { name: "Security Analysis" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Return to Report" }).click();
  {
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download Report" }).click();
    const download = await downloadEvent;
    const saved = JSON.parse(await readFile(await download.path(), "utf8"));
    expect(saved.payload.reportId).toBe(id);
  }
  await expect(page.getByText(/^Unregistered —/)).toBeVisible();
  await page.getByRole("button", { name: "Back to Analyze" }).click();
  await sourceInput(page).fill("pragma solidity 0.8.28; contract Broken {");
  await page.getByRole("button", { name: "Scan Contract" }).click();
  await expect(page.getByRole("alert")).toContainText("Analysis failed");
  await expect(
    page.getByRole("heading", { name: "Analyze Contract", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Security Analysis" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Return to Report" }).click();
  {
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download Report" }).click();
    const download = await downloadEvent;
    const saved = JSON.parse(await readFile(await download.path(), "utf8"));
    expect(saved.payload.reportId).toBe(id);
  }
  expect(await page.evaluate(() => window.navigationMarker)).toBe(
    "same-document",
  );
});

test("examples require confirmation before replacing code and line numbers follow scrolling", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Vulnerable contract", exact: true })
    .click();
  await expect(sourceInput(page)).toHaveValue(
    await readFile(vulnerable, "utf8"),
  );
  await expect(page.getByLabel("Filename", { exact: true })).toHaveValue(
    "vulnerable.sol",
  );
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("button", { name: "Minimal contract", exact: true })
    .click();
  await expect(sourceInput(page)).toHaveValue(
    await readFile(vulnerable, "utf8"),
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Minimal contract", exact: true })
    .click();
  await expect(sourceInput(page)).toHaveValue(await readFile(minimal, "utf8"));
  await expect(
    page.getByRole("checkbox", { name: /Include AI/ }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Scan Contract" }).click();
  await expect(
    page
      .locator(".empty-findings")
      .getByRole("heading", { name: "No findings detected" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to Analyze" }).click();
  const longSource = Array.from(
    { length: 120 },
    (_, i) => `// line ${i + 1} ${"x".repeat(150)}`,
  ).join("\n");
  await sourceInput(page).fill(longSource);
  await expect(page.locator(".line-numbers")).toHaveText(
    Array.from({ length: 120 }, (_, i) => i + 1).join("\n"),
  );
  await sourceInput(page).evaluate((editor) => {
    editor.scrollTop = 480;
    editor.scrollLeft = 150;
    editor.dispatchEvent(new Event("scroll"));
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector(".line-numbers").scrollTop -
          document.querySelector("#source").scrollTop,
      ),
    )
    .toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("severity filters preserve totals and the complete downloaded report", async ({
  page,
}) => {
  await page.goto("/");
  const report = await scanFile(page);
  const summary = await page.locator(".risk-heading").textContent();
  await expect(page.locator(".finding-context").first()).toContainText(
    "withdraw · Lines 12–18",
  );
  await page.getByLabel("Filter by severity").selectOption("High");
  await expect(page.locator("details.finding")).toHaveCount(1);
  await expect(
    page.getByText("Showing 1 of 2 findings", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Filter by severity").selectOption("Critical");
  await expect(page.locator(".filter-empty")).toContainText(
    "No critical findings",
  );
  await expect(page.locator(".risk-heading")).toHaveText(summary);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Report" }).click();
  const download = await downloadEvent;
  expect(JSON.parse(await readFile(await download.path(), "utf8"))).toEqual(
    report,
  );
  await page.getByLabel("Filter by severity").selectOption("All");
  await expect(page.locator("details.finding")).toHaveCount(2);
});

test("repeated detectors group without losing evidence, AI associations, or unknown severity", async ({
  page,
  request,
}) => {
  const result = await (
    await request.post("/api/reports", {
      data: {
        filename: "vulnerable.sol",
        source: await readFile(vulnerable, "utf8"),
      },
    })
  ).json();
  const report = result.data;
  // Presentation-only fixture: never saved or registered as a real audit.
  const repeated = structuredClone(report.payload.findings[1]);
  repeated.id = "repeat-3";
  repeated.description = "Separate evidence for the second occurrence.";
  const unknown = structuredClone(repeated);
  unknown.id = "unknown-4";
  unknown.detector = "future-detector";
  unknown.displaySeverity = "Unknown";
  unknown.severity = "Unknown";
  report.payload.findings.push(repeated, unknown);
  report.payload.summary.totalFindings = 4;
  report.payload.summary.counts.Informational = 2;
  report.payload.summary.unclassified = 1;
  report.payload.ai = {
    status: "partial",
    explanations: [
      {
        findingId: repeated.id,
        explanation: "Explanation for the second occurrence only.",
        whyItMatters: "Example",
        potentialImpact: "Example",
        remediation: "Review",
        exampleFix: "",
      },
    ],
  };
  await page.route("**/api/reports", (route) =>
    route.fulfill({ status: 201, json: { success: true, data: report } }),
  );
  await page.goto("/");
  await scanFile(page);
  const group = page.locator("details.finding-group");
  await expect(group).toHaveCount(1);
  await expect(group).not.toHaveAttribute("open", "");
  await expect(group.locator(":scope > summary")).toContainText(
    "low-level-calls",
  );
  await expect(group.locator(":scope > summary")).toContainText("2 findings");
  await group.locator(":scope > summary").focus();
  await page.keyboard.press("Enter");
  await expect(group.locator("details.finding")).toHaveCount(2);
  await group.locator("details.finding > summary").nth(1).click();
  await expect(group.locator(".description").nth(1)).toHaveText(
    repeated.description,
  );
  await expect(
    group.getByText("Explanation for the second occurrence only."),
  ).toBeVisible();
  await expect(
    group.locator("details.finding").first().locator(".ai-explanation"),
  ).toHaveCount(0);
  await page.getByLabel("Filter by severity").selectOption("Unclassified");
  await expect(page.locator("details.finding")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "future-detector" }),
  ).toBeVisible();
  await page.getByLabel("Filter by severity").selectOption("Informational");
  await expect(
    page.getByText("Showing 2 of 4 findings", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("downloaded-report disclosure is optional and default verification always checks the saved report", async ({
  page,
}) => {
  await page.goto("/");
  await scanFile(page, minimal);
  const toggle = page.getByRole("button", {
    name: "Check a downloaded report",
  });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByLabel("Upload original or modified report JSON"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Verify Report", exact: true }),
  ).toBeEnabled();
  await toggle.click();
  await expect(
    page.getByRole("button", { name: "Verify Uploaded Report" }),
  ).toBeDisabled();
  await page
    .getByLabel("Upload original or modified report JSON")
    .setInputFiles({
      name: "edited.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ payload: {}, integrity: {} })),
    });
  await expect(
    page.getByRole("button", { name: "Verify Uploaded Report" }),
  ).toBeEnabled();
  const sent = page.waitForRequest((r) => r.url().endsWith("/verify"));
  await page
    .getByRole("button", { name: "Verify Report", exact: true })
    .click();
  expect((await sent).postDataJSON()).toEqual({});
  await expect(page.getByText(/^Unregistered —/)).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText(/^Unregistered —/)).toHaveCount(0);
  await toggle.click();
  await expect(
    page.getByLabel("Upload original or modified report JSON"),
  ).toHaveCount(0);
});

test("confirmed registration shows a separate local receipt storage warning", async ({
  page,
}) => {
  await page.goto("/");
  await scanFile(page, minimal);
  const warning =
    "Registration is confirmed on-chain, but the local receipt could not be saved. Check local storage and retry registration to recover the receipt.";
  await page.route("**/api/reports/*/register", (route) =>
    route.fulfill({
      status: 200,
      json: {
        success: true,
        data: {
          status: "confirmed",
          alreadyRegistered: false,
          registrationWarning: warning,
        },
      },
    }),
  );
  await page.getByRole("button", { name: "Register on Blockchain" }).click();
  await expect(
    page.getByText("Registration confirmed", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(warning, { exact: true })).toBeVisible();
});
