# `@icaroglauco/dsljs`

Compile-time macros for JavaScript.

`@icaroglauco/dsljs` lets you define local DSLs inside a `.dsljs` file and expand them into plain JavaScript before runtime. The generated output is ordinary JavaScript with no additional runtime layer, which makes the tool useful for code generation, structural syntax experiments, and domain-specific authoring workflows.

## Highlights

- Compile custom syntax to standard JavaScript
- Keep macro definitions close to the code that uses them
- Generate deterministic output with zero runtime overhead
- Use the package from the CLI, from Vite, or programmatically
- Add editor and ESLint support for `.dsljs` files

## Installation

For most projects this package should be installed as a development dependency:

```bash
npm install -D @icaroglauco/dsljs
```

The package exposes:

- `dsljs` and `idsl` CLI commands
- `@icaroglauco/dsljs/vite` for Vite integration
- `@icaroglauco/dsljs/eslint-config` for ESLint
- the parser/compiler API from `@icaroglauco/dsljs`

## Quick Start

Create a file named `hello.dsljs`:

```dsl
macros: {

  $macro LOG $msg #(
    console.log("[Macro Log]:", $msg);
  )#

  $macro style($text) #(
    console.log($text);
  )#

}

const project = "dsljs";

LOG `Build completed for ${project}`

style(/*css*/`
  .banner {
    padding: 16px;
    border: 1px solid #d0d7de;
  }
`)
```

Compile it:

```bash
npx dsljs hello.dsljs hello.js
```

Generated output:

```js
const project = "dsljs";

console.log("[Macro Log]:", `Build completed for ${project}`);

console.log(/*css*/`
  .banner {
    padding: 16px;
    border: 1px solid #d0d7de;
  }
`);
```

## How It Works

Each `.dsljs` source file can contain a `macros: { ... }` block. That block declares rewrite rules using `$macro`, and the rest of the file is expanded against those rules during compilation.

At a high level:

1. The compiler reads the `macros: { ... }` block.
2. Macro definitions are parsed into rewrite rules.
3. The remaining file is transformed.
4. The final result is emitted as standard JavaScript.

Macro definitions do not remain in the final output.

## Professional Usage Examples

### 1. Structural Logging and Build-Time CSS

This pattern is useful when you want a concise authoring syntax while still shipping plain JavaScript:

```dsl
macros: {

  $macro LOG $msg #(
    console.log("[Macro Log]:", $msg);
  )#

  $macro style($text) #(
    console.log($text);
  )#

}

LOG `Starting dashboard build`

style(/*css*/`
  #dashboard {
    display: grid;
    gap: 24px;
  }
`)
```

Expanded JavaScript:

```js
console.log("[Macro Log]:", `Starting dashboard build`);

console.log(/*css*/`
  #dashboard {
    display: grid;
    gap: 24px;
  }
`);
```

### 2. Domain-Specific Factory Generation

Macros can encode a business or application-specific construction pattern.

Source:

```dsl
macros: {

  $macro struct game $name[
    types: $types,
    events: $events
  ] => {
    $($prop = $value;)...
  }
  #(
    const $name = function () {
      const types = { $types };
      const events = [ $events ];
      const listeners = Object.fromEntries(
        events.map(eventName => [eventName, []])
      );

      return {
        types: () => types,
        events: () => events,
        listeners: () => listeners,
        on(eventName, listener) {
          if (!listeners[eventName]) {
            listeners[eventName] = [];
          }

          listeners[eventName].push(listener);
        },
        emit(eventName, payload) {
          for (const listener of listeners[eventName] ?? []) {
            listener(payload);
          }
        },
        $($prop: $value,)...
      };
    }
  )#

}

struct game arena[
  types: {
    state: "GameState",
    entity: "Entity",
    player: "Player"
  },
  events: ["boot", "tick", "gameover"]
] => {
  version = "0.1.0";
  initialScene = "forest";
}

const game = arena();
game.emit("boot", { scene: game.initialScene });
```

