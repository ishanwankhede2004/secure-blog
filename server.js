'use strict';

const { createApp } = require('./src/app');
const { ensureAdmin } = require('./src/bootstrap');
const { seedDemoContent } = require('./src/demo');

async function main() {
  const app = createApp();
  const { config, store, server } = app;

  await ensureAdmin(store, config);
  if (config.seedDemo) await seedDemoContent(store, config);

  server.listen(config.port, config.host, () => {
    console.log(`${config.siteName} running on http://${config.host}:${config.port} (${config.isProd ? 'production' : 'development'})`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down`);
    app.close().then(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
