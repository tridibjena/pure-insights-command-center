import { loadConfig } from './config.js';
import { createServer } from './server.js';

const config = loadConfig();
const { server, replayer, logger, close } = createServer(config);
replayer.preload().catch((err) => logger.warn({ err }, 'replay data not loaded yet — run `npm run pipeline`'));

server.listen(config.port, () => {
  logger.info(`Pure Insights Command Center API listening on http://localhost:${config.port}`);
  if (config.replay.autostart) replayer.start().catch((err) => logger.error({ err }, 'replay autostart failed'));
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    logger.info(`${signal} received, shutting down`);
    await close();
    process.exit(0);
  });
}
