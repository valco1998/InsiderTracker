import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // injectManifest lets us write our own sw.js that includes
      // both workbox precaching and Firebase Cloud Messaging.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",

      registerType: "autoUpdate",
      includeAssets: ["telIcon.png", "icons/icon-192.png", "icons/icon-512.png"],

      devOptions: {
        enabled: true,
        type: "module",
      },

      manifest: {
        name: "SkinTel",
        short_name: "SkinTel",
        description: "CS2 skin trading and trade alert platform",
        theme_color: "#050816",
        background_color: "#050816",
        display: "standalone",
        start_url: "/",
        scope: "/",
        id: "/",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],

  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5055",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
