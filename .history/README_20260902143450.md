# Classroom 50 — VS Code Extension

Extensão para o Visual Studio Code que notifica alunos sobre novos feedbacks
recebidos no Feedback Pull Request do Classroom 50.

Desenvolvida como Trabalho de Conclusão de Curso (TCC) —
Sistemas de Informação, Universidade Federal de Lavras (UFLA).

**Orientador:** Prof. Júlio César Alves

---

## Como funciona

Quando o aluno abre no VS Code o repositório de uma atividade do Classroom 50,
a extensão:

1. Autentica com o GitHub usando a conta do aluno
2. Lê o arquivo `.c50extension.json` para identificar a atividade
3. Detecta o repositório e a organização a partir do remote do git
4. Localiza o Feedback Pull Request da atividade
5. Verifica periodicamente se há novos comentários no PR
6. Ao detectar um comentário novo de um usuário configurado, notifica o aluno em três níveis:
   - **Nível 1** — aviso de que existe um novo feedback
   - **Nível 2** — prévia do conteúdo do feedback no pop-up
   - **Nível 3** — botão para abrir o comentário completo no GitHub

O aluno também pode verificar manualmente a qualquer momento pelo Command Palette
(`Ctrl+Shift+P` → **Classroom 50: Check for new feedback**).

---

## Configuração

O professor deve adicionar um arquivo `.c50extension.json` no repositório
template da atividade com o seguinte conteúdo:

```json
{
  "assignment-name": "Nome legível da atividade",
  "polling-interval-minutes": 5,
  "notify-from-users": ["login-do-usuario"]
}
```

- **`assignment-name`** — nome da atividade exibido nas notificações
- **`polling-interval-minutes`** — intervalo em minutos para verificar novos comentários
- **`notify-from-users`** — lista de usuários do GitHub cujos comentários disparam a notificação. Se vazio, qualquer comentário aciona a notificação

Esse arquivo é copiado automaticamente para o repositório do aluno no momento
do `gh student accept`.

---

## Tecnologias

- TypeScript
- VS Code Extension API
- GitHub REST API

---

## Status

Protótipo funcional — em desenvolvimento como parte do TCC.