#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from "url";
const __filename = fileURLToPath(import.meta.url);

function isMain() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}
// console.log(output)

const DEBUG_REP =
  process.env.DEBUG_REP === "1" ||
  process.env.DEBUG_REP === "true" ||
  false;


const isWSChar = (c) => c === " " || c === "\t" || c === "\r" || c === "\n";
const isIdentChar = (c) => /[A-Za-z0-9_$]/.test(c || "");
const isIdentStartChar = (c) => /[A-Za-z_$]/.test(c || "");
const IDENT_START = "[A-Za-z_\\p{L}]";
const IDENT_CONT  = "[A-Za-z0-9_\\p{L}]";
const PH_RE = new RegExp(`\\$(${IDENT_START}${IDENT_CONT}*)\\b`, "gu");
const PH_INNER_RE = new RegExp(`\\$(${IDENT_START}${IDENT_CONT}*)`, "gu"); // sem \\b (pra template)


function skipWS(src, i) {
  while (i < src.length && isWSChar(src[i])) i++;
  return i;
}

function readString(src, i) {
  const q = src[i];
  let j = i + 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === "\\" && j + 1 < src.length) { j += 2; continue; }
    if (ch === q) { j++; break; }
    j++;
  }
  return { ok: true, text: src.slice(i, j), next: j };
}

function readBalanced(src, i, open, close) {
  let j = i;
  let depth = 0;

  while (j < src.length) {
    const ch = src[j];

    if (ch === '"' || ch === "'" || ch === "`") {
      const s = readString(src, j);
      j = s.next;
      continue;
    }

    if (ch === open) depth++;
    if (ch === close) {
      depth--;
      if (depth === 0) {
        j++;
        break;
      }
    }

    j++;
  }

  if (depth !== 0) {
    return { ok: false };
  }

  return {
    ok: true,
    text: src.slice(i, j),
    next: j
  };
}


// átomo do DSL: string, bloco balanceado, ou token até separador
function readAtom(src, i) {
  i = skipWS(src, i);
  if (i >= src.length) {
    return { ok: false };
  }

  const ch = src[i];

  if (ch === '"' || ch === "'" || ch === "`") return readString(src, i);
  if (ch === "[") return readBalanced(src, i, "[", "]");
  if (ch === "{") return readBalanced(src, i, "{", "}");
  if (ch === "(") return readBalanced(src, i, "(", ")");

  // lê até whitespace ou separadores “fortes”
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (isWSChar(c)) break;
    if (
    c === "," || c === ":" || c === ";" ||
    c === "." ||          // ← importante (caso THREE $a.$b...)
    c === "(" ||          // ← importante (caso Scene(...), PerspectiveCamera(...)
    c === "[" ||          // ← importante (caso BoxGeometry[0])
    c === "]" || c === "}" || c === ")"
  ) break;

    j++;
  }
  if (j === i) {
    return { ok: false };
  }
  return { ok: true, text: src.slice(i, j), next: j };
}

function matchLiteralToken(src, i, lit) {
  i = skipWS(src, i);
  if (!src.startsWith(lit, i)){
      
      return { ok: false }
    };

  // boundary para literais que são identifiers (ex: "struct", "THREE")
  if (isIdentStartChar(lit[0])) {
    const prev = src[i - 1];
    const next = src[i + lit.length];
    if (isIdentChar(prev)){
      return { ok: false }
    };
    if (isIdentChar(next)){
      return { ok: false }
    };
  }

  return { ok: true, next: i + lit.length };
}

