import {
  stripMacrosBlockPreserveLines,
  parseMacrosFromBlock,
  expandMacros
} from "../src/parser.js";

function expandDsljsForLint(source) {
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

const processor = {
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

export default {
  processors: {
    processor
  }
};
