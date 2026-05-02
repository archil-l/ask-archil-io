import { createRequestHandler } from "@react-router/express";
import compression from "compression";
import express from "express";
import morgan from "morgan";

const app = express();

// Trust CloudFront/API Gateway proxy headers so req.hostname and req.protocol
// reflect the public-facing values (ask.archil.io, https) rather than the
// internal API Gateway hostname.
app.set("trust proxy", true);

app.use(compression());

// Parse JSON for API routes
app.use(express.json());

// http://expressjs.com/en/advanced/best-practice-security.html#at-a-minimum-disable-x-powered-by-header
app.disable("x-powered-by");

// Serve assets from filesystem (local dev; in production CloudFront handles these paths)
app.use(
  "/assets",
  express.static("build/client/assets", { immutable: true, maxAge: "1y" }),
);
app.use(express.static("build/client", { maxAge: "1h" }));

app.use(morgan("tiny"));

// Lazy-load the SSR handler to avoid top-level await
let routerHandler = null;

async function getRouterHandler() {
  if (!routerHandler) {
    const build = await import("../dist/server/index.js");
    routerHandler = createRequestHandler({ build });
  }
  return routerHandler;
}

// handle SSR requests
app.use(async (req, res, next) => {
  try {
    const handler = await getRouterHandler();
    return handler(req, res, next);
  } catch (error) {
    next(error);
  }
});

const PORT = parseInt(process.env.PORT || "8080", 10);
app.listen(PORT, () => {
  console.log(`Web app listening on port ${PORT}`);
});
