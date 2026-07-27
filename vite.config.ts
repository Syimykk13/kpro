import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    host: "0.0.0.0",
    port: 5173
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        cash: path.resolve(__dirname, "cash/index.html"),
        admin: path.resolve(__dirname, "admin/index.html"),
        control: path.resolve(__dirname, "control/index.html")
      }
    }
  }
});
