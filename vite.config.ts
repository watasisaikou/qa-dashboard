import { defineConfig } from "vite";

export default defineConfig({
  base: "/qa-dashboard/",
  server: {
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
