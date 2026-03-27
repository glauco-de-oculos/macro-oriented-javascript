import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");
const consumerRoot = path.resolve(process.env.INIT_CWD || process.cwd());
const extensionSourceDir = path.join(packageRoot, "editor", "dsljs-tools");

function log(message) {
  console.log(`[dsljs:vscode] ${message}`);
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback) {
  if (!exists(filePath)) return fallback;

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    log(`Skipping invalid JSON file: ${filePath} (${error.message})`);
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function copyDir(sourceDir, targetDir) {
  ensureDir(targetDir);

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyDir(sourcePath, targetPath);
      continue;
    }

    fs.copyFileSync(sourcePath, targetPath);
  }
}

function getVsCodeExtensionsDirs() {
  const home = os.homedir();
  if (!home) return [];

  if (process.env.VSCODE_EXTENSIONS_DIR) {
    return [process.env.VSCODE_EXTENSIONS_DIR];
  }

  return [
    path.join(home, ".vscode", "extensions"),
    path.join(home, ".vscode-oss", "extensions")
  ];
}

function removeMatchingDirs(parentDir, patterns) {
  if (!exists(parentDir)) return;

  for (const entry of fs.readdirSync(parentDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!patterns.some(pattern => pattern.test(entry.name))) continue;

    fs.rmSync(path.join(parentDir, entry.name), { recursive: true, force: true });
    log(`Removed old VS Code extension ${entry.name} from ${parentDir}`);
  }
}

function installBundledExtension() {
  const extensionPackagePath = path.join(extensionSourceDir, "package.json");
  if (!exists(extensionPackagePath)) {
    log("Bundled VS Code extension not found; skipping extension installation.");
    return;
  }

  const manifest = readJson(extensionPackagePath, null);
  if (!manifest?.publisher || !manifest?.name || !manifest?.version) {
    log("Bundled VS Code extension manifest is incomplete; skipping extension installation.");
    return;
  }

  const extensionsDirs = getVsCodeExtensionsDirs();
  if (!extensionsDirs.length) {
    log("Could not determine the VS Code extensions directories.");
    return;
  }

  for (const extensionsDir of extensionsDirs) {
    ensureDir(extensionsDir);
    removeMatchingDirs(extensionsDir, [
      /^local\.dsljs-tools-/u,
      /^local\.idsl-tools-/u
    ]);

    const targetDir = path.join(
      extensionsDir,
      `${manifest.publisher}.${manifest.name}-${manifest.version}`
    );

    fs.rmSync(targetDir, { recursive: true, force: true });
    copyDir(extensionSourceDir, targetDir);
    log(`Installed bundled VS Code extension to ${targetDir}`);
  }
}

function mergeUniqueStrings(currentValue, additions) {
  const current = Array.isArray(currentValue) ? currentValue : [];
  return [...new Set([...current, ...additions])];
}

function mergeObjectMap(currentValue, additions) {
  return {
    ...(currentValue && typeof currentValue === "object" ? currentValue : {}),
    ...additions
  };
}

function setupWorkspaceFiles() {
  const vscodeDir = path.join(consumerRoot, ".vscode");
  ensureDir(vscodeDir);

  const settingsPath = path.join(vscodeDir, "settings.json");
  const extensionsPath = path.join(vscodeDir, "extensions.json");

  const settings = readJson(settingsPath, {});
  settings["files.associations"] = mergeObjectMap(settings["files.associations"], {
    "*.idsl": "idsl",
    "*.dsljs": "idsl"
  });
  settings["explorer.fileNesting.patterns"] = mergeObjectMap(
    settings["explorer.fileNesting.patterns"],
    {
      "*.idsl": "$(capture).generated.js",
      "*.dsljs": "$(capture).generated.js"
    }
  );
  settings["eslint.validate"] = mergeUniqueStrings(settings["eslint.validate"], [
    "javascript",
    "idsl"
  ]);
  settings["eslint.probe"] = mergeUniqueStrings(settings["eslint.probe"], [
    "javascript",
    "idsl"
  ]);
  if (!Array.isArray(settings["eslint.workingDirectories"])) {
    settings["eslint.workingDirectories"] = [{ mode: "auto" }];
  }
  if (settings["eslint.useFlatConfig"] === undefined) {
    settings["eslint.useFlatConfig"] = true;
  }

  const extensions = readJson(extensionsPath, {});
  extensions.recommendations = mergeUniqueStrings(extensions.recommendations, [
    "dbaeumer.vscode-eslint"
  ]);

  writeJson(settingsPath, settings);
  writeJson(extensionsPath, extensions);
  log(`Updated VS Code workspace files in ${vscodeDir}`);
}

function setupEslintConfig() {
  const existingConfigPaths = [
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.cjs"
  ]
    .map(fileName => path.join(consumerRoot, fileName))
    .filter(filePath => exists(filePath));

  if (existingConfigPaths.length) {
    log(`Keeping existing ESLint config in ${existingConfigPaths[0]}`);
    return;
  }

  const eslintConfigPath = path.join(consumerRoot, "eslint.config.mjs");

  const contents = [
    'import dsljsConfig from "dsljs/eslint-config";',
    "",
    "export default dsljsConfig;",
    ""
  ].join("\n");

  fs.writeFileSync(eslintConfigPath, contents, "utf8");
  log(`Created ESLint config proxy in ${eslintConfigPath}`);
}

function setupJsConfig() {
  const tsConfigPaths = [
    "tsconfig.json",
    "tsconfig.base.json",
    "jsconfig.json"
  ]
    .map(fileName => path.join(consumerRoot, fileName))
    .filter(filePath => exists(filePath));

  if (tsConfigPaths.length) {
    log(`Keeping existing JS/TS config in ${tsConfigPaths[0]}`);
    return;
  }

  const jsConfigPath = path.join(consumerRoot, "jsconfig.json");
  const contents = {
    exclude: ["**/*.generated.js"]
  };

  writeJson(jsConfigPath, contents);
  log(`Created JS config to exclude generated files in ${jsConfigPath}`);
}

function shouldSkip() {
  return process.env.CI === "true" || process.env.DSLJS_SKIP_VSCODE_SETUP === "1";
}

if (shouldSkip()) {
  log("Skipping VS Code setup because the environment requested it.");
} else {
  installBundledExtension();
  setupWorkspaceFiles();
  setupEslintConfig();
  setupJsConfig();
}
