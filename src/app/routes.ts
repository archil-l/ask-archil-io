import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/_index.tsx"),
  route("api/jwt-token", "routes/api/jwt-token.ts"),
  route("sandbox", "routes/sandbox.ts"),
] satisfies RouteConfig;
