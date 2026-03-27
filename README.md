
# IDSL
pgr + tr + iter

Programação estrutural iterativa.

IDSL é uma linguagem de transformação estrutural construída sobre JavaScript.

Ela permite definir gramáticas próprias dentro do código e transformá-las, em tempo de compilação, em JavaScript puro e determinístico por meio da criação livre de macros. Não adiciona runtime. Opera como sistema de reescrita sintática.

O resultado final sempre é JavaScript padrão.

---

# Ilustração pelos modelos em example/

Esta seção demonstra:

- O código fonte em `example.dsljs`
- O código gerado em `example.output.js`
- A explicação instrutiva de cada transformação

---

# 1. Instanciação Estrutural (THREE)

## Fonte (DSL)

```dsl
THREE scene.Scene()

THREE camera.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)

if(true){
    THREE mesh.BoxGeometry[0]
}
```

## Saída Compilada

```js
const scene = new THREE.Scene()

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)

if(true){
    const mesh = new THREE.BoxGeometry[0]
}
```

## Explicação

Formato DSL:

```
THREE variável.Tipo(argumentos)
```

Transformação aplicada:

1. `$a` captura o nome da variável.
2. `$b` captura o tipo dentro do namespace THREE.
3. `$delim...` captura os argumentos ou delimitadores.
4. A macro gera automaticamente:

```
const variável = new THREE.Tipo(argumentos)
```

Isso remove repetição estrutural e padroniza instanciações.

---

# 2. Log Estrutural (LOG)

## Fonte (DSL)

```dsl
LOG `Build completo com ${$(THREE scene.Scene())}`
```

## Saída Compilada

```js
console.log("[Macro Log]:", `Build completo com ${const scene = new THREE.Scene()}`);
```

## Explicação

Formato DSL:

```
LOG expressão
```

Transformação:

1. `$msg` captura a expressão completa.
2. A macro envolve a expressão em um `console.log` padronizado.
3. Qualquer expressão interna é expandida antes.

Resultado final:

```
console.log("[Macro Log]:", expressão)
```

---

# 3. Estrutura Declarativa (struct)

## Fonte (DSL)

```dsl
const lista_qualquer = [1,2,3,4]

struct teste [
    atributo: "teste_atributo",
    lista_qualquer
] => {
    propriedade = "valor teste"
}
```

## Saída Compilada

```js
const lista_qualquer = [1,2,3,4]

const teste = function(){
    const $attr_var = "teste_atributo";
    const teste_1 = lista_qualquer[0];
    return {
        atributo: () => $attr_var,
        propriedade: "valor teste",
    }
}
```

## Explicação

Formato DSL:

```
struct Nome [
    atributos
] => {
    propriedades derivadas
}
```

Processo de transformação:

1. `$name` captura o nome da estrutura.
2. `$($attr : $val1)` captura pares atributo/valor.
3. `$declarações` captura elementos adicionais.
4. O bloco `=> { ... }` define propriedades derivadas.
5. Dentro de `#( )#`, é gerada uma função encapsuladora.
6. Cada atributo vira uma variável interna.
7. São criados getters automáticos.
8. As propriedades declaradas são adicionadas ao objeto retornado.

Resultado: estrutura declarativa → função encapsulada com estado interno.

---

# 4. Injeção de Bloco Literal (style)

## Fonte (DSL)

```dsl
style (/*css*/`
    #mapa_container {
        width: 100vw;
        height: 100vh;
    }
`)
```

## Saída Compilada

```js
console.log(/*css*/`
    #mapa_container {
        width: 100vw;
        height: 100vh;
    }
`)
```

## Explicação

Formato DSL:

```
style (texto)
```

Transformação:

1. `$text` captura o bloco literal completo.
2. O conteúdo é passado para o JavaScript final.
3. Pode ser adaptado para injeção real de `<style>`.

---

# Conceito Central

IDSL separa dois domínios:

1) Modelagem estrutural (livre)
2) Geração de JavaScript (#( )#)

Visualmente:

[ Gramática criada pelo autor ]
            ↓
            #( )
            ↓
[ JavaScript final ]

---

# Instalação

```bash
npm install dsljs
```

---

# Uso com Vite

```js
import { defineConfig } from "vite";
import dsljs from "dsljs/vite";

export default defineConfig({
  plugins: [dsljs()]
});
```

Arquivos .dsljs serão processados antes do bundler.

---

# Estrutura do Pacote

```
dsljs/
├── bin/
├── example/
├── src/
│   ├── parser.js
│   └── vite-plugin.js
├── package.json
└── README.md
```

---

# Configuração Obrigatória no VSCode

Criar pasta:

.projeto/
└── .vscode/
    └── settings.json

Conteúdo:

```json
{
    "files.associations": {
        "*.dsl.js": "javascript"
    },
    "[javascript]": {
        "editor.semanticHighlighting.enabled": true
    },
    "javascript.validate.enable": false
}
```

Necessário para evitar erros de LSP antes da expansão das macros.

---

# Observações

- Opera somente em tempo de compilação
- Não existe runtime adicional
- O código final é JavaScript puro
