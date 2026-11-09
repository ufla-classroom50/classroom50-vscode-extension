# Changelog

Mudanças de cada versão da extensão.

## [0.2.0] — 2026-11

### Adicionado

- **Aba Atividades do aluno:** lista as turmas e atividades do aluno e permite aceitar, clonar e
  abrir cada atividade sem usar o terminal. As turmas são descobertas pelos times do GitHub e
  pelos arquivos públicos do Classroom 50.
- **Painel de feedback:** mostra os feedbacks não lidos em destaque e os já lidos em uma seção
  recolhida, com autor, foto, data e texto formatado. Os comentários de linha abrem o arquivo na
  linha comentada.
- **Feedbacks agrupados por review:** o texto geral e os comentários de linha de uma mesma review
  geram uma única notificação, com o aviso "Check inline comments".
- **Destaque de feedback não lido:** o ✉️ da barra de status fica com fundo amarelo, e o ícone
  Classroom 50 da barra lateral mostra a quantidade.
- **Painel de materiais de apoio**, no lugar da lista que abria no alto da tela.
- **Português e inglês**, com a configuração `classroom50.language` (`auto`, `en` ou `pt-br`).
- **Campo `autograder`** no `.c50extension.json`: a mensagem de autograder em execução e a
  verificação automática após a entrega só aparecem quando a atividade tem correção automática.
- Comentários no código explicando os módulos e as decisões de projeto.

### Corrigido

- Reviews escritas em *Review changes* sem comentários de linha não geravam notificação.

### Segurança

- Links de materiais de apoio só abrem se forem `http` ou `https`.
- Validação mais rígida do `.c50extension.json`.
- Arquivo temporário do aviso do professor criado em pasta privada e sempre apagado.

## [0.1.0] — 2026-09-28

Primeira versão.

- Notificações de feedback do Feedback PR em três níveis: aviso, prévia e link para o GitHub.
- Contador de feedbacks não lidos, com opção de marcar como lido.
- Entrega da atividade pelo botão Submit (`gh student submit`) e sincronização do repositório
  local após a entrega.
- Materiais de apoio configurados pelo professor.
- Guia do professor: escolha de organização e atividade, lista de alunos ordenada pelo último
  commit, abertura do repositório do aluno e envio de avisos.
- Suporte limitado a pastas não confiáveis (Restricted Mode).
