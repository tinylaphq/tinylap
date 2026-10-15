// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Production: node server/main.js, configured by the environment (config.js).
// Development: pnpm dev (TINYLAP_DEV=1, issuer http://localhost:4100, an
// in-memory database unless TINYLAP_DB says otherwise).
import { createServer } from 'node:http';
import { readConfig } from './config.js';
import { createAccounts } from './app.js';

let config;
try {
  config = readConfig(process.env);
} catch (error) {
  console.error(`accounts: ${error.message}`);
  process.exit(1);
}

const accounts = await createAccounts(config);
const host = config.dev ? '127.0.0.1' : '0.0.0.0';
const server = createServer(accounts.handler).listen(config.port, host, () =>
  console.log(`accounts on http://${host}:${config.port}, issuer ${config.issuer}${config.dev ? ' (dev)' : ''}`));

// Stop accepting, finish what is in flight, close the database, leave.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => {
      accounts.close();
      process.exit(0);
    });
    server.closeIdleConnections();
  });
}
