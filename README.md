# Classroom 50 — VS Code Extension

Extensão para o Visual Studio Code que integra o [Classroom 50](https://github.com/foundation50/classroom50)
ao editor. O aluno recebe dentro do VS Code os feedbacks deixados no Feedback Pull Request
da atividade e entrega o trabalho sem sair do editor. O professor acompanha os alunos de
uma atividade e envia avisos para eles por uma guia lateral.

Desenvolvida como Trabalho de Conclusão de Curso (TCC) —
Sistemas de Informação, Universidade Federal de Lavras (UFLA).

**Orientador:** Prof. Júlio César Alves

---

## Requisitos

- Visual Studio Code 1.134 ou superior
- Conta no GitHub
- Para entregar atividades pelo botão **Submit**: [GitHub CLI](https://cli.github.com/) com a
  extensão `gh-student`

```bash
gh extension install foundation50/gh-student
```

---

## Instalação

A extensão é distribuída como um arquivo `.vsix`.

1. Baixe o arquivo `classroom50-vscode-extension-<versão>.vsix`
2. No VS Code, abra a aba **Extensions** (`Ctrl+Shift+X`)
3. Clique no menu `...` no topo da aba e escolha **Install from VSIX...**
4. Selecione o arquivo baixado

Também é possível instalar pelo terminal:

```bash
code --install-extension classroom50-vscode-extension-<versão>.vsix
```

**Recomendado:** instale também a extensão **GitHub Pull Requests** (da Microsoft). Com ela, os
comentários inline do professor aparecem diretamente nas linhas do código, dentro do editor.

---

## Para o aluno

### Primeiros passos

1. Aceite a atividade com `gh student accept <organização> <turma> <atividade>`
2. Clone o repositório com o comando `git clone` exibido ao final do `accept`
3. No VS Code, use **File → Open Folder** e abra **a própria pasta do repositório**
   (e não uma pasta que o contenha)
4. Se o VS Code perguntar se você confia nos autores da pasta, escolha **Yes, I trust the authors**
5. Na primeira vez, a extensão pede login no GitHub: autorize com a sua conta

A extensão só é ativada em repositórios de atividades do Classroom 50, identificados pelo arquivo
`.c50extension.json`. Em qualquer outro projeto ela não exibe botões, mensagens nem pedidos de login.

### Notificações de feedback

A extensão verifica periodicamente o Feedback Pull Request da atividade. Ao encontrar um
comentário novo, notifica o aluno em três níveis:

- **Nível 1** — aviso de que existe um novo feedback, com o nome da atividade
- **Nível 2** — prévia do conteúdo do comentário
- **Nível 3** — botão **View on GitHub** para abrir o comentário completo

São detectados comentários gerais do PR e comentários inline, feitos em uma linha específica
do código. Nesse caso, a notificação indica o arquivo e a linha (ex.: `📍 Main.java:42`).

Um feedback é marcado como lido quando o aluno clica em **Mark as read** ou em
**View on GitHub**. Os feedbacks não lidos continuam disponíveis mesmo que o aluno feche a
notificação ou reinicie o VS Code.

### Barra de status

| Botão | Função |
|---|---|
| ✉️ **N** | Quantidade de feedbacks não lidos (aparece só quando há algum). Abre a lista para ler ou marcar como lido |
| 🔔 **Check Feedback** | Verifica agora, sem esperar o intervalo configurado |
| **Feedback PR** | Abre o Feedback Pull Request no navegador |
| ☁️ **Submit** | Entrega a atividade |
| 📖 **Support Materials** | Abre os materiais de apoio configurados pelo professor (aparece só se houver algum) |

### Entrega da atividade (Submit)

O botão **Submit** executa o comando oficial `gh student submit` em um terminal, após confirmação.

- **Não é preciso fazer commit antes:** o submit envia a pasta como ela está, incluindo arquivos
  modificados e arquivos novos (exceto os ignorados pelo `.gitignore`)
- **Na primeira vez**, o `gh` pode pedir login no próprio terminal. Responda às perguntas e
  autorize pelo navegador
- **Depois do envio**, a extensão sincroniza o repositório local com a versão entregue, e o
  VS Code deixa de mostrar os arquivos como modificados
- **Alguns minutos depois**, a extensão verifica automaticamente se há novos feedbacks do
  autograder. O botão **View autograder run** abre a execução no GitHub

A extensão avisa o aluno em duas situações:

- **Arquivos diferentes da versão enviada:** algum arquivo foi alterado durante o envio.
  Faça um novo submit para incluir essas mudanças
- **Commits locais não enviados:** o aluno fez commits próprios que não estão no histórico
  da entrega. Nesse caso o repositório não é sincronizado automaticamente; use `git pull`

---

## Para o professor

O modo professor é ativado para quem é administrador (Owner) de uma organização do GitHub que
usa o Classroom 50, ou seja, que possui o repositório de configuração `classroom50`. Nesse caso,
um ícone **Classroom 50** aparece na barra lateral esquerda do VS Code, com a guia **Teacher**.

### Primeiro acesso

A guia Teacher só aparece depois que a extensão é autorizada a usar a conta do GitHub.
No primeiro uso:

1. Clone o repositório template de uma atividade
2. Abra **a própria pasta do template** no VS Code (File → Open Folder)
3. Autorize a extensão a usar a sua conta do GitHub quando ela pedir

A partir daí, a guia aparece automaticamente em qualquer pasta aberta no VS Code.

Se você tiver mais de uma conta do GitHub no VS Code, escolha qual a extensão deve usar em
**Accounts** (canto inferior esquerdo) → **Manage Extension Account Preferences** → **Classroom 50**.

### Guia Teacher

1. **Organization** — selecione a organização (se houver apenas uma, ela já vem selecionada)
2. **Assignment** — selecione a atividade. Turmas e atividades são lidas automaticamente do
   repositório `classroom50` da organização
3. Os alunos da atividade são listados, ordenados pelo commit mais recente

| Botão | Função |
|---|---|
| ⟳ **Load students** | Recarrega a lista de alunos |
| ☑ **Select or clear all** | Marca ou desmarca todos os alunos |
| 📣 **Send announcement** | Envia um aviso para os alunos marcados |

- **Abrir o repositório de um aluno:** clique no nome do aluno. O repositório é clonado em
  `~/classroom50-students/<organização>/` na primeira vez e apenas reaberto nas seguintes
- **Enviar aviso:** marque os alunos, clique em 📣, escreva o aviso no editor que será aberto
  e salve o arquivo (`Ctrl+S`). Após a confirmação, o aviso é publicado como comentário no
  Feedback PR de cada aluno selecionado, com indicação de progresso e relatório de falhas

### Professor dentro de repositórios de atividade

Ao abrir o repositório de um aluno ou o template de uma atividade, a extensão reconhece que o
usuário é administrador da organização e exibe apenas o botão **Feedback PR** (quando existir).
As funções de aluno — monitoramento de feedback, contador de não lidos e Submit — não são ativadas.

---

## Pastas não confiáveis (Restricted Mode)

Quando uma pasta é aberta sem ser marcada como confiável, o VS Code entra em **Restricted Mode**.
Nesse modo, a extensão funciona de forma limitada, porque não executa comandos em repositórios
desconhecidos:

| Recurso | Pasta não confiável | Pasta confiável |
|---|---|---|
| Guia Teacher | ✅ | ✅ |
| Notificações, Submit e botão Feedback PR | ❌ | ✅ |

Em um repositório de atividade não confiável, a extensão exibe um aviso com o botão
**Manage Workspace Trust**. Ao confiar na pasta, os recursos são ativados na hora, sem
recarregar a janela.

Repositórios de alunos clonados pela guia Teacher abrem como pastas novas, então o VS Code pode
perguntar se o professor confia neles.

---

## Configuração da atividade

O professor adiciona um arquivo `.c50extension.json` na raiz do repositório template da
atividade. Esse arquivo é copiado automaticamente para o repositório de cada aluno no
`gh student accept`.

```json
{
  "assignment-name": "Atividade 1 — Herança e Polimorfismo",
  "polling-interval-minutes": 5,
  "notify-from-users": ["login-do-professor", "login-do-bot-de-feedback"],
  "support-links": {
    "Slides da aula": "https://exemplo.com/slides",
    "Documentação Java": "https://docs.oracle.com/en/java/"
  }
}
```

| Campo | Obrigatório | Descrição |
|---|---|---|
| `assignment-name` | Sim | Nome da atividade exibido nas notificações |
| `polling-interval-minutes` | Sim | Intervalo, em minutos, entre as verificações de novos comentários |
| `notify-from-users` | Sim | Usuários do GitHub cujos comentários geram notificação. Se a lista estiver vazia (`[]`), qualquer comentário notifica |
| `support-links` | Não | Materiais de apoio no formato `"nome": "link"` |

A organização e o repositório não precisam ser informados: a extensão os obtém a partir do
remote do git. Se o arquivo tiver algum campo inválido ou ausente, a extensão exibe uma
mensagem indicando qual campo deve ser corrigido.

O arquivo só chega aos repositórios criados **depois** de ser adicionado ao template.
Repositórios de alunos que já aceitaram a atividade precisam recebê-lo manualmente.

---

## Desenvolvimento

```bash
npm install
npm run compile
```

Para testar, abra o projeto no VS Code e pressione `F5` (ou `Ctrl+F5` para executar sem
depurador). Uma nova janela será aberta com a extensão carregada; nela, abra a pasta de um
repositório de atividade que contenha o `.c50extension.json`.

A janela de testes é aberta com `--disable-extensions`, carregando apenas esta extensão.
Na janela de testes, o Restricted Mode não se aplica a extensões em desenvolvimento; para
testar esse comportamento, gere e instale o pacote.

### Empacotamento

```bash
npm install -g @vscode/vsce
vsce package
```

O comando gera o arquivo `classroom50-vscode-extension-<versão>.vsix` na raiz do projeto.

### Estrutura do código

| Arquivo | Responsabilidade |
|---|---|
| `extension.ts` | Ponto de entrada: autenticação, confiança da pasta e ativação dos recursos de aluno e professor |
| `student.ts` | Monitoramento de feedback, notificações e botões do aluno |
| `submit.ts` | Execução do `gh student submit` como Task do VS Code |
| `gitsync.ts` | Sincronização do repositório local após o submit |
| `teacher.ts` | Guia lateral do professor, abertura de repositórios e envio de avisos |
| `github.ts` | Chamadas à GitHub REST API |
| `config.ts` | Leitura e validação do `.c50extension.json` e do remote do git |
| `format.ts` | Formatação de textos e URLs |
| `ui.ts` | Componentes de interface reutilizáveis |
| `constants.ts` | Identificadores de comandos, prioridades da barra de status e textos fixos |
| `types.ts` | Interfaces compartilhadas |

---

## Tecnologias

- TypeScript
- VS Code Extension API
- GitHub REST API
- Classroom 50 (`gh student` CLI e repositório de configuração `classroom50`)

---

## Status

Versão 0.1.0. Funcionalidades de aluno e professor implementadas e validadas em ambiente real
do Classroom 50.