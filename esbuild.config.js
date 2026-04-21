import { build } from "esbuild";
import { writeFileSync, mkdirSync, copyFileSync, chmodSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Common external modules
const commonExternal = [
  // AWS Lambda runtime APIs
  "@aws-sdk/*",
  // Node.js built-ins
  "fs",
  "path",
  "stream",
  "util",
  "crypto",
  "os",
  "buffer",
  "events",
  "http",
  "https",
  "zlib",
  "net",
  "tls",
  "dns",
  "child_process",
  "async_hooks",
];

// Build web app Lambda
const buildWebApp = build({
  entryPoints: ["deployment/server.js"],
  bundle: true,
  outfile: "dist/lambda-pkg/index.js",
  platform: "node",
  format: "cjs",
  target: "node24",
  external: commonExternal,
  minify: true,
  sourcemap: false,
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});

// Build streaming Lambda
const buildStreaming = build({
  entryPoints: ["deployment/streaming.js"],
  bundle: true,
  outfile: "dist/streaming-lambda/streaming-handler.js",
  platform: "node",
  format: "cjs",
  target: "node24",
  external: commonExternal,
  minify: true,
  sourcemap: false,
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});

// Build MCP proxy Lambda
const buildMcpProxy = build({
  entryPoints: ["deployment/mcp-proxy.js"],
  bundle: true,
  outfile: "dist/mcp-proxy-lambda/mcp-proxy-handler.js",
  platform: "node",
  format: "cjs",
  target: "node24",
  external: commonExternal,
  minify: true,
  sourcemap: false,
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});

// Run all builds in parallel
Promise.all([buildWebApp, buildStreaming, buildMcpProxy])
  .then(() => {
    // Create package.json files to mark the Lambda packages as CommonJS modules
    writeFileSync(
      "dist/lambda-pkg/package.json",
      JSON.stringify({ type: "commonjs" }, null, 2),
    );

    // Ensure streaming lambda directory exists
    mkdirSync("dist/streaming-lambda", { recursive: true });
    writeFileSync(
      "dist/streaming-lambda/package.json",
      JSON.stringify({ type: "commonjs" }, null, 2),
    );

    // Ensure mcp-proxy lambda directory exists
    mkdirSync("dist/mcp-proxy-lambda", { recursive: true });
    writeFileSync(
      "dist/mcp-proxy-lambda/package.json",
      JSON.stringify({ type: "commonjs" }, null, 2),
    );

    // Copy run.sh bootstrap script for Lambda Web Adapter
    const runShSrc = join(__dirname, "src/app/run.sh");
    const runShDest = join(__dirname, "dist/lambda-pkg/run.sh");
    copyFileSync(runShSrc, runShDest);
    chmodSync(runShDest, 0o755);
    console.log("📜 Copied run.sh bootstrap script");

    console.log("✅ Built web app Lambda: dist/lambda-pkg/index.js");
    console.log(
      "✅ Built streaming Lambda: dist/streaming-lambda/streaming-handler.js",
    );
    console.log(
      "✅ Built MCP proxy Lambda: dist/mcp-proxy-lambda/mcp-proxy-handler.js",
    );
  })
  .catch((error) => {
    console.error("Build failed:", error);
    process.exit(1);
  });
