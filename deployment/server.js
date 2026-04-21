import { createRequestHandler } from "@react-router/express";
import compression from "compression";
import express from "express";
import morgan from "morgan";

const app = express();

app.use(compression());

// Parse JSON for API routes
app.use(express.json());

// http://expressjs.com/en/advanced/best-practice-security.html#at-a-minimum-disable-x-powered-by-header
app.disable("x-powered-by");

// In production Lambda, redirect asset requests to CloudFront
const cloudfrontUrl = process.env.CLOUDFRONT_URL;
if (cloudfrontUrl) {
  app.use("/assets", (req, res) => {
    res.redirect(302, `${cloudfrontUrl}/assets${req.path}`);
  });
  app.use("/favicon.ico", (req, res) => {
    res.redirect(302, `${cloudfrontUrl}/favicon.ico`);
  });
  app.use("/logo-dark.png", (req, res) => {
    res.redirect(302, `${cloudfrontUrl}/logo-dark.png`);
  });
  app.use("/profile-pic-og.png", (req, res) => {
    res.redirect(302, `${cloudfrontUrl}/profile-pic-og.png`);
  });
  app.use("/robots.txt", (req, res) => {
    res.redirect(302, `${cloudfrontUrl}/robots.txt`);
  });
  app.use("/sitemap.xml", (req, res) => {
    res.redirect(302, `${cloudfrontUrl}/sitemap.xml`);
  });
  app.use("/theme-init.js", (req, res) => {
    res.redirect(302, `${cloudfrontUrl}/theme-init.js`);
  });
  app.use("/sandbox.html", (req, res) => {
    res.redirect(302, `${cloudfrontUrl}/sandbox.html`);
  });
  app.use("/fonts", (req, res) => {
    res.redirect(302, `${cloudfrontUrl}/fonts${req.path}`);
  });
  app.use("/avatars", (req, res) => {
    res.redirect(302, `${cloudfrontUrl}/avatars${req.path}`);
  });
} else {
  // Fallback to local assets if CloudFront URL is not available
  app.use(
    "/assets",
    express.static("build/client/assets", { immutable: true, maxAge: "1y" }),
  );
  app.use(express.static("build/client", { maxAge: "1h" }));
}

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
