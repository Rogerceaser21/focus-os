import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
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
