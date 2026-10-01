// The child-process port media (ffprobe) and signal (FFmpeg) spawn through.
export type {
  ProcessExit,
  ProcessSpawner,
  ProcessSpawnRequest,
  ProcessTerminationSignal,
  SpawnedProcess,
} from "./child-process/contracts.js";
export { NodeProcessSpawner } from "./child-process/node-process-spawner.js";
