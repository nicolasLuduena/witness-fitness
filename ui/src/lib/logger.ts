// Structured error logging: every UI catch logs to the browser console with
// a context tag (the UI also displays errors — the console is where WHY
// lives). Global handlers in main.tsx catch everything else.
export const logError = (context: string, err: unknown): void => {
  console.error(`[wf] ${context}`, err instanceof Error ? err : new Error(String(err)));
};

export const logInfo = (context: string, ...args: unknown[]): void => {
  console.info(`[wf] ${context}`, ...args);
};
