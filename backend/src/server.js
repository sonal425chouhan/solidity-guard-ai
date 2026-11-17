import { validateToolchain } from './scanner-toolchain.js';
import { app } from './app.js';
import { cleanupStaleScans } from './scanner-files.js';

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
await cleanupStaleScans();
try { await validateToolchain(); }
catch { console.warn('Scanner tooling is unavailable or differs from the pinned versions. Follow README installation instructions.'); }
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`SolidityGuard API: http://127.0.0.1:${port}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
