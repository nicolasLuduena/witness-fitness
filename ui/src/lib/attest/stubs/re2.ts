// Browser shim for the `re2` native regex addon (attestor-core dynamically
// imports it: `import("re2").then((m) => { RE2 = m.default; })` then calls
// `RE2(str, "sgiu")` in makeRegex, falling back to `new RegExp` only when
// RE2 is falsy). The native addon can't load in the browser, so the shim is
// a callable that returns a native RegExp — identical semantics to re2's
// function-style API, and `new` works too. Alias: `re2` → this file.
function re2Shim(pattern: string, flags?: string): RegExp {
  return new RegExp(pattern, flags);
}

export default re2Shim;
