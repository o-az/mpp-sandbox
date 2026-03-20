import { cloudflare } from "@cloudflare/vite-plugin"
import { defineConfig } from "vite"

export default defineConfig(({ mode }) => {
  if (mode === "client") {
    return {
      build: {
        rollupOptions: {
          input: "./src/client.ts",
          output: {
            entryFileNames: "static/client.js"
          }
        }
      }
    }
  }
  return {
    plugins: [cloudflare()]
  }
})
