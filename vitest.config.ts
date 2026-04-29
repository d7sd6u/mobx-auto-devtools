import babel from "@rolldown/plugin-babel";
import { defineConfig } from "vitest/config";

function decoratorPreset(options: Record<string, unknown>) {
  return {
    preset: () => ({
      plugins: [["@babel/plugin-proposal-decorators", options]],
    }),
    rolldown: {
      // Only run this transform if the file contains a decorator.
      filter: {
        code: "@",
      },
    },
  };
}
export default defineConfig({
  plugins: [babel({ presets: [decoratorPreset({ version: "2023-11" })] })],
  test: {
    // ...
  },
});
