import { defineConfig } from "vite";

export default defineConfig({
  base: "/physicsLAB/",
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        schrodinger: "schrodinger.html",
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});