function escapeForOuterTemplate(str) {
  return str
    .replace(/\\/g, "\\\\")   // escape barras primeiro
    .replace(/`/g, "\\`");    // escape backticks
}

function matchNodesOnSource(nodes, src, i0, ctx) {

  if(DEBUG_REP){
    console.log("\n--- MATCH START ---");
    console.log("Nodes:", nodes.map(n => n.kind + (n.t ? ":" + n.t : "")));
    console.log("Source:", src.slice(i0, i0 + 120));
  }

  let i = i0;
  

  for (let idx = 0; idx < nodes.length; idx++) {
    const node = nodes[idx];

    if (DEBUG_REP && node.kind === "rep") {
      console.log("Rep nodes:", node.nodes);
    }

    if (node.kind === "lit") {
      const m = matchLiteralToken(src, i, node.t);
      if (!m.ok) {
        return { ok: false };
      }
      i = m.next;
      continue;
    }

    if (node.kind === "ph") {

      i = skipWS(src, i);

      // 🔹 capturar comentário + template literal juntos
      if (src.startsWith("/*", i)) {

        const cmtEnd = src.indexOf("*/", i + 2);
        if (cmtEnd !== -1) {

          let j = cmtEnd + 2;
          j = skipWS(src, j);

          if (src[j] === "`") {
            const tpl = readString(src, j);
            if (!tpl.ok) return { ok: false };

            const full = src.slice(i, tpl.next);
            ctx.scalars[node.name] = full.trim();
            i = tpl.next;
            continue;
          }
        }
      }

      // 🔹 delimitadores balanceados
      const ch = src[i];

      if (src.startsWith("[>", i)) {
        const b = readLispBlock(src, i);
        if (!b.ok) return { ok: false };

        ctx.scalars[node.name] = b.text.trim();
        i = b.next;
        continue;
      }

      if (ch === "(" || ch === "{" || ch === "[") {

        const pairs = { "(": ")", "{": "}", "[": "]" };

        const b = readBalanced(src, i, ch, pairs[ch]);
        if (!b.ok) return { ok: false };

        ctx.scalars[node.name] = b.text.slice(1, -1).trim();
        i = b.next;
        continue;
      }

      // 🔹 fallback normal
      const a = readAtom(src, i);
      if (!a.ok) return { ok: false };

      ctx.scalars[node.name] = a.text;
      i = a.next;
      continue;
    }




    if (node.kind === "block") {
      i = skipWS(src, i);
      if (src[i] !== node.open) {
        return { ok: false };
      }
      const b = readBalanced(src, i, node.open, node.close);
      if (!b.ok) {
        return { ok: false };
      }

      // captura sem bordas
      ctx.scalars[node.name] = b.text.slice(1, -1).trim();
      i = b.next;
      continue;
    }

    if (node.kind === "rest") {
      const start = skipWS(src, i);

      if (src.startsWith("[>", start)) {
        const block = readLispBlock(src, start);
        if (!block.ok) return { ok: false };
        ctx.scalars[node.name] = block.text.trim();
        i = block.next;
        continue;
      }

      if (src[start] === "`") {
        const tpl = readTemplateLiteral(src, start);
        if (!tpl.ok) return { ok: false };
        ctx.scalars[node.name] = tpl.text.trim();
        i = tpl.next;
        continue;
      }

      if (src[start] === '"' || src[start] === "'") {
        const str = readString(src, start);
        if (!str.ok) return { ok: false };
        ctx.scalars[node.name] = str.text.trim();
        i = str.next;
        continue;
      }

      if (src[start] === "(" || src[start] === "{" || src[start] === "[") {
        const pairs = { "(": ")", "{": "}", "[": "]" };
        const balanced = readBalanced(src, start, src[start], pairs[src[start]]);
        if (!balanced.ok) return { ok: false };
        ctx.scalars[node.name] = balanced.text.trim();
        i = balanced.next;
        continue;
      }

      let j = i;
      while (j < src.length) {
        const ch = src[j];
        if (ch === "\n") break;
        if (ch === ";") break;
        j++;
      }
      ctx.scalars[node.name] = src.slice(i, j).trim();
      i = j;
      continue;
    }

    if (node.kind === "group") {
      const local = {};
      const innerCtx = { scalars: local, repeats: [] };

      const r = matchNodesOnSource(node.nodes, src, i, innerCtx);
      if (!r.ok) {
        return { ok: false };
      }

      // promover variáveis capturadas
      for (const k in local) {
        ctx.scalars[k] = local[k];
      }

      i = r.next;
      continue;
    }


    if (node.kind === "rep") {
      const items = [];

      while (true) {
        const saveI = i;
        const local = {};
        const innerCtx = { scalars: local, repeats: [] };

        const r = matchNodesOnSource(node.nodes, src, i, innerCtx);
        if (!r.ok) { i = saveI; break; }

        items.push(local);
        i = r.next;

        // separadores opcionais entre itens
        i = skipWS(src, i);
        if (src[i] === "," || src[i] === ";") {
          i++;
        }
        // permite newline/indent etc
        i = skipWS(src, i);

        // parada natural antes de fechamentos comuns
        const peek = skipWS(src, i);
        const c = src[peek];
        if (c === "]" || c === "}" || c === ")" || c === undefined) {
          i = peek;
          break;
        }
      }

      if (DEBUG_REP) {
        console.log("=== REP CAPTURED ===");
        console.log("Vars:", Array.from(node.vars));
        console.log("Items:", items);
        console.log("====================");
      }
      ctx.repeats.push({ vars: new Set(node.vars), items });
      continue;
    }

   {
      return { ok: false };
    }
  }

  return { ok: true, next: i };
}


// const buildCallRegex = (name, signature) =>
//   new RegExp(
//     `^[\\s\\t]*${name}\\s+${signatureToRegex(signature)}`,
//     "gm"
//   );


// function signatureToRegex(sig) {
//   const STRING =
//     `"(?:\\\\.|[^"])*"|` +
//     `'(?:(?:\\\\.)|[^'])*'|` +
//     `\`(?:\\\\.|[^\`])*\``;

//   const ATOM = `[^\\s]+`;
//   const ARG = `${STRING}|${ATOM}`;

//   const hasVariadic = /\$[a-zA-Z_]\w*\.{3}/.test(sig);

//   let out = sig
//     // remove ($delim...)
//     .replace(/\(\s*\$[a-zA-Z_]\w*\.{3}\s*\)/g, "")
//     // $param → string inteira OU átomo
//     .replace(/\$[a-zA-Z_]\w*/g, `(${ARG})`)
//     // ponto literal
//     .replace(/\./g, "\\.");

//   // sufixos só se a assinatura declarar variádico
//   if (hasVariadic) {
//     out += "((\\([^)]*\\)|\\[[^\\]]+\\])*)";
//   }

//   return out;
// }


// function extractParams(signature) {
//   if (!signature) return [];

//   // $a, $b, $msg, $delim...
//   const params = [];
//   const re = /\$([a-zA-Z_]\w*)(?:\.{3})?/g;

//   let m;
//   while ((m = re.exec(signature)) !== null) {
//     if (!params.includes(m[1])) {
//       params.push(m[1]);
//     }
//   }

//   return params;
// }

// function readString(src, i0) {
//   const quote = src[i0];
//   let i = i0 + 1;

//   while (i < src.length) {
//     const ch = src[i];

//     if (ch === "\\" && i + 1 < src.length) {
//       i += 2;
//       continue;
//     }

//     if (ch === quote) {
//       i++;
//       break;
//     }

//     i++;
//   }

//   return {
//     ok: true,
//     raw: src.slice(i0, i),
//     next: i
//   };
// }

function readTemplateLiteral(src, i) {
  if (src[i] !== "`") return { ok: false };

  let j = i + 1;
  let depthExpr = 0;

  while (j < src.length) {
    const ch = src[j];

    // escape
    if (ch === "\\" && j + 1 < src.length) {
      j += 2;
      continue;
    }

    // ${ interpolation
    if (ch === "$" && src[j + 1] === "{") {
      depthExpr++;
      j += 2;
      continue;
    }

    if (ch === "}" && depthExpr > 0) {
      depthExpr--;
      j++;
      continue;
    }

    // nested template literal
    if (ch === "`" && depthExpr === 0) {
      // ⚠️ verificar se é abertura de nested template
      // olhando para trás para ver se faz parte de /* css */`
      const prevSlice = src.slice(Math.max(0, j - 10), j);

      if (prevSlice.includes("/*")) {
        const nested = readTemplateLiteral(src, j);
        if (!nested.ok) return { ok: false };
        j = nested.next;
        continue;
      }

      // fechamento real
      return {
        ok: true,
        text: src.slice(i, j + 1),
        inner: src.slice(i + 1, j),
        next: j + 1
      };
    }

    j++;
  }

  return { ok: false };
}




// ====== Tokenizer (com strings e preservando \n) ======
function tokenize(src) {
  const out = [];
  let i = 0;

  const isWS = (c) => c === " " || c === "\t" || c === "\r";
  const isIdentStart = (c) => /[A-Za-z_$\p{L}]/u.test(c);
  const isIdent = (c) => /[A-Za-z0-9_$\p{L}]/u.test(c);


  while (i < src.length) {
    const start = i;
    const c = src[i];

    if (c === "\n") {
      out.push({ t: "\n", k: "nl", start, end: i + 1 });
      i++;
      continue;
    }

    if (isWS(c)) {
      i++;
      continue;
    }

    if (c === "`") {
      const tpl = readTemplateLiteral(src, i);
      out.push({
        t: tpl.raw,
        k: "template",
        start,
        end: tpl.next
      });
      i = tpl.next;
      continue;
    }

    if (c === '"' || c === "'") {
      const s = readString(src, i);
      out.push({ t: s.raw, k: "str", start, end: s.next });
      i = s.next;
      continue;
    }



    if (c === "$" && isIdentStart(src[i + 1] || "")) {
      let j = i + 1;
      while (j < src.length && isIdent(src[j])) j++;
      out.push({ t: src.slice(start, j), k: "ph", start, end: j });
      i = j;
      continue;
    }

    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < src.length && isIdent(src[j])) j++;
      out.push({ t: src.slice(start, j), k: "id", start, end: j });
      i = j;
      continue;
    }

    out.push({ t: c, k: "p", start, end: i + 1 });
    i++;
  }

  return out;
}


