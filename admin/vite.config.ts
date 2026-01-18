import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import medusaVitePlugin from "@medusajs/admin-vite-plugin";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendUrl = env.MEDUSA_BACKEND_URL || "http://localhost:9000";
  const storefrontUrl = env.MEDUSA_STOREFRONT_URL || "http://localhost:8000";
  const basePathRaw = env.MEDUSA_ADMIN_BASE || "/";
  const basePath = basePathRaw.endsWith("/")
    ? basePathRaw
    : `${basePathRaw}/`;

  return {
    base: basePath,
    plugins: [
      medusaVitePlugin({
        sources: [path.resolve(__dirname, "../backend/src/admin")]
      }),
      react()
    ],
    optimizeDeps: {
      // Skip pre-bundling the dashboard so Vite plugins can resolve Medusa virtual modules.
      exclude: ["@medusajs/dashboard"]
    },
    define: {
      __BASE__: JSON.stringify(basePath),
      __BACKEND_URL__: JSON.stringify(backendUrl),
      __STOREFRONT_URL__: JSON.stringify(storefrontUrl),
      __AUTH_TYPE__: JSON.stringify(env.MEDUSA_AUTH_TYPE || "session"),
      __JWT_TOKEN_STORAGE_KEY__: JSON.stringify(
        env.MEDUSA_JWT_TOKEN_STORAGE_KEY || ""
      )
    },
    server: {
      port: 5173
    }
  };
});