This style is useful when you want a compact authoring format for repetitive object or module generation.

### 3. HTML-Like Template Authoring

Another good fit is markup-oriented generation:

```dsl
macros: {

  $macro tag [
    $tagname
    { $($attr:$value,)... }
    ( $inner )
  ] #(
    `<${$tagname}
      $(
      ${$attr}=${$value}
      )...
    >
      ${$inner}
    </${$tagname}>`
  )#

}

const card = tag[
  section
  { class: "profile-card", id: "user-42" }
  (
    `<h2>Ana</h2><p>Platform Engineer</p>`
  )
];
```

That gives you a lightweight way to create project-specific view or content syntaxes without introducing a custom runtime.

## CLI

The package ships with the `dsljs` command.

```bash
dsljs <input.dsljs> [output.js]
dsljs dist <srcDir> <outDir>
dsljs watch <src> <out>
dsljs run <file.dsljs> [...args]
dsljs watch-run <file.dsljs> [...args]
dsljs shadow <file.dsljs> [file.generated.js]
dsljs watch-shadow <file.dsljs> [file.generated.js]
```

Common workflows:

Compile a single file:

```bash
npx dsljs src/main.dsljs dist/main.js
```

Print the compiled JavaScript to stdout:

```bash
npx dsljs src/main.dsljs
```

Compile an entire directory:

```bash
npx dsljs dist src dist
```

Watch and rebuild files:

```bash
npx dsljs watch src dist
```

Generate a shadow file for editor tooling:

```bash
npx dsljs shadow src/main.dsljs src/main.generated.js
```

Run a DSL file directly after expansion:

```bash
npx dsljs run scripts/task.dsljs --env production
```

## Vite Integration

Use the Vite plugin when your project imports `.dsljs` files directly.

`vite.config.js`

```js
import { defineConfig } from "vite";
import dsljs from "@icaroglauco/dsljs/vite";

export default defineConfig({
  plugins: [dsljs()]
});
```

Example module:

```js
import "./startup.dsljs";
```

The plugin expands `.dsljs` sources before Vite continues with the rest of the pipeline.

## Programmatic API

The root package exports the compiler helpers from `src/parser.js`.

Compile a source string:

```js
import { compileDslSource } from "@icaroglauco/dsljs";

const source = `
macros: {
  $macro LOG $msg #( console.log($msg); )#
}

LOG "hello"
`;

const output = compileDslSource(source);
console.log(output);
```

Compile from a file:

```js
import { compileDslFile } from "@icaroglauco/dsljs";

const output = compileDslFile("src/main.dsljs");
console.log(output);
```

Low-level helpers such as `stripMacrosBlock`, `parseMacrosFromBlock`, and `expandMacros` are also exported for advanced workflows.

## ESLint

The package includes a ready-to-use flat config for `.dsljs` files:

```js
import dsljsConfig from "@icaroglauco/dsljs/eslint-config";

export default dsljsConfig;
```

This config wires the custom processor and validates `.dsljs` sources through ESLint.

## VS Code Support

On install, the package tries to set up local VS Code support automatically by:

- installing the bundled editor extension locally
- updating `.vscode/settings.json`
- updating `.vscode/extensions.json`
- creating an ESLint config proxy if one does not exist
- creating a minimal `jsconfig.json` if one does not exist

If you need to skip this behavior, set the `DSLJS_SKIP_VSCODE_SETUP=1` environment variable before installation.

The editor support is designed around `.dsljs` and `.idsl` files, while the Vite plugin currently targets `.dsljs` imports.

## Repository Examples

The repository includes real examples you can use as reference:

- `example/example.dsljs`
- `example/game.dsljs`

## Notes

- Expansion happens at compile time, not at runtime
- Generated output is standard JavaScript
- Macro design is intentionally flexible and low-level
- The best results come from keeping macros small, explicit, and domain-focused
