export interface BrowserWakePlan {
  executable: string;
  arguments: string[];
}

export function planBrowserWake(executables: string[]): BrowserWakePlan | undefined {
  const executable = executables[0];
  return executable
    ? { executable, arguments: ["--no-startup-window"] }
    : undefined;
}
