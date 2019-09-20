
export enum GameMode {
  Normal = "Normal",
  Hard = "Hard",
}

export function parseGameMode(mode?: string): GameMode {
  const m = mode ? mode.toUpperCase() : mode;
  return m === "HARD" ? GameMode.Hard : GameMode.Normal;
}