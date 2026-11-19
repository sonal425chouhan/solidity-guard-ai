// Browser tests use real Slither/storage/registry and explicitly disable paid AI.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../../backend/src/app.js";

const directory = await mkdtemp(path.join(tmpdir(), "sg-browser-"));
const server = createApp({ directory, aiOptions: { apiKey: "" } }).listen(
  3001,
  "127.0.0.1",
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.close(async () => {
      await rm(directory, { recursive: true, force: true });
      process.exit(0);
    });
  });
