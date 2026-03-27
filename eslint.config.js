import js from "@eslint/js";
import globals from "globals";
import dsljsPlugin from "./eslint/dsljs-processor.js";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/.git/**",
      "**/*.js",
      "!**/*.dsljs"
    ]
  },
  {
    files: ["**/*.dsljs"],
    ...js.configs.recommended,
    plugins: {
      dsljs: dsljsPlugin
    },
    processor: "dsljs/processor",
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        THREE: "readonly"
      }
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { args: "none", ignoreRestSiblings: true }]
    }
  }
];