function skipNoise(tokens, i) {
  while (
    i < tokens.length &&
    (
      tokens[i].k === "nl" ||
      tokens[i].k === "ws" ||
      tokens[i].t === "\n"
    )
  ) {
    i++;
  }
  return i;
}

// ====== Pattern parser: supports $name, literals, and $ ( ... ) ... repetition ======
function parsePattern(patternSrc) {
  const tok = tokenize(patternSrc);
  const nodes = [];
  let i = 0;

  while (i < tok.length) {
    i = skipNoise(tok, i);
    if (i >= tok.length) break;

    // repetition group: $( ... )...
    if (tok[i].t === "$" && tok[i + 1]?.t === "(") {
      // not used (tokenizer doesn't emit "$" alone), so handle by raw scan fallback
      // (kept for completeness)
    }

    // We detect repetition by scanning raw pattern string instead (robust):
    // But we can also detect it using tokens by spotting: "$(" in raw.
    // We'll do raw scanning below and merge with token stream parsing.
    break;
  }

  // Raw scan approach for repetition (simpler & reliable):
  // We re-parse patternSrc and emit nodes.
  return parsePatternRaw(patternSrc);
}

function parsePatternRaw(src) {
  const nodes = [];
  let i = 0;

  const flushLiteral = (s) => {
    const t = tokenize(s);

    for (let idx = 0; idx < t.length; idx++) {
      const tk = t[idx];

      if (tk.k === "nl") continue;

      if (tk.t === "=" && t[idx + 1] && t[idx + 1].t === ">") {
        nodes.push({ kind: "lit", t: "=" });
        nodes.push({ kind: "lit", t: ">" });
        idx++;
        continue;
      }

      if (tk.k === "ph") {
        nodes.push({ kind: "ph", name: tk.t.slice(1) });
      } else {
        nodes.push({ kind: "lit", t: tk.t });
      }
    }
  };

  while (i < src.length) {

    const nextRep = src.indexOf("$(", i);
    const nextBracket = src.indexOf("[$", i);
    const nextParen = src.indexOf("($", i);

    const candidates = [nextRep, nextBracket, nextParen].filter(idx => idx !== -1);
    const next = candidates.length ? Math.min(...candidates) : -1;

    if (next === -1) {
      flushLiteral(src.slice(i));
      break;
    }

    if (next > i) {
      flushLiteral(src.slice(i, next));
      i = next;
    }

    // REST: [$var...]
    const restMatch = src.slice(i).match(/^\[\s*\$([a-zA-Z_]\w*)\.{3}\s*\]/);
    if (restMatch) {
      nodes.push({ kind: "rest", name: restMatch[1] });
      i += restMatch[0].length;
      continue;
    }

    const parenRestMatch = src.slice(i).match(/^\(\s*\$([a-zA-Z_]\w*)\.{3}\s*\)/);
    if (parenRestMatch) {
      nodes.push({
        kind: "block",
        name: parenRestMatch[1],
        open: "(",
        close: ")"
      });
      i += parenRestMatch[0].length;
      continue;
    }

    // BLOCK: [$var]
    const blockMatch = src.slice(i).match(/^\[\s*\$([a-zA-Z_]\w*)\s*\]/);
    if (blockMatch) {
      nodes.push({
        kind: "block",
        name: blockMatch[1],
        open: "[",
        close: "]"
      });
      i += blockMatch[0].length;
      continue;
    }

    const parenBlockMatch = src.slice(i).match(/^\(\s*\$([a-zA-Z_]\w*)\s*\)/);
    if (parenBlockMatch) {
      nodes.push({
        kind: "block",
        name: parenBlockMatch[1],
        open: "(",
        close: ")"
      });
      i += parenBlockMatch[0].length;
      continue;
    }

    // GROUP ou REP: $(...)
    if (src.startsWith("$(", i)) {
      let j = i + 2;
      let depth = 1;
      let inner = "";

      while (j < src.length) {
        const ch = src[j];

        if (ch === '"' || ch === "'" || ch === "`") {
          const q = ch;
          inner += ch;
          j++;
          while (j < src.length) {
            const c2 = src[j];
            inner += c2;
            if (c2 === "\\" && j + 1 < src.length) {
              inner += src[j + 1];
              j += 2;
              continue;
            }
            if (c2 === q) {
              j++;
              break;
            }
            j++;
          }
          continue;
        }

        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (depth === 0) {
          j++;
          break;
        }

        inner += ch;
        j++;
      }

      const innerNodes = parsePatternRaw(inner.trim());
      const vars = collectVars(innerNodes);

      // 🔥 verificar se é repetição
      if (src.slice(j, j + 3) === "...") {
        nodes.push({ kind: "rep", nodes: innerNodes, vars });
        i = j + 3;
      } else {
        nodes.push({ kind: "group", nodes: innerNodes, vars });
        i = j;
      }

      continue;
    }
  }

  return nodes.filter((n) => !(n.kind === "lit" && n.t === ""));
}


