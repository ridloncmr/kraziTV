import { access } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

export type SpikeConfig = {
  ffmpegPath: string;
  mediaAPath: string;
  mediaBPath: string;
  mediaDurationMs: number;
  publicBaseUrl: string;
  host: string;
  port: number;
};

type PrerequisiteDependencies = {
  accessFile(path: string): Promise<void>;
  inspectFfmpeg(path: string): string;
  identifyAsset(path: string): Promise<string>;
};

const GENERATE_ASSETS_COMMAND =
  "npm run assets --workspace @krazitv/plex-spike";
const GENERATED_ASSET_DURATION_MS = 30_000;

/** Parses explicit spike inputs so local paths never become product defaults. */
export function loadSpikeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): SpikeConfig {
  const mediaAPath = requiredAssetPath(
    environment.KRAZITV_SPIKE_MEDIA_A_PATH,
    "KRAZITV_SPIKE_MEDIA_A_PATH",
  );
  const mediaBPath = requiredAssetPath(
    environment.KRAZITV_SPIKE_MEDIA_B_PATH,
    "KRAZITV_SPIKE_MEDIA_B_PATH",
  );
  const port = positiveInteger(
    environment.KRAZITV_SPIKE_PORT ?? "3000",
    "KRAZITV_SPIKE_PORT",
  );
  const publicBaseUrl = normalizePublicBaseUrl(
    environment.KRAZITV_SPIKE_PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`,
  );

  return {
    ffmpegPath: environment.KRAZITV_SPIKE_FFMPEG_PATH ?? "ffmpeg",
    mediaAPath,
    mediaBPath,
    mediaDurationMs: GENERATED_ASSET_DURATION_MS,
    publicBaseUrl,
    host: environment.KRAZITV_SPIKE_HOST ?? "127.0.0.1",
    port,
  };
}

/** Fails before listening when a controlled asset or FFmpeg is unavailable. */
export async function verifySpikePrerequisites(
  config: SpikeConfig,
  overrides: Partial<PrerequisiteDependencies> = {},
): Promise<{
  ffmpegVersion: string;
  assets: readonly { path: string; sha256: string }[];
}> {
  const dependencies: PrerequisiteDependencies = {
    accessFile: async (path) => access(path),
    inspectFfmpeg: inspectFfmpegVersion,
    identifyAsset,
    ...overrides,
  };
  for (const mediaPath of [config.mediaAPath, config.mediaBPath]) {
    try {
      await dependencies.accessFile(mediaPath);
    } catch (cause) {
      throw new Error(
        `Spike asset is not readable: ${mediaPath}. Generate controlled assets with \`${GENERATE_ASSETS_COMMAND}\`, then configure both KRAZITV_SPIKE_MEDIA_A_PATH and KRAZITV_SPIKE_MEDIA_B_PATH.`,
        { cause },
      );
    }
  }

  let ffmpegVersion: string;
  try {
    ffmpegVersion = dependencies.inspectFfmpeg(config.ffmpegPath);
  } catch (cause) {
    throw new Error(
      `FFmpeg is unavailable. Install FFmpeg or set KRAZITV_SPIKE_FFMPEG_PATH to a working executable (currently ${config.ffmpegPath}).`,
      { cause },
    );
  }

  const assets = await Promise.all(
    [config.mediaAPath, config.mediaBPath].map(async (path) => {
      try {
        return { path, sha256: await dependencies.identifyAsset(path) };
      } catch (cause) {
        throw new Error(
          `Could not calculate the SHA-256 identity of ${path}.`,
          {
            cause,
          },
        );
      }
    }),
  );
  return { ffmpegVersion, assets };
}

/** Gives each generated input a durable identity for the spike record. */
async function identifyAsset(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

/** Captures the exact FFmpeg identity used by the disposable experiment. */
function inspectFfmpegVersion(path: string): string {
  const result = spawnSync(path, ["-version"], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() || `FFmpeg exited with ${result.status}`,
    );
  }
  return result.stdout.split(/\r?\n/, 1)[0] ?? "unknown FFmpeg version";
}

/** Explains how to create controlled media when a required path is absent. */
function requiredAssetPath(value: string | undefined, name: string): string {
  if (value?.trim()) return value;
  throw new Error(
    `${name} is required. Run \`${GENERATE_ASSETS_COMMAND}\` and set the generated asset paths.`,
  );
}

/** Rejects misleading tuner URLs before Plex persists them. */
function normalizePublicBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      "KRAZITV_SPIKE_PUBLIC_BASE_URL must be an absolute HTTP URL reachable by Plex.",
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      "KRAZITV_SPIKE_PUBLIC_BASE_URL must be an absolute HTTP URL reachable by Plex.",
    );
  }
  if (
    parsed.pathname !== "/" ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new Error(
      "KRAZITV_SPIKE_PUBLIC_BASE_URL must not contain a path, query, or fragment because spike routes are mounted at the root.",
    );
  }
  return value.replace(/\/+$/, "");
}

/** Keeps timer and media duration inputs within runtime integer contracts. */
function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}
