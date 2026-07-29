import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execSync } from "child_process";
import { componentTagger } from "lovable-tagger";

// Git short SHA baked into the bundle (?debug=1 overlay shows it), so "which
// build did the phone actually run" is never guesswork again. Falls back for
// environments without git (Lovable sandbox).
function buildId(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "nogit";
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
  },
  // GitHub Pages serves the app from /<repo>/; the Pages workflow sets
  // VITE_BASE. Local dev and Lovable builds stay at "/".
  base: process.env.VITE_BASE || "/",
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    {
      name: 'html-cache-bust',
      transformIndexHtml(html: string) {
        const buildVersion = Date.now().toString();
        // Inject build version for cache-bust script
        html = html.replace(/__BUILD_VERSION__/g, buildVersion);
        // Also cache-bust the main script tag
        html = html.replace(
          /src="\/src\/main\.tsx(?:\?v=\d+)?"/,
          `src="/src/main.tsx?v=${buildVersion}"`
        );
        return html;
      },
      configureServer(server: any) {
        server.middlewares.use((req: any, res: any, next: any) => {
          if (req.url === '/' || req.url?.startsWith('/?') || req.url?.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
          }
          next();
        });
      },
    },
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
}));
