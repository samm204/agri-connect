'use strict';
const os = require('os');
const { open } = require('./src/db');
const { createApp } = require('./src/app');

const PORT = Number(process.env.PORT) || 3000;
const db = open();
const server = createApp(db);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`AgriConnect running (${process.env.NODE_ENV || 'development'})`);
  console.log(`Open in a browser: http://localhost:${PORT}`);
  const addresses = Object.values(os.networkInterfaces()).flat()
    .filter((address) => address && !address.internal && (address.family === 'IPv4' || address.family === 4))
    .map((address) => address.address);
  for (const address of [...new Set(addresses)]) {
    console.log(`Other devices on your network: http://${address}:${PORT}`);
  }
});

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