function collectVars(nodes) {
  const s = new Set();
  for (const n of nodes) {
    if (n.kind === "ph") s.add(n.name);
    if (n.kind === "rest") s.add(n.name);
    if (n.kind === "block") s.add(n.name);
    if (n.kind === "rep") for (const v of n.vars) s.add(v);
  }
  return [...s];
}

const TEMPLATE_IDENT_RE = /\$\`([\s\S]*?)\`/g;

function applyCompileTimeMutations(src) {

  src = src.replace(/^\s*([A-Za-z_\p{L}][A-Za-z0-9_\p{L}]*)\s*\+=\s*(\d+)\s*;?/gmu,
    (_, name, value) => {
      const n = Number(value);
      if (!Object.prototype.hasOwnProperty.call(COMPILE_TIME_VARS, name)) {
        COMPILE_TIME_VARS[name] = 0;
      }
      COMPILE_TIME_VARS[name] += n;
      return ""; // remove linha
    }
  );

  return src;
}
function expandTemplateIdentifiers(src, matchCtx, DEBUG_TPL = false) {
  const log = (...a) => DEBUG_TPL && console.log("[TPL]", ...a);

  log("ENTER expandTemplateIdentifiers");
  log("scalars keys:", Object.keys(matchCtx?.scalars || {}));

  const out = src.replace(/\$\`([\s\S]*?)\`/g, (full, inner, off) => {
    log("MATCH $`...` at", off);
    log("RAW inner:\n" + inner);

    let result = "";
    let i = 0;

    while (i < inner.length) {
      // ${...}
      if (inner[i] === "$" && inner[i + 1] === "{") {
        let j = i + 2;
        let depth = 1;

        while (j < inner.length && depth > 0) {
          if (inner[j] === "{") depth++;
          else if (inner[j] === "}") depth--;
          j++;
        }

        const exprRaw = inner.slice(i + 2, j - 1);
        const expr = exprRaw.trim();

        log("FOUND ${...} expr:", JSON.stringify(expr));

        const scalars = matchCtx?.scalars || {};

        if (Object.prototype.hasOwnProperty.call(scalars, expr)) {
          const val = scalars[expr];
          log("RESOLVE ${" + expr + "} via scalars =>", JSON.stringify(val));
          result += String(val);
        }
        else if (Object.prototype.hasOwnProperty.call(COMPILE_TIME_VARS, expr)) {
          const val = COMPILE_TIME_VARS[expr];
          log("RESOLVE ${" + expr + "} via COMPILE_TIME_VARS =>", JSON.stringify(val));
          result += String(val);
        }
        else {
          log("MISS ${" + expr + "} -> literal fallback");
          result += expr;
        }

        i = j;
        continue;
      }

      // $var
      if (inner[i] === "$") {
        const m = inner.slice(i).match(/^\$([A-Za-z_\p{L}][A-Za-z0-9_\p{L}]*)/u);
        if (m) {
          const name = m[1];
          const scalars = matchCtx?.scalars || {};
          log("FOUND $var:", name);

          if (Object.prototype.hasOwnProperty.call(scalars, name)) {
            const val = scalars[name];
            log("RESOLVE $" + name + " =>", JSON.stringify(val));
            result += String(val);
          } else {
            log("MISS $" + name + " (not in scalars) -> keep as-is");
            result += "$" + name;
          }

          i += m[0].length;
          continue;
        }
      }

      result += inner[i];
      i++;
    }

    const collapsed = result.replace(/\s+/g, "");
    log("RESULT before collapse:", JSON.stringify(result));
    log("RESULT collapsed:", JSON.stringify(collapsed));
    log("REPLACE full:", JSON.stringify(full), "=>", JSON.stringify(collapsed));

    return collapsed;
  });

  log("EXIT expandTemplateIdentifiers");
  return out;
}
// ====== Matcher (unification) ======
function matchNodes(nodes, tokens, i0) {
  let i = i0;
  const scalars = {};
  const repeats = []; // { vars:Set, items:[{...}] }

  const matchOne = (node) => {
    i = skipNoise(tokens, i);
    if (node.kind === "lit") {
      if (i >= tokens.length) return false;
      if (tokens[i].t !== node.t) return false;
      i++;
      return true;
    }
    if (node.kind === "rest") {
      const remaining = tokens
        .slice(i)
        .map(t => t.raw ?? t.t)
        .join("");

      scalars[node.name] = remaining;
      i = tokens.length;
      return true;
    }

    if (node.kind === "opt") {
        const saveI = i;
        const saveScalars = {...scalars};

        const r = matchNodes(node.nodes, tokens, i);
        if (r.ok) {
            i = r.next;
            Object.assign(scalars, r.scalars);
        } else {
            i = saveI;
        }
        return true;
    }


    if (node.kind === "group") {
      const local = {};
      const saveI = i;

      let ok = true;

      for (const inner of node.nodes) {
        i = skipNoise(tokens, i);

        if (inner.kind === "ph") {
          if (i >= tokens.length) { ok = false; break; }
          local[inner.name] = tokens[i].t;
          i++;
        } else if (inner.kind === "lit") {
          if (i >= tokens.length || tokens[i].t !== inner.t) {
            ok = false;
            break;
          }
          i++;
        } else {
          ok = false;
          break;
        }
      }

      if (!ok) {
        i = saveI;
        return false;
      }

      // promover variáveis para scalars
      for (const k in local) {
        scalars[k] = local[k];
      }

      return true;
    }

    if (node.kind === "ph") {
      console.log("TRY PH:", node.name, "AT", tokens[i]);
      if (i >= tokens.length) return false;
      // placeholder captures one token (atomic). Operators remain literal in pattern.
      scalars[node.name] = tokens[i].t;
      i++;
      return true;
    }




    if (node.kind === "rep") {
      const items = [];

      while (true) {
        const saveI = i;
        const local = {};

        let ok = true;
        for (const inner of node.nodes) {
          i = skipNoise(tokens, i);

          if (inner.kind === "ph") {
            if (i >= tokens.length) { ok = false; break; }
            local[inner.name] = tokens[i].t;
            i++;
          } else if (inner.kind === "lit") {
            if (i >= tokens.length || tokens[i].t !== inner.t) { ok = false; break; }
            i++;
          }
        }

        if (!ok) {
          i = saveI;
          break;
        }

        items.push(local);

        i = skipNoise(tokens, i);
        while (i < tokens.length && (tokens[i].t === "," || tokens[i].t === ";")) i++;
      }

      // 🔴 PROMOÇÃO CORRETA (AQUI ESTAVA O BUG)
      if (items.length > 0) {
        for (const v of node.vars) {
          if (!(v in scalars)) {
            scalars[v] = items[0][v];
          }
        }
      }

      repeats.push({ vars: new Set(node.vars), items });
      return true;
    }

    return false;
  };

  for (const n of nodes) {
    if (!matchOne(n)) {
      return { ok: false };
    }
  }

  return { ok: true, next: i, scalars, repeats };
}

function escapeUnescapedBackticks(text) {
  // escapa apenas ` que NÃO esteja precedido por \
  // (evita virar \\` e evita triplo-escape)
  return text.replace(/(?<!\\)`/g, "\\`");
}

