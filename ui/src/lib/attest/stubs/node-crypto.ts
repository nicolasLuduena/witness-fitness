// Vite alias target for `node:crypto` in the browser bundle. Anything in the
// browser graph that imports node:crypto at module scope crashes the page
// (vite externalizes it → the import throws). Contract libraries must not
// import it at all (offchain.ts was fixed to be dependency-free); this stub
// makes any residual import evaluate cleanly and fail loudly only if called.
export const createHash = (): never => {
  throw new Error(
    "node:crypto.createHash is not available in the browser — contract libraries must be browser-pure",
  );
};
export const randomBytes = (): never => {
  throw new Error("node:crypto.randomBytes is not available in the browser");
};
