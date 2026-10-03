import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://portal_owner:portal_owner@localhost:5432/portal_test",
      APP_URL: "http://localhost:3000",
      RAZORPAY_KEY_ID: "",
      RAZORPAY_KEY_SECRET: "",
      SMTP_HOST: "",
    },
  },
});