function extractGlobalDSL(src, globalDSL) {
  const blockMatch = src.match(/macros:\s*\{([\s\S]*?)\}/);

  if (!blockMatch) return src;

  const body = blockMatch[1];

  body.replace(
    /\$declare\s+([A-Za-z_\p{L}][A-Za-z0-9_\p{L}]*)\s+(.+)/gu,
    (_, name, valueExpr) => {

      const value = valueExpr.trim();

      console.log("[GLOBAL DECLARE]", name, "=", value);

      if (/^\d+$/.test(value)) {
        globalDSL.scalars[name] = Number(value);
      }
      else {
        globalDSL.scalars[name] = value;
      }

      return "";
    }
  );

  // remover bloco do código
  return src.replace(blockMatch[0], "");
}

function escapeTemplatesInsideAnnotatedJavascript(src) {
  let out = "";
  let i = 0;

  while (i < src.length) {

    if (src.startsWith("/*", i)) {

      const endCmt = src.indexOf("*/", i + 2);
      if (endCmt === -1) {
        out += src[i++];
        continue;
      }

      const comment = src.slice(i, endCmt + 2);
      const isJS = /\/\*\s*javascript\s*\*\//i.test(comment);

      out += comment;
      i = endCmt + 2;

      if (!isJS) continue;

      i = skipWS(src, i);

      if (src[i] !== "`") continue;

      const tpl = readTemplateLiteral(src, i);
      if (!tpl.ok) continue;

      const escapedContent = tpl.inner.replace(/(?<!\\)`/g, "\\`");

      out += "`" + escapedContent + "`";

      i = tpl.next;
      continue;
    }

    out += src[i++];
  }

  return out;
}

function expandIndexedRepeatPlaceholders(src, matchCtx) {
  return src.replace(
    /\$([A-Za-z_\p{L}][A-Za-z0-9_\p{L}]*)\[(last|-?\d+)\]/gu,
    (full, name, indexExpr) => {
      const rep = matchCtx?.repeats?.find(r => r.vars.has(name));
      if (!rep) return full;

      const rawIndex = indexExpr === "last"
        ? rep.items.length - 1
        : Number(indexExpr);
      const index = rawIndex < 0 ? rep.items.length + rawIndex : rawIndex;

      if (!Number.isInteger(index) || index < 0 || index >= rep.items.length) {
        return full;
      }

      const item = rep.items[index];
      if (!item || !(name in item)) {
        return full;
      }

      return item[name];
    }
  );
}



function expandBody(bodySrc, matchCtx) {
  let out = bodySrc;

  out = applyCompileTimeMutations(out);

  while (true) {
    const next = expandBodyReps(out, matchCtx);
    if (next === out) break;
    out = next;
  }
  out = expandTemplateIdentifiers(out, matchCtx);
  out = expandIndexedRepeatPlaceholders(out, matchCtx);

  out = out.replace(PH_RE, (_, name) => {
    if (name in matchCtx.scalars) return matchCtx.scalars[name];
    return `$${name}`;
  });

  return out;
}

function expandBodyReps(bodySrc, matchCtx) {
  const stripCommonIndent = (text) => {
    const trimmed = text
      .replace(/^\r?\n/u, "")
      .replace(/\r?\n[ \t]*$/u, "");

    const lines = trimmed.split(/\r?\n/u);
    const indents = lines
      .filter(line => line.trim().length > 0)
      .map(line => (line.match(/^[ \t]*/u)?.[0].length ?? 0));

    const minIndent = indents.length ? Math.min(...indents) : 0;

    return lines
      .map(line => line.slice(Math.min(minIndent, line.length)))
      .join("\n");
  };

  return bodySrc.replace(
    /\$\(([\s\S]*?)\)\.\.\.(?:\[(last|-?\d+)\])?/g,
    (full, inner, indexExpr, offset, source) => {
      const lineStart = Math.max(
        source.lastIndexOf("\n", offset - 1),
        source.lastIndexOf("\r", offset - 1)
      );
      const linePrefix = source.slice(lineStart + 1, offset);
      const lineIndent = (linePrefix.match(/^[ \t]*/u)?.[0]) ?? "";

      // detectar variáveis do template
      const varsInTemplate = Array.from(
        inner.matchAll(PH_INNER_RE)
      ).map(m => m[1]);

      const rep = matchCtx.repeats.find(r =>
        varsInTemplate.every(v => r.vars.has(v))
      );

      if (!rep) return "";

      const template = stripCommonIndent(inner);
      const segments = rep.items.map(item => {
        let segment = template;

        for (const key in item) {
          const re = new RegExp(`\\$${key}\\b`, "g");
          segment = segment.replace(re, item[key]);
        }

        return segment;
      });

      if (indexExpr !== undefined) {
        const index = indexExpr === "last"
          ? segments.length - 1
          : Number(indexExpr) < 0
            ? segments.length + Number(indexExpr)
            : Number(indexExpr);

        if (!Number.isInteger(index) || index < 0 || index >= segments.length) {
          return "";
        }

        return segments[index].trim().replace(/\n/g, `\n${lineIndent}`);
      }

      return segments.join(`\n${lineIndent}`);
    }
  );
}

// ====== Macro parsing and application ======
export function parseMacrosFromBlock(block) {
  if (!block) return [];

  const macroRe =
    /^\s*\$macro\s+([\s\S]*?)\s*#\(\s*([\s\S]*?)\s*\)#/gm;

  const macros = [];
  let mm;

  while ((mm = macroRe.exec(block)) !== null) {
    const patternSrc = mm[1].trim();
    const bodySrc = mm[2];

    const lispBlockMatch = patternSrc.match(/^\[>\s*([\s\S]*?)\s*\]$/u);
    if (lispBlockMatch) {
      macros.push({
        head: "[>",
        patternSrc,
        pattern: [],
        bodySrc,
        special: {
          kind: "lisp_block",
          innerPattern: parsePattern(lispBlockMatch[1].trim())
        }
      });
      continue;
    }

    const pattern = parsePattern(patternSrc);

    const head = pattern.find(n => n.kind === "lit")?.t;
    if (!head) {
      throw new Error(`Macro pattern has no literal head token: ${patternSrc}`);
    }

    macros.push({ head, patternSrc, pattern, bodySrc });
  }

  return macros;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isIdentifierHead(head) {
  return /^[A-Za-z_$\p{L}][A-Za-z0-9_$\p{L}]*$/u.test(head);
}

// function findInvocationSlice(code, startIdx, patternSrc) {
//   const wantsBrace = patternSrc.includes("{") && patternSrc.includes("}");
//   const wantsBracket = patternSrc.includes("[") && patternSrc.includes("]");

//   const startPos =
//     wantsBrace ? code.indexOf("{", startIdx) :
//     wantsBracket ? code.indexOf("[", startIdx) :
//     -1;

//   if (startPos === -1) {
//     const end = code.indexOf("\n", startIdx);
//     return { endIdx: end === -1 ? code.length : end + 1 };
//   }

//   const open = code[startPos];
//   const close = open === "{" ? "}" : "]";

//   let i = startPos;
//   let depth = 0;

//   while (i < code.length) {
//     const ch = code[i];

//     // ignorar strings
//     if (ch === '"' || ch === "'" || ch === "`") {
//       const q = ch;
//       i++;
//       while (i < code.length) {
//         const c2 = code[i];
//         if (c2 === "\\" && i + 1 < code.length) {
//           i += 2;
//           continue;
//         }
//         if (c2 === q) {
//           i++;
//           break;
//         }
//         i++;
//       }
//       continue;
//     }

//     if (ch === open) depth++;
//     if (ch === close) {
//       depth--;
//       if (depth === 0) {
//         const end =
//           (i + 1 < code.length && code[i + 1] === "\n")
//             ? i + 2
//             : i + 1;
//         return { endIdx: end };
//       }
//     }

//     i++;
//   }

//   return { endIdx: code.length };
// }


function indentBlock(text, indent) {
  return text
    .split("\n")
    .map(line => indent + line)
    .join("\n");
}

function isInsideTemplateInterpolation(src, targetIdx) {
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let templateExprDepth = 0;

  while (i < targetIdx) {
    const ch = src[i];
    const next = src[i + 1];

    if (inSingle) {
      if (ch === "\\" && i + 1 < targetIdx) {
        i += 2;
        continue;
      }
      if (ch === "'") inSingle = false;
      i++;
      continue;
    }

    if (inDouble) {
      if (ch === "\\" && i + 1 < targetIdx) {
        i += 2;
        continue;
      }
      if (ch === '"') inDouble = false;
      i++;
      continue;
    }

    if (inTemplate) {
      if (ch === "\\" && i + 1 < targetIdx) {
        i += 2;
        continue;
      }

      if (ch === "`" && templateExprDepth === 0) {
        inTemplate = false;
        i++;
        continue;
      }

      if (ch === "$" && next === "{") {
        templateExprDepth++;
        i += 2;
        continue;
      }

      if (ch === "}" && templateExprDepth > 0) {
        templateExprDepth--;
        i++;
        continue;
      }

      if (ch === "'" && templateExprDepth > 0) {
        inSingle = true;
        i++;
        continue;
      }

      if (ch === '"' && templateExprDepth > 0) {
        inDouble = true;
        i++;
        continue;
      }

      i++;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      i++;
      continue;
    }

    if (ch === '"') {
      inDouble = true;
      i++;
      continue;
    }

    if (ch === "`") {
      inTemplate = true;
      i++;
      continue;
    }

    i++;
  }

  return inTemplate && templateExprDepth > 0;
}

function findLastDeclaredIdentifier(src) {
  const declRe =
    /(?:^|[\r\n;]\s*)(?:const|let|var)\s+([A-Za-z_$\p{L}][A-Za-z0-9_$\p{L}]*)\s*=/gu;

  let lastName = null;
  let match;

  while ((match = declRe.exec(src)) !== null) {
    lastName = match[1];
  }

  return lastName;
}

function looksLikePlainExpression(src) {
  const trimmed = src.trim();
  if (!trimmed) return false;

  return !/^(const|let|var|if|for|while|switch|try|class|function|return|import|export)\b/u.test(trimmed);
}

function toExpressionExpansion(expanded) {
  const trimmed = expanded.trim().replace(/;+\s*$/u, "");

  if (!trimmed) return "undefined";

  if (looksLikePlainExpression(trimmed)) {
    return `(${trimmed})`;
  }

  const lastDeclared = findLastDeclaredIdentifier(trimmed);
  const body = trimmed.endsWith(";") ? trimmed : `${trimmed};`;

  if (lastDeclared) {
    return `(() => { ${body} return ${lastDeclared}; })()`;
  }

  return `(() => { ${body} return undefined; })()`;
}

function expandMacroExpressions(code, macros) {
  let out = "";
  let i = 0;

  while (i < code.length) {
    const idx = code.indexOf("$(", i);
    if (idx === -1) {
      out += code.slice(i);
      break;
    }

    out += code.slice(i, idx);
    i = idx + 2;

    // capturar conteúdo balanceado de (...)
    let depth = 1;
    let expr = "";

    while (i < code.length && depth > 0) {
      const ch = code[i];

      if (ch === "(") depth++;
      else if (ch === ")") depth--;

      if (depth > 0) expr += ch;
      i++;
    }

    const insideTemplateInterpolation = isInsideTemplateInterpolation(code, idx);

    // tentar casar macro dentro da expressão
    const tokens = tokenize(expr.trim());
    let replaced = false;

    for (const mac of macros) {
      if (!tokens.length) continue;
      if (tokens[0].k !== "id") continue;
      if (tokens[0].t !== mac.head) continue;

      const res = matchNodes(mac.pattern, tokens, 0);
      if (!res.ok) continue;

      let expanded = expandBody(mac.bodySrc, res);
      expanded = expandMacros(expanded, macros);
      expanded = expandTemplateIdentifiers(expanded, res);
      out += insideTemplateInterpolation
        ? toExpressionExpansion(expanded)
        : expanded.trim();
      replaced = true;
      break;
    }

    if (!replaced) {
      // se não for macro válida, preserva literal
      out += `$(${expr})`;
    }
  }

  return out;
}


function applyMacrosOnce(code, macros) {
  for (const mac of macros) {
    const headRe = isIdentifierHead(mac.head)
      ? new RegExp(`\\b${escapeRegex(mac.head)}\\b`, "g")
      : new RegExp(escapeRegex(mac.head), "g");
    let m;

    while ((m = headRe.exec(code)) !== null) {
      const startIdx = m.index;
      const lineStart = code.lastIndexOf("\n", startIdx - 1) + 1;
      const linePrefix = code.slice(lineStart, startIdx);
      const isIndentedLineStart = /^[ \t]*$/u.test(linePrefix);
      const indent = isIndentedLineStart ? linePrefix : "";
      const replaceStartIdx = isIndentedLineStart ? lineStart : startIdx;

      if (DEBUG_REP) {
        console.log("\n=== TRY MACRO ===");
        console.log("Macro:", mac.head);
        console.log("StartIdx:", replaceStartIdx);
        console.log("Snippet:\n", code.slice(startIdx, startIdx + 120));
        console.log("=================\n");
      }

      const ctx = { scalars: {}, repeats: [] };
      let endIdx;

      if (mac.special?.kind === "lisp_block") {
        const block = readLispBlock(code, startIdx);
        if (!block.ok) {
          headRe.lastIndex = startIdx + 1;
          continue;
        }

        const res = matchNodesOnSource(
          mac.special.innerPattern,
          block.inner,
          0,
          ctx
        );

        if (!res.ok || skipWS(block.inner, res.next) !== block.inner.length) {
          headRe.lastIndex = startIdx + 1;
          continue;
        }

        endIdx = block.next;
      } else {
        const afterHead = startIdx + mac.head.length;
        const patternWithoutHead = mac.pattern.slice(1);
        if (DEBUG_REP) {
          console.log("Pattern FULL:", mac.pattern);
        }

        const res = matchNodesOnSource(
          patternWithoutHead,
          code,
          afterHead,
          ctx
        );

        if (!res.ok) {
          console.log("MATCH FAILED for macro:", mac.head);
          console.log("Pattern:", patternWithoutHead);
          console.log("Remaining source:", code.slice(afterHead, afterHead + 120));
          headRe.lastIndex = startIdx + 1;
          continue;
        }

        endIdx = res.next;
      }

      const hasTrailingNewline =
        endIdx < code.length && code[endIdx] === "\n";

      let expanded = expandBody(mac.bodySrc, ctx);
      expanded = applyCompileTimeMutations(expanded);
      expanded = expandMacroExpressions(expanded, macros);
      expanded = expanded.trimEnd();

      const withIndent =
        indentBlock(expanded, indent) +
        (hasTrailingNewline ? "\n" : "");

      return code.slice(0, replaceStartIdx) + withIndent + code.slice(endIdx);
    }
  }

  return code;
}



export function expandMacros(code, macros) {
  let current = code;

  while (true) {
    const next = applyMacrosOnce(current, macros);
    if (next === current) {
      return escapeTemplatesInsideAnnotatedJavascript(next);
    }
    current = next;
  }
}



export function stripMacrosBlock(source) {
  const bounds = findMacrosBlockBounds(source);
  if (!bounds) return { macrosBlock: "", output: source };

  return {
    macrosBlock: bounds.macrosBlock,
    output: source.slice(0, bounds.start) + source.slice(bounds.end)
  };
}

export function stripMacrosBlockPreserveLines(source) {
  const bounds = findMacrosBlockBounds(source);
  if (!bounds) return { macrosBlock: "", output: source };

  const removed = source.slice(bounds.start, bounds.end);
  const placeholder = removed.replace(/[^\r\n]/g, " ");

  return {
    macrosBlock: bounds.macrosBlock,
    output: source.slice(0, bounds.start) + placeholder + source.slice(bounds.end)
  };
}

function findMacrosBlockBounds(source) {
  const match = source.match(/macros\s*:\s*\{/);
  if (!match) return null;

  const start = match.index;
  const braceStart = source.indexOf("{", start);

  let i = braceStart;
  let depth = 0;

  while (i < source.length) {
    const ch = source[i];

    if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch;
      i++;
      while (i < source.length) {
        const c2 = source[i];
        if (c2 === "\\" && i + 1 < source.length) {
          i += 2;
          continue;
        }
        if (c2 === q) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        const end = i + 1;
        return {
          start,
          end,
          macrosBlock: source.slice(braceStart + 1, i)
        };
      }
    }
    i++;
  }

  throw new Error("Unclosed macros block");
}

function readLispBlock(src, start) {
  if (!src.startsWith("[>", start)) return { ok: false };

  let i = start + 2;
  const stack = ["lisp"];

  while (i < src.length) {
    const ch = src[i];

    if (ch === '"' || ch === "'" || ch === "`") {
      const s = readString(src, i);
      i = s.next;
      continue;
    }

    if (src.startsWith("[>", i)) {
      stack.push("lisp");
      i += 2;
      continue;
    }

    if (ch === "(") {
      stack.push(")");
      i++;
      continue;
    }

    if (ch === "{") {
      stack.push("}");
      i++;
      continue;
    }

    if (ch === "[") {
      stack.push("]");
      i++;
      continue;
    }

    if (ch === ")" || ch === "}" || ch === "]") {
      const expected = stack[stack.length - 1];
      if (
        (ch === ")" && expected === ")") ||
        (ch === "}" && expected === "}") ||
        (ch === "]" && (expected === "]" || expected === "lisp"))
      ) {
        stack.pop();
        i++;
        if (!stack.length) {
          return {
            ok: true,
            text: src.slice(start, i),
            inner: src.slice(start + 2, i - 1),
            next: i
          };
        }
        continue;
      }
    }

    i++;
  }

  return { ok: false };
}

let COMPILE_TIME_VARS = {};

function extractCompileTimeDeclares(block) {
  const compileTimeVars = {};

  const cleaned = block.replace(
    /^\s*\$declare\s+([A-Za-z_\p{L}][A-Za-z0-9_\p{L}]*)\s+(.+)$/gmu,
    (_, name, value) => {
      compileTimeVars[name] = eval(value);
      return "";
    }
  );

  return { cleanedMacrosBlock: cleaned, compileTimeVars };
}

function extractMacroImports(source) {
  const imports = [];
  const importRe =
    /^\s*import\s+macros(?:\s+from)?\s+["']([^"']+)["']\s*;?\s*$/gmu;

  let match;
  while ((match = importRe.exec(source)) !== null) {
    imports.push(match[1]);
  }

  return imports;
}

function stripMacroImports(source) {
  return source.replace(
    /^\s*import\s+macros(?:\s+from)?\s+["'][^"']+["']\s*;?\s*$/gmu,
    ""
  );
}

function resolveMacroImport(specifier, sourcePath) {
  const baseDir = sourcePath
    ? path.dirname(path.resolve(sourcePath))
    : process.cwd();

  return path.resolve(baseDir, specifier);
}

function loadMacroEnvironmentFromSource(source, options = {}) {
  const sourcePath = options.sourcePath ? path.resolve(options.sourcePath) : null;
  const seenFiles = options.seenFiles ?? new Set();
  const importStack = options.importStack ?? [];

  const importedMacros = [];
  for (const specifier of extractMacroImports(source)) {
    const resolvedPath = resolveMacroImport(specifier, sourcePath);
    if (seenFiles.has(resolvedPath)) {
      continue;
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Could not resolve macro import: ${specifier}`);
    }

    seenFiles.add(resolvedPath);
    const importedSource = fs.readFileSync(resolvedPath, "utf8");
    const imported = loadMacroEnvironmentFromSource(importedSource, {
      sourcePath: resolvedPath,
      seenFiles,
      importStack: [...importStack, resolvedPath]
    });
    importedMacros.push(...imported.macros);
  }

  const sourceWithoutImports = stripMacroImports(source);
  const { macrosBlock, output } = stripMacrosBlock(sourceWithoutImports);
  const { cleanedMacrosBlock, compileTimeVars } =
    extractCompileTimeDeclares(macrosBlock);
  const localMacros = parseMacrosFromBlock(cleanedMacrosBlock);

  return {
    output,
    macros: [...localMacros, ...importedMacros],
    compileTimeVars
  };
}

export function resolveGeneratedExtension(options = {}) {
  if (options.generatedExtension) {
    return options.generatedExtension;
  }

  return options.targetLanguage === "js" ? ".generated.js" : ".generated.ts";
}

export function toGeneratedImportSpecifier(specifier, options = {}) {
  const generatedExtension = resolveGeneratedExtension(options);

  if (specifier.endsWith(".dsljs")) {
    return specifier.replace(/\.dsljs$/u, generatedExtension);
  }

  if (specifier.endsWith(".idsl")) {
    return specifier.replace(/\.idsl$/u, generatedExtension);
  }

  return specifier;
}

export function rewriteDslImports(code, options = {}) {
  const importFromPattern = /(from\s+["'])([^"']+)(["'])/g;
  const bareImportPattern = /(import\s+["'])([^"']+)(["'])/g;
  const dynamicImportPattern = /(\bimport\s*\(\s*["'])([^"']+)(["']\s*\))/g;

  const rewrite = (_, prefix, specifier, suffix) => {
    return `${prefix}${toGeneratedImportSpecifier(specifier, options)}${suffix}`;
  };

  return code
    .replace(importFromPattern, rewrite)
    .replace(bareImportPattern, rewrite)
    .replace(dynamicImportPattern, rewrite);
}

export function getGeneratedFilePath(inputFile, options = {}) {
  const generatedExtension = resolveGeneratedExtension(options);

  if (inputFile.endsWith(".dsljs")) {
    return inputFile.slice(0, -".dsljs".length) + generatedExtension;
  }

  if (inputFile.endsWith(".idsl")) {
    return inputFile.slice(0, -".idsl".length) + generatedExtension;
  }

  if (inputFile.endsWith(".dsl.js")) {
    return inputFile.slice(0, -".dsl.js".length) + generatedExtension;
  }

  return `${inputFile}${generatedExtension}`;
}

export function buildGeneratedFileContents(inputFile, expanded, options = {}) {
  const normalizedInput = String(inputFile || "").replace(/\\/g, "/");
  const header = [
    `// Generated from: ${normalizedInput}`,
    "// Do not edit this file directly.",
    ""
  ].join("\n");

  return `${header}${expanded.trim()}\n`;
}

export function compileDslSource(source, options = {}) {
  const { output, macros, compileTimeVars } =
    loadMacroEnvironmentFromSource(source, options);

  COMPILE_TIME_VARS = compileTimeVars;

  const expanded = expandMacros(output, macros);
  return rewriteDslImports(expanded, options);
}

export function compileDslFile(inputFile, options = {}) {
  const source = fs.readFileSync(inputFile, "utf8");
  return compileDslSource(source, { ...options, sourcePath: inputFile });
}

if (isMain()) {
  const input = process.argv[2];
  const outputFile = process.argv[3] || "";

  if (!input || !fs.existsSync(input)) {
    console.error("Uso: node compile.js <arquivo.dsljs>");
    process.exit(1);
  }
  const finalOutput = compileDslFile(input);

  if (outputFile) {
    const dir = path.dirname(outputFile);

    if (dir && dir !== ".") {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputFile, finalOutput, "utf8");
  } else {
    console.log(finalOutput);
  }
}
