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

1. Clique no ícone **Classroom 50** na barra lateral esquerda e em **Sign in with GitHub**
2. A aba **Assignments** lista suas organizações, turmas e atividades. Em cada atividade:
   - **Accept** (✓): aceita a atividade, clona o repositório e abre a pasta
   - **Clone** (☁): para atividades já aceitas, clona o repositório e abre a pasta
   - **Open** (📂): abre a pasta de uma atividade já clonada
3. Se o VS Code perguntar se você confia nos autores da pasta, escolha **Yes, I trust the authors**

Os repositórios são clonados em `~/classroom50/<organização>/`. O botão ⟳ no topo da aba
atualiza a lista.

As turmas aparecem depois que o professor cadastra o aluno e o aluno aceita o convite da
organização no GitHub. O aceite de atividades usa o `gh student accept`, então exige o
GitHub CLI com a extensão `gh-student` (veja os requisitos). Na primeira vez, rode
`gh auth login` em um terminal.

Também é possível aceitar e clonar pelo terminal, com `gh student accept <organização> <turma>
<atividade>` e o `git clone` exibido ao final. Nesse caso, abra no VS Code **a própria pasta do
repositório** (e não uma pasta que o contenha).

Os recursos de notificação e entrega só são ativados em repositórios de atividades do
Classroom 50, identificados pelo arquivo `.c50extension.json`. Em qualquer outro projeto a
extensão não exibe botões, mensagens nem pedidos de login.

### Notificações de feedback

A extensão verifica periodicamente o Feedback Pull Request da atividade. Ao encontrar um
feedback novo, mostra uma notificação com quem fez o feedback, uma prévia do texto e, se
houver, a quantidade de comentários de linha (`📍 Check inline comments`).

Os comentários são agrupados como o professor os escreveu:

- **Comentário geral**, feito na conversa do PR: um feedback
- **Review** (*Review changes*): um feedback com o texto geral e todos os comentários de
  linha daquela revisão

### Painel de feedback

O botão **Open feedback** da notificação, ou o ✉️ da barra de status, abre o painel de
feedback ao lado do código. Ele mostra:

- Os feedbacks não lidos em destaque, com autor, data e texto formatado
- Os comentários de linha com arquivo e linha. Clicar em `📍 Livro.java:42` abre o arquivo
  naquela linha
- Os feedbacks já lidos em uma seção recolhida **Read**, com menos destaque

Um feedback é marcado como lido quando o aluno clica em **Mark as read** ou em
**View on GitHub**. Enquanto houver feedback não lido, o ✉️ da barra de status fica com fundo
amarelo e o ícone Classroom 50 da barra lateral mostra a quantidade. Os não lidos continuam
disponíveis mesmo que o aluno feche a notificação ou reinicie o VS Code.

### Barra de status

| Botão | Função |
|---|---|
| ✉️ **N** | Abre o painel de feedback. Com feedback não lido, mostra a quantidade em destaque |
| 🔔 **Check Feedback** | Verifica agora, sem esperar o intervalo configurado |
| **Feedback PR** | Abre o Feedback Pull Request no navegador |
| ☁️ **Submit** | Entrega a atividade |
| 📖 **Support Materials** | Abre um painel com os materiais de apoio configurados pelo professor; cada material abre no navegador (aparece só se houver algum) |

### Entrega da atividade (Submit)

O botão **Submit** executa o comando oficial `gh student submit` em um terminal, após confirmação.

- **Não é preciso fazer commit antes:** o submit envia a pasta como ela está, incluindo arquivos
  modificados e arquivos novos (exceto os ignorados pelo `.gitignore`)
- **Na primeira vez**, o `gh` pode pedir login no próprio terminal. Responda às perguntas e
  autorize pelo navegador
- **Depois do envio**, a extensão sincroniza o repositório local com a versão entregue, e o
  VS Code deixa de mostrar os arquivos como modificados
- **Se a atividade tiver autograder** (campo `autograder` na configuração), a extensão avisa
  que a correção está em execução e, alguns minutos depois, verifica automaticamente se há
  novos feedbacks. O botão **View autograder run** abre a execução no GitHub

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

## Idioma

A extensão funciona em **português** e em **inglês**. Por padrão, ela segue o idioma do
VS Code. Para escolher outro, abra as configurações (`Ctrl+,`), procure por
**Classroom 50: Language** e escolha:

| Opção | Idioma |
|---|---|
| `auto` | Segue o idioma do VS Code (padrão) |
| `en` | Inglês |
| `pt-br` | Português do Brasil |

Ao trocar, a extensão pede para recarregar a janela. A configuração vale para mensagens,
notificações, painéis e as listas das guias laterais. Os nomes dos comandos (`Ctrl+Shift+P`) e
os títulos das guias seguem sempre o idioma do VS Code. As mensagens que vêm do `gh` e do
GitHub aparecem como essas ferramentas as enviam.

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
  },
  "autograder": true
}
```

| Campo | Obrigatório | Descrição |
|---|---|---|
| `assignment-name` | Sim | Nome da atividade exibido nas notificações |
| `polling-interval-minutes` | Sim | Intervalo, em minutos, entre as verificações de novos comentários |
| `notify-from-users` | Sim | Usuários do GitHub cujos comentários geram notificação. Se a lista estiver vazia (`[]`), qualquer comentário notifica |
| `support-links` | Não | Materiais de apoio no formato `"nome": "link"` (apenas URLs `http://` ou `https://`) |
| `autograder` | Não | `true` se a atividade tem correção automática. Depois do Submit, a extensão avisa que a correção está em execução e verifica os feedbacks alguns minutos depois. Padrão: `false` |

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
| `supportPanel.ts` | Painel dos materiais de apoio |
| `webview.ts` | Estrutura comum dos painéis: estilos, política de segurança e cliques |
| `feedbackPanel.ts` | Painel de feedback (Webview) com os feedbacks lidos e não lidos |
| `student.ts` | Monitoramento de feedback, notificações e botões do aluno |
| `submit.ts` | Execução do `gh student submit` como Task do VS Code |
| `gitsync.ts` | Sincronização do repositório local após o submit |
| `studentView.ts` | Aba lateral do aluno: turmas, atividades, aceite, clonagem e abertura |
| `teacher.ts` | Guia lateral do professor, abertura de repositórios e envio de avisos |
| `github.ts` | Chamadas à GitHub REST API |
| `config.ts` | Leitura e validação do `.c50extension.json` e do remote do git |
| `format.ts` | Formatação de textos e URLs |
| `ui.ts` | Componentes de interface reutilizáveis |
| `i18n.ts` | Tradução das mensagens (português e inglês) e escolha do idioma |
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