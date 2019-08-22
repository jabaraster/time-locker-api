
export enum GameMode {
  Normal = "Normal",
  Hard = "Hard",
}

export function parseGameMode(mode?: string): GameMode {
  const m = mode ? mode.toUpperCase() : mode;
  console.log(m);
  return m === "HARD" ? GameMode.Hard : GameMode.Normal;
}