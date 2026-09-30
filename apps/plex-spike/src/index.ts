import { buildSpikeServer } from "./app.js";
import { loadSpikeConfig, verifySpikePrerequisites } from "./config.js";
import { createSpikeManager } from "./runtime.js";
import { installShutdownHandlers } from "./shutdown.js";

const config = loadSpikeConfig();
const prerequisites = await verifySpikePrerequisites(config);
const manager = createSpikeManager(config);
const server = buildSpikeServer({
  logger: true,
  manager,
  publicBaseUrl: config.publicBaseUrl,
});
installShutdownHandlers(server);

server.log.info(
  {
    ffmpegVersion: prerequisites.ffmpegVersion,
    assets: prerequisites.assets,
    publicBaseUrl: config.publicBaseUrl,
  },
  "SIG-010 Plex spike prerequisites verified",
);

await server.listen({ host: config.host, port: config.port });
