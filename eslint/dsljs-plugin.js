import js from "@eslint/js";
import path from "node:path";
import globals from "globals";
import ts from "typescript";
import tseslint from "typescript-eslint";

import {
  stripMacrosBlockPreserveLines,
  parseMacrosFromBlock,
  expandMacros
} from "../src/parser.js";

const DSL_FILE_PATTERNS = ["**/*.dsljs", "**/*.idsl"];
const GENERATED_FILE_PATTERNS = ["**/*.generated.js", "**/*.generated.ts"];
const DSL_EXTRA_FILE_EXTENSIONS = [".dsljs", ".idsl"];
const DSL_GLOBALS = {
  ...globals.browser,
  ...globals.node,
  THREE: "readonly"
};
const UNUSED_VARS_RULE = ["warn", { args: "none", ignoreRestSiblings: true }];
const TSCONFIG_CANDIDATES = [
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.node.json",
  "tsconfig.base.json"
];

export function expandDsljsForLint(source) {
  return withMutedConsole(() => {
    const { macrosBlock, output } = stripMacrosBlockPreserveLines(source);
    const macros = parseMacrosFromBlock(macrosBlock);
    return expandMacros(output, macros);
  });
}

function withMutedConsole(fn) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};

  try {
    return fn();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

export const processor = {
  meta: {
    name: "dsljs/processor"
  },
  preprocess(text) {
    return [expandDsljsForLint(text)];
  },
  postprocess(messageLists) {
    return messageLists[0] ?? [];
  },
  supportsAutofix: false
};

function isDslFilename(fileName) {
  return fileName.endsWith(".dsljs") || fileName.endsWith(".idsl");
}

function findNearestTsconfig(fileName) {
  let currentDir = path.dirname(path.resolve(fileName));

  while (true) {
    for (const candidate of TSCONFIG_CANDIDATES) {
      const configPath = path.join(currentDir, candidate);
      if (ts.sys.fileExists(configPath)) {
        return configPath;
      }
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

function getLineAndColumn(sourceFile, position) {
  const resolved = sourceFile.getLineAndCharacterOfPosition(position);
  return {
    line: resolved.line + 1,
    column: resolved.character + 1
  };
}

function getDiagnosticRange(sourceFile, diagnostic) {
  const start = diagnostic.start ?? 0;
  const end = start + Math.max(diagnostic.length ?? 1, 1);

  return {
    start: getLineAndColumn(sourceFile, start),
    end: getLineAndColumn(sourceFile, end)
  };
}

function loadTypeScriptDiagnostics(sourceText, originalFileName) {
  const tsconfigPath = findNearestTsconfig(originalFileName);
  if (!tsconfigPath) {
    return [];
  }

  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    return [configFile.error];
  }

  const configDir = path.dirname(tsconfigPath);
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    configDir,
    {
      noEmit: true,
      allowNonTsExtensions: true
    },
    tsconfigPath
  );

  const virtualFileName = `${path.resolve(originalFileName)}.ts`;
  const compilerOptions = {
    ...parsed.options,
    noEmit: true,
    allowNonTsExtensions: true
  };

  const baseHost = ts.createCompilerHost(compilerOptions, true);
  const normalizedVirtualFileName = path.normalize(virtualFileName);

  const host = {
    ...baseHost,
    fileExists(fileName) {
      if (path.normalize(fileName) === normalizedVirtualFileName) {
        return true;
      }

      return baseHost.fileExists(fileName);
    },
    readFile(fileName) {
      if (path.normalize(fileName) === normalizedVirtualFileName) {
        return sourceText;
      }

      return baseHost.readFile(fileName);
    },
    getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) {
      if (path.normalize(fileName) === normalizedVirtualFileName) {
        return ts.createSourceFile(
          fileName,
          sourceText,
          languageVersion,
          true,
          ts.ScriptKind.TS
        );
      }

      return baseHost.getSourceFile(
        fileName,
        languageVersion,
        onError,
        shouldCreateNewSourceFile
      );
    }
  };

  const rootNames = [
    ...parsed.fileNames.filter(fileName => path.normalize(fileName) !== normalizedVirtualFileName),
    virtualFileName
  ];

  const program = ts.createProgram({
    rootNames,
    options: compilerOptions,
    host,
    projectReferences: parsed.projectReferences
  });
  const sourceFile = program.getSourceFile(virtualFileName);

  if (!sourceFile) {
    return [];
  }

  return [
    ...program.getSyntacticDiagnostics(sourceFile),
    ...program.getSemanticDiagnostics(sourceFile)
  ];
}

const typecheckRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Report TypeScript diagnostics for expanded .dsljs files."
    },
    schema: []
  },
  create(context) {
    const fileName = context.physicalFilename ?? context.filename;
    if (!fileName || fileName === "<text>" || !isDslFilename(fileName)) {
      return {};
    }

    return {
      Program(node) {
        const diagnostics = loadTypeScriptDiagnostics(
          context.sourceCode.text,
          fileName
        );

        for (const diagnostic of diagnostics) {
          const message = ts.flattenDiagnosticMessageText(
            diagnostic.messageText,
            "\n"
          );

          if (diagnostic.file) {
            const range = getDiagnosticRange(diagnostic.file, diagnostic);
            context.report({
              node,
              loc: range,
              message
            });
            continue;
          }

          context.report({
            node,
            loc: {
              start: { line: 1, column: 1 },
              end: { line: 1, column: 1 }
            },
            message
          });
        }
      }
    };
  }
};

const plugin = {
  meta: {
    name: "dsljs"
  },
  processors: {
    processor
  },
  rules: {
    typecheck: typecheckRule
  }
};

function withFiles(config, files = DSL_FILE_PATTERNS) {
  return {
    ...config,
    files
  };
}

function createDslBaseConfig(overrides = {}) {
  return {
    files: DSL_FILE_PATTERNS,
    plugins: {
      dsljs: plugin,
      ...(overrides.plugins ?? {})
    },
    processor: "dsljs/processor",
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: DSL_GLOBALS,
      ...(overrides.languageOptions ?? {})
    },
    rules: {
      ...(overrides.rules ?? {})
    }
  };
}

const recommendedConfig = [
  {
    ignores: GENERATED_FILE_PATTERNS
  },
  {
    ...js.configs.recommended,
    ...createDslBaseConfig({
      rules: {
        ...js.configs.recommended.rules,
        "no-undef": "error",
        "no-unused-vars": UNUSED_VARS_RULE
      }
    })
  }
];

const recommendedTypeScriptConfig = [
  {
    ignores: GENERATED_FILE_PATTERNS
  },
  ...tseslint.configs.recommended.map(config => withFiles(config)),
  createDslBaseConfig({
    plugins: {
      "@typescript-eslint": tseslint.plugin
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        extraFileExtensions: DSL_EXTRA_FILE_EXTENSIONS
      }
    },
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": UNUSED_VARS_RULE
    }
  })
];

const recommendedTypeCheckedConfig = [
  {
    ignores: GENERATED_FILE_PATTERNS
  },
  ...tseslint.configs.recommendedTypeChecked.map(config => withFiles(config)),
  createDslBaseConfig({
    plugins: {
      "@typescript-eslint": tseslint.plugin
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        extraFileExtensions: DSL_EXTRA_FILE_EXTENSIONS,
        projectService: true
      }
    },
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": UNUSED_VARS_RULE,
      "dsljs/typecheck": "error"
    }
  })
];

plugin.configs = {
  recommended: recommendedConfig,
  recommendedTypeScript: recommendedTypeScriptConfig,
  recommendedTypeChecked: recommendedTypeCheckedConfig
};

export default plugin;
