// Browser-like simulation test for the injected polyfill header.
// In a real browser, globalThis === window and crypto is a single object.
// Node separates globalThis from a manually-created `window`, so to faithfully
// simulate a non-secure browser we stub globalThis.crypto (no randomUUID),
// which is exactly what the polyfill reads and patches.
const fs = require("fs");
const { randomBytes } = require("crypto");

// Browser: globalThis === window. Simulate by stubbing globalThis.crypto.
// Non-secure context => crypto exists but randomUUID is missing.
Object.defineProperty(globalThis, "crypto", {
  configurable: true,
  value: {
    getRandomValues: (arr) => {
      const b = randomBytes(arr.length);
      for (let i = 0; i < arr.length; i++) arr[i] = b[i];
      return arr;
    },
  },
});
globalThis.window = globalThis;

if (typeof globalThis.crypto.randomUUID === "function") {
  console.error("test setup broken: randomUUID already exists");
  process.exit(1);
}

let loadedId = null;
globalThis.window.__ModuleLoader__ = {
  load: (obj) => { loadedId = obj.id; },
};

const path = "app/server/node_modules/@deepseek-ai/dsh-client-connection/lib/client.js";
const src = fs.readFileSync(path, "utf8");

// Execute only the polyfill header (top IIFE)
const polyEnd = src.indexOf("})();\n") + "})();\n".length;
const header = src.slice(0, polyEnd);
eval(header);

console.log("top-level polyfill executed without error:", true);
console.log("randomUUID installed on globalThis.crypto:", typeof globalThis.crypto.randomUUID === "function");
const ids = new Set();
for (let i = 0; i < 500; i++) ids.add(globalThis.crypto.randomUUID());
console.log("500 generated, unique:", ids.size === 500);
console.log("sample:", globalThis.crypto.randomUUID());
console.log("module loader call preserved:", src.includes("window.__ModuleLoader__.load({"));
