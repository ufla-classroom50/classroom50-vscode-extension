# Classroom 50 — VS Code Extension

Extensão para o Visual Studio Code que integra o [Classroom 50](https://github.com/foundation50/classroom50)
ao editor. O aluno recebe dentro do VS Code os feedbacks deixados no Feedback Pull Request
da atividade e pode entregar o trabalho sem sair do editor. O professor acompanha os alunos
de uma atividade e envia avisos para eles por uma guia lateral.

Desenvolvida como Trabalho de Conclusão de Curso (TCC) —
Sistemas de Informação, Universidade Federal de Lavras (UFLA).

**Orientador:** Prof. Júlio César Alves

---

## Requisitos

- Visual Studio Code 1.134 ou superior
- Conta no GitHub
- Para o botão **Submit**: [GitHub CLI](https://cli.github.com/) com a extensão
  `gh-student` (`gh extension install foundation50/gh-student`)

---

## Para o aluno

A extensão só é ativada em repositórios de atividades do Classroom 50, identificados pela
presença do arquivo `.c50extension.json`. Em qualquer outro projeto ela não exibe botões,
mensagens nem pedidos de login.

Ao abrir o repositório de uma atividade, a extensão pede login no GitHub (apenas na primeira
vez), localiza o Feedback Pull Request da atividade e passa a verificar periodicamente se há
novos comentários.

### Notificações de feedback

Ao detectar um comentário novo de um usuário configurado, o aluno é notificado em três níveis:

- **Nível 1** — aviso de que existe um novo feedback, com o nome da atividade
- **Nível 2** — prévia do conteúdo do comentário
- **Nível 3** — botão **View on GitHub** para abrir o comentário completo

São detectados tanto comentários gerais do PR quanto comentários inline, feitos em uma linha
específica do código. Nesse caso, a notificação indica o arquivo e a linha (ex.: `📍 Main.java:42`).

Um feedback é marcado como lido quando o aluno clica em **Mark as read** ou em
**View on GitHub**. Os feedbacks não lidos continuam disponíveis mesmo que o aluno feche a
notificação ou reinicie o VS Code.

### Barra de status

| Botão                    | Função                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| ✉️ **N**                 | Quantidade de feedbacks não lidos (aparece só quando há algum). Abre a lista para ler ou marcar como lido |
| 🔔 **Check Feedback**    | Verifica agora, sem esperar o intervalo configurado                                                       |
| **Feedback PR**          | Abre o Feedback Pull Request no navegador                                                                 |
| ☁️ **Submit**            | Entrega a atividade executando `gh student submit`                                                        |
| 📖 **Support Materials** | Abre os materiais de apoio configurados pelo professor (aparece só se houver algum)                       |

### Entrega da atividade (Submit)

O botão **Submit** executa o comando oficial `gh student submit` em um terminal, após
confirmação. Esse comando envia o código para o repositório e dispara o autograder.
Se o envio der certo, a extensão verifica novos feedbacks alguns minutos depois e oferece
um atalho para acompanhar a execução do autograder no GitHub.

---

## Para o professor

O modo professor é ativado automaticamente para quem é administrador (Owner) de uma
organização do GitHub que usa o Classroom 50, ou seja, que possui o repositório de
configuração `classroom50`. Nesse caso, um ícone **Classroom 50** aparece na barra lateral
esquerda do VS Code, com a guia **Teacher**.

### Guia Teacher

1. **Organization** — selecione a organização (se houver apenas uma, ela já vem selecionada)
2. **Assignment** — selecione a atividade. A lista de turmas e atividades é lida
   automaticamente do repositório `classroom50` da organização
3. Os alunos da atividade são listados, ordenados pelo commit mais recente

Botões no topo da guia:

| Botão                     | Função                                 |
| ------------------------- | -------------------------------------- |
| ⟳ **Load students**       | Recarrega a lista de alunos            |
| ☑ **Select or clear all** | Marca ou desmarca todos os alunos      |
| 📣 **Send announcement**  | Envia um aviso para os alunos marcados |

- **Abrir o repositório de um aluno:** clique no nome do aluno. O repositório é clonado em
  `~/classroom50-students/<organização>/` na primeira vez e apenas reaberto nas seguintes
- **Enviar aviso:** marque os alunos, clique em 📣, escreva o aviso no editor que será aberto
  e salve o arquivo (`Ctrl+S`). Após a confirmação, o aviso é publicado como comentário no
  Feedback PR de cada aluno selecionado, com indicação de progresso e relatório de falhas

### Professor dentro de repositórios de atividade

Ao abrir o repositório de um aluno ou o repositório template da atividade, a extensão
reconhece que o usuário é administrador da organização e exibe apenas o botão
**Feedback PR** (quando existir). As funções de aluno — monitoramento de feedback,
contador de não lidos e Submit — não são ativadas.

### Primeiro acesso

A guia Teacher aparece quando a extensão encontra uma sessão do GitHub com as permissões
de que precisa. No primeiro uso, **abra o repositório template de uma atividade** (que
contém o `.c50extension.json`): a extensão solicitará o login. A partir daí, a guia passa
a aparecer automaticamente em qualquer pasta aberta no VS Code.

---

## Configuração da atividade

O professor deve adicionar um arquivo `.c50extension.json` na raiz do repositório template
da atividade. Esse arquivo é copiado automaticamente para o repositório de cada aluno no
momento do `gh student accept`.

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

| Campo                      | Obrigatório | Descrição                                                                                                             |
| -------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| `assignment-name`          | Sim         | Nome da atividade exibido nas notificações                                                                            |
| `polling-interval-minutes` | Sim         | Intervalo, em minutos, entre as verificações de novos comentários                                                     |
| `notify-from-users`        | Sim         | Usuários do GitHub cujos comentários geram notificação. Se a lista estiver vazia (`[]`), qualquer comentário notifica |
| `support-links`            | Não         | Materiais de apoio no formato `"nome": "link"`                                                                        |

A organização e o repositório não precisam ser informados: a extensão os obtém a partir do
remote do git. Se o arquivo tiver algum campo inválido ou ausente, a extensão exibe uma
mensagem indicando qual campo deve ser corrigido.

---

## Desenvolvimento

```bash
npm install
npm run compile
```

Para testar, abra o projeto no VS Code e pressione `F5` (ou `Ctrl+F5` para executar sem
depurador). Uma nova janela será aberta com a extensão carregada; nela, abra uma pasta que
contenha um `.c50extension.json` e cujo remote aponte para um repositório com Feedback PR.

### Estrutura do código

| Arquivo        | Responsabilidade                                                            |
| -------------- | --------------------------------------------------------------------------- |
| `extension.ts` | Ponto de entrada: autenticação e ativação dos recursos de aluno e professor |
| `student.ts`   | Monitoramento de feedback, notificações e botões do aluno                   |
| `submit.ts`    | Execução do `gh student submit` como Task do VS Code                        |
| `teacher.ts`   | Guia lateral do professor, abertura de repositórios e envio de avisos       |
| `github.ts`    | Chamadas à GitHub REST API                                                  |
| `config.ts`    | Leitura e validação do `.c50extension.json` e do remote do git              |
| `format.ts`    | Formatação de textos e URLs                                                 |
| `ui.ts`        | Componentes de interface reutilizáveis                                      |
| `constants.ts` | Identificadores de comandos, prioridades da barra de status e textos fixos  |
| `types.ts`     | Interfaces compartilhadas                                                   |

---

## Tecnologias

- TypeScript
- VS Code Extension API
- GitHub REST API
- Classroom 50 (`gh student` CLI e repositório de configuração `classroom50`)

---

## Status

Protótipo funcional em desenvolvimento como parte do TCC. Funcionalidades de aluno e
professor implementadas; validação em ambiente real do Classroom 50 em andamento.
