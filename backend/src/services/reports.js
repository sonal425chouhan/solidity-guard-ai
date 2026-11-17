import { randomUUID } from 'node:crypto';
import { scanSource } from './scan.js';
import { AppError } from '../errors.js';
import { freezeJson, hashPayload, sha256 } from '../hashing.js';
import { saveReport, loadReport, defaultReportDirectory } from '../storage.js';
import { explainFindings } from './ai.js';

const severities = ['Critical', 'High', 'Medium', 'Low', 'Informational'];

function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['filename', 'source', 'includeAi'].includes(key))) {
    throw new AppError(400, 'INVALID_INPUT', 'Provide filename, source, and optionally includeAi.');
  }
  if (input.includeAi !== undefined && typeof input.includeAi !== 'boolean') {
    throw new AppError(400, 'INVALID_INPUT', 'includeAi must be a boolean.');
  }
  if (typeof input.filename !== 'string' || input.filename.length > 128 ||
      !/^[A-Za-z0-9][A-Za-z0-9._ -]*\.sol$/.test(input.filename)) {
    throw new AppError(400, 'INVALID_FILENAME', 'Provide a plain .sol filename without directory paths.');
  }
  if (typeof input.source !== 'string' || !input.source.trim() || input.source.includes('\0')) {
    throw new AppError(400, 'INVALID_SOURCE', 'Provide nonempty Solidity source without null bytes.');
  }
  if (Buffer.byteLength(input.source, 'utf8') > 100 * 1024) {
    throw new AppError(413, 'SOURCE_TOO_LARGE', 'Source exceeds 100 KiB.');
  }
}

export function normalizeFindings(findings) {
  if (!Array.isArray(findings)) throw new AppError(502, 'INVALID_SCANNER_OUTPUT', 'Invalid scanner findings.');
  return findings.map((finding, index) => {
    if (!finding || ['check', 'impact', 'confidence', 'description'].some(key => typeof finding[key] !== 'string') ||
        (finding.elements !== undefined && !Array.isArray(finding.elements))) {
      throw new AppError(502, 'INVALID_SCANNER_OUTPUT', 'Invalid scanner finding metadata.');
    }
    return {
      id: `finding-${index + 1}`,
      scannerId: typeof finding.id === 'string' ? finding.id : null,
      detector: finding.check,
      severity: finding.impact,
      displaySeverity: finding.impact === 'Optimization' ? 'Informational' : severities.includes(finding.impact) ? finding.impact : null,
      confidence: finding.confidence,
      description: finding.description,
      locations: (finding.elements ?? []).filter(element => element?.source_mapping).map(element => ({
        type: element.type ?? null,
        name: element.name ?? null,
        sourceMapping: structuredClone(element.source_mapping),
      })),
    };
  });
}

// A small factory keeps tests in temporary storage without changing global state.
export function createReportService({ scan = scanSource, directory = defaultReportDirectory, aiOptions } = {}) {
  let scanning = false;
  return {
    async create(input) {
      validateInput(input);
      if (scanning) throw new AppError(429, 'SCANNER_BUSY', 'A scan is already running. Try again shortly.');
      scanning = true;
      try {
        let result;
        try { result = await scan(input.source); }
        catch (error) {
          if (error instanceof AppError) throw error;
          // Do not return raw compiler diagnostics, which may echo submitted source.
          if (error.code === 'ENOENT') throw new AppError(503, 'SCANNER_UNAVAILABLE', 'Scanner tooling is not installed.');
          if (/timed out/i.test(error.message)) throw new AppError(504, 'SCANNER_TIMEOUT', 'The scanner timed out.');
          throw new AppError(422, 'SCAN_FAILED', 'Analysis failed. Check Solidity syntax, the 0.8.28 compiler requirement, and unsupported imports.');
        }
        const findings = normalizeFindings(result.findings);
        const counts = Object.fromEntries(severities.map(severity => [severity, 0]));
        let unclassified = 0;
        for (const finding of findings) {
          if (finding.displaySeverity) counts[finding.displaySeverity] += 1;
          else unclassified += 1;
        }
        const payload = {
          schemaVersion: 1,
          reportId: randomUUID(),
          scannedAt: new Date().toISOString(),
          contract: { filename: input.filename, sourceHash: sha256(input.source), sourceBytes: Buffer.byteLength(input.source, 'utf8') },
          scanner: { name: result.scanner, version: result.scannerVersion, compilerVersion: result.compilerVersion },
          scanStatus: 'completed',
          findings,
          ai: await explainFindings({ enabled: input.includeAi === true, findings, source: input.source }, aiOptions),
          summary: {
            totalFindings: findings.length,
            counts,
            unclassified,
            overallRisk: unclassified ? 'Unclassified findings require review' : severities.find(severity => counts[severity]) ?? 'No findings detected',
          },
          limitations: ['Static analysis findings require review. No findings detected does not establish contract security.',
            'Only self-contained source compiled with Solidity 0.8.28 is supported.'],
        };
        const report = freezeJson({ payload, integrity: { algorithm: 'SHA-256', canonicalization: 'sg-json-v1', hash: hashPayload(payload) } });
        await saveReport(report, directory);
        return report;
      } finally {
        scanning = false;
      }
    },
    get(id) { return loadReport(id, directory); },
  };
}
