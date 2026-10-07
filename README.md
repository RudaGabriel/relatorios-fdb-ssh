# Relatórios FDB — Painel de vendas em tempo real para Small Commerce (Firebird)

> Desenvolvido por **Ruda Gabriel**

Sistema de relatórios de vendas para lojas que usam o **Small Commerce (SmallSoft)** sobre banco **Firebird** (`SMALL.FDB`). Um servidor Node.js lê o banco direto e publica na rede local um painel web com as vendas do dia: **Gerencial, NFC-e e NF-e**, por vendedor, forma de pagamento e item. A tela se atualiza sozinha em menos de um segundo a cada venda, cancelamento ou autorização da SEFAZ.

O sistema roda em segundo plano no Windows, com ícone na bandeja. Ele inicia junto com o logon, se recupera sozinho de quedas e pode ser aberto de qualquer computador da loja pelo navegador.

---

## Sumário

- [Principais recursos](#principais-recursos)
- [Como funciona](#como-funciona)
- [Requisitos](#requisitos)
- [Instalação](#instalação)
- [Uso no dia a dia](#uso-no-dia-a-dia)
- [Busca e filtros (coringas)](#busca-e-filtros-coringas)
- [Configuração (`config.json`)](#configuração-configjson)
- [API HTTP](#api-http)
- [Cliente de linha de comando (`api.ps1`)](#cliente-de-linha-de-comando-apips1)
- [Correção automática de horário](#correção-automática-de-horário)
- [Somente leitura](#somente-leitura)
- [Segurança](#segurança)
- [Logs e diagnóstico](#logs-e-diagnóstico)
- [Testes automáticos](#testes-automáticos)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Solução de problemas](#solução-de-problemas)
- [Créditos](#créditos)

---

## Principais recursos

### Relatório de vendas
- **Vendas do dia, de uma data ou de um período**, unindo três fontes do Small Commerce:
  - tabela `NFCE`: Gerencial (modelo 99), NFC-e (65) e NF-e (55)
  - tabela `VENDAS`: NF-e
  - tabela `PAGAMENT`: formas de pagamento
- **Totais por tipo de documento e por vendedor**, com quantidade e valor; o painel lateral mostra o total por vendedor.
- **Detalhe da venda** com itens, quantidades, preços, descontos, formas de pagamento com valores, cliente, natureza da operação e hora com data do documento.
- **Reconciliação automática de documentos:**
  - gerencial convertida em NFC-e (vínculo pela coluna `GERENCIAL`) não é contada duas vezes;
  - gerencial convertida manualmente em NF-e é associada pelo mesmo valor e data, com no máximo uma gerencial por NF-e;
  - recebimentos "fantasma" de vendas convertidas são absorvidos pelo documento fiscal;
  - NF-e rejeitadas pela SEFAZ são descartadas.
- **Painel "Duplicatas"** para as gerenciais suprimidas automaticamente, com três ações:
  - "Manter todas", que passa a exibir e somar todas;
  - "Perguntar depois sobre essa";
  - "Não perguntar mais sobre essa".
- **Vendas aguardando autorização da SEFAZ** aparecem na hora, com rótulo próprio. Vendedor e hora são herdados da gerencial de origem.

### Tempo real
- **Fast-poll:** consulta leve a partir de 15 ms (adaptativo: nunca ocupa mais de 1/3 do tempo do banco do caixa) numa conexão persistente com o Firebird, separada por tipo (**Gerencial, NFC-e e NF-e**, inclusive a NF-e gravada só na tabela VENDAS). Detecta:
  - venda nova e cancelamento;
  - total que **sobe ou desce** em cada tipo (o log mostra o sentido e a diferença, ex.: `NFC-e: total R$ 80,00 → R$ 90,00 (↑ +R$ 10,00)`);
  - venda que **muda de tipo** com o mesmo valor (gerencial → NFC-e);
  - venda alterada sem mudar quantidade nem total geral: **troca de vendedor**, de número ou valores que se compensam entre vendas;
  - **troca de forma de pagamento** (ex.: Dinheiro → PIX) ou de valor entre pagamentos;
  - NFC-e autorizada; vendedor ou forma de pagamento preenchidos depois da venda.

- **Tempo até a tela atualizar:** ~140 ms do registro da venda no banco até o navegador ser avisado (medido num Firebird 3 local; era ~315 ms). Para isso:
  - fast-poll a partir de 15 ms, que se ajusta sozinho ao tempo da consulta (no máximo 1/3 do tempo do Firebird; com 300 mil vendas e índice em `DATA`, ~45 ms);
  - fast-poll **dividido pelos índices** (v2.15.0): ao conectar, o sistema lê no catálogo quais tabelas têm índice na coluna de data (`NFCE.DATA`, `PAGAMENT.DATA`, `VENDAS.SAIDAD`/`EMISSAO`). As que têm vão para a **consulta rápida** (até 1/4 do tempo do banco); as que não têm, para a **complementar** (1/12, entre 250 ms e 30 s). Se todas têm índice — ou nenhuma tem — fica uma **consulta única**, como antes. O log mostra a divisão e o tempo de cada parte, por exemplo: `FastPoll: consulta rápida (NFCE, com índice) ~13 ms → a cada ~52 ms | complementar (PAGAMENT, VENDAS (NF-e), sem índice) ~269 ms → a cada ~3228 ms`. Numa base como a da loja (índice só em `NFCE.DATA`, 300 mil vendas), a venda nova passou a ser detectada em ~327 ms em vez de ~730 ms;
  - um **gerador pré-aquecido** fica sempre pronto (Node e driver do Firebird já carregados) e só lê configuração, data e hora quando recebe a ordem;
  - o gerador avisa "HTML pronto" assim que grava o arquivo, sem esperar fechar as conexões com o banco;
  - **um refresh por movimento** (v2.15.3): o caixa grava venda e pagamento em transações separadas. A geração espera o movimento terminar: venda nova ou excluída espera o pagamento correspondente (até 1,5 s); gerencial convertido em NFC-e espera a autorização (até 8 s). Gera **uma vez**, com tudo — antes, eram 2 refresh por venda/exclusão e 3 por conversão;
  - a verificação completa (reserva do fast-poll) roda a cada 1 s — a cada 10 s enquanto o fast-poll completo está saudável — e não regera em dobro o que o fast-poll já regerou;
  - numa rajada de vendas, a geração em andamento **termina** e a próxima começa logo em seguida (antes, cada venda nova cancelava a geração e a tela só atualizava quando o movimento parava).

  Cada venda e cada pagamento entram numa assinatura (hash) somada por tipo, numa única leitura por tabela. Se o Firebird não aceitar essa consulta, o fast-poll segue automaticamente no modo básico (quantidade e total), sem parar a detecção.
- **Atualização automática do navegador por SSE** (Server-Sent Events), com polling HTTP como reserva.
- Avisos na tela (toasts) para correções de horário.
- **Aviso claro de servidor encerrado:** quando o servidor é encerrado ou a conexão cai por mais de 4 s, o relatório aberto mostra uma faixa no topo ("Servidor de relatórios encerrado", "Servidor reiniciando..." ou "Sem conexão com o servidor") e recarrega sozinho quando o servidor volta.

### Interface
- **16 temas de cores** (10 escuros e 6 claros), com prévia no menu; a escolha fica salva no navegador.
- Tabela no computador e cartões no celular, com renderização em blocos para dias com muitas vendas.
- **Busca avançada** com coringas de valor, texto, campo e operadores lógicos (veja [abaixo](#busca-e-filtros-coringas)).
- **Filtro de "proibidos"**: lista de produtos ou marcas que podem ser ocultados ou isolados com uma tecla.
- **Chip de desconto**: na coluna Itens, depois dos 3 primeiros itens e do "+N mais…", a venda com desconto mostra um chip vermelho com o percentual e o valor (ex.: `Desconto de 10% (−R$ 7,50)`), cortado com reticências quando não couber. Passando o mouse aparecem o valor do desconto, a soma dos itens, o total com desconto e cada linha de desconto; o clique abre os detalhes da venda.
- **Editor de proibidos inteligente**: mostra quantos termos foram adicionados (e quantos são filtros de valor) e ajusta sozinho listas coladas em outro formato — separadas por vírgula, ponto e vírgula, tabulação ou `|`, lista JSON, com marcadores, aspas ou repetidas — para o formato aceito, um termo por linha. Vírgula entre números (`AGUA 1,5L`, `>100=6578,96`) é decimal e não separa termos.
- **Teclas de atalho personalizáveis**: cada tecla executa um comando de busca e/ou uma ação (copiar, filtrar, trocar tema…).
- **Ferramentas de cópia** para a área de transferência: tudo, com itens, sem dinheiro, só gerencial.
- Configurações editáveis pela própria tela: nome do sistema, ícone, intervalos, janela de correção de horário, proibidos e atalhos.

### Operação
- **Ícone na bandeja do Windows** com abrir relatório, atualizar, gerar por período, configurações, selecionar banco, reiniciar e sair.
- **Watchdog:** o servidor é reiniciado sozinho se cair ou travar.
- **Inicialização automática** ao fazer logon (qualquer usuário) e ao ligar o computador, imediata e sem condições (funciona também em notebook na bateria), reiniciando a cada 1 min em caso de falha, com espera de até 30 min pela pasta de rede e pelo banco.
- **Detecção automática do banco:**
  - caminhos locais conhecidos;
  - endereço salvo no `config.json`;
  - varredura da rede local na porta 3050.
  - Se nada funcionar, abre uma página para escolher o `SMALL.FDB` manualmente; quando o banco volta, reconecta sozinho.
- **Acesso pela rede da loja:** qualquer computador abre `http://IP-DO-SERVIDOR:7734`.
- **Instalação automática de dependências** pelos `.bat`: Node.js (com verificação de integridade do instalador) e o módulo `node-firebird`.

---

## Como funciona

```
 Windows (logon)
   └─ Tarefa agendada ─▶ bootstrap.vbs ─▶ launcher.vbs ─▶ iniciar-tray.ps1  (ícone na bandeja + watchdog)
                                                            └─▶ node servidor-relatorio.js
                                                                  ├─ fast-poll (≥15 ms)─┐
                                                                  ├─ pollStatus (≥1 s)  ├─▶ Firebird (SMALL.FDB)  — SOMENTE LEITURA
                                                                  └─ gera o HTML em subprocesso:
                                                                       node gerar-relatorio-html.js ─▶ Firebird  — SOMENTE LEITURA
 Navegador (qualquer PC da rede) ◀── HTTP :7734 + SSE ──┘
```

| Componente | Função |
|---|---|
| `servidor-relatorio.js` | Servidor HTTP e SSE. Detecta o banco, monitora mudanças (somente leitura), mantém o cache de relatórios e coordena as gerações. |
| `gerar-relatorio-html.js` | Subprocesso que consulta o Firebird (somente leitura) e monta o HTML completo do relatório (dados, interface e scripts); decide a hora exibida das vendas (correção só na tela). |
| `iniciar-tray.ps1` | Ícone na bandeja, menu de ações e watchdog que reinicia o servidor se ele cair ou travar. |
| `launcher.vbs` / `bootstrap.vbs` | Iniciam o tray de forma oculta. O bootstrap fica local e espera a pasta de rede aparecer no logon. |
| `instalar-na-inicializacao.bat` | Configura a inicialização automática (tarefa agendada ou pasta Inicializar), a regra de firewall e o nome do sistema. |
| `remover-inicializacao.bat` | Desfaz a inicialização automática e, se você confirmar, encerra todos os processos do relatório. |
| `gerar_relatorio_*.bat` | Atalhos para abrir o relatório do dia, de uma data ou de um período (iniciam o servidor se preciso). |
| `api.ps1` | Cliente de linha de comando para todas as rotas da API, com menu interativo. |
| `_instalar-node.ps1` / `node-firebird.bat` | Instalam o Node.js e o módulo `node-firebird`. |

---

## Requisitos

- **Windows 10 ou 11** na máquina que roda o servidor.
- **Node.js 18 ou superior.** Os `.bat` instalam a versão LTS automaticamente se não houver.
- Módulo **`node-firebird`**, instalado automaticamente pelos `.bat`.
- Acesso ao **Firebird** do Small Commerce, local ou na rede (porta 3050).
- Para acesso de outros computadores: porta **7734** liberada no firewall. O instalador faz isso.

---

## Instalação

1. Copie a pasta do sistema para a máquina servidora (ou para uma pasta de rede).
2. Execute **`instalar-na-inicializacao.bat`**. Ele:
   - pede privilégio de administrador;
   - instala o Node.js e o `node-firebird`, se necessário;
   - pergunta o nome do sistema (ex.: o nome da loja);
   - cria a tarefa de inicialização automática e libera a porta no firewall;
     a tarefa dispara **ao fazer logon** (qualquer usuário) e **ao inicializar**, sem condições
     (ocioso, energia, rede), reinicia a cada 1 min até 99 vezes se falhar, não tem limite de
     tempo e nunca abre uma segunda cópia;
   - inicia o servidor imediatamente.
3. Se o banco não usar as credenciais de fábrica, defina `fbUser` e `fbPass` no `config.json`.
4. Abra o relatório pelo ícone da bandeja (duplo clique) ou em `http://localhost:7734`.

> Para só testar, sem inicialização automática, execute `gerar_relatorio_do_dia.bat`.

### Remover a inicialização automática

Execute **`remover-inicializacao.bat`**. Ele remove tudo o que inicia o relatório sozinho no logon:

- a tarefa agendada, com qualquer nome, inclusive de versões antigas;
- o atalho na pasta Inicializar e as entradas nas chaves `Run` do registro;
- o bootstrap local em `%LOCALAPPDATA%\RelatoriosBootstrap`, inclusive um bootstrap que esteja aguardando a rede.

Antes de começar, ele pergunta se deve **encerrar todos os processos do relatório** (servidor, ícone da bandeja e gerações em andamento):

- **S**: o servidor é encerrado de forma ordenada (registra no log e as telas abertas mostram "Servidor de relatórios encerrado"); o que não responder em alguns segundos é forçado.
- **N**: o servidor continua rodando até você sair pelo ícone da bandeja ou reiniciar o computador.

Só são considerados processos `node`, `powershell`, `wscript` e `cscript` cuja linha de comando cite arquivos do sistema. Um editor com um desses arquivos aberto, por exemplo, nunca é encerrado.

O privilégio de administrador (UAC) só é pedido se algum item exigir, como a tarefa criada pelo instalador. Ao final aparece um resumo do que foi removido e de eventuais pendências, e tudo também é registrado no `relatorio.log` (linhas `[REMOVER]`).

Não são apagados: `config.json`, logs, cache e a regra de firewall. Para reativar, rode `instalar-na-inicializacao.bat` de novo.

---

## Uso no dia a dia

| Ação | Como |
|---|---|
| Relatório de hoje | Duplo clique no ícone da bandeja, `gerar_relatorio_do_dia.bat` ou `http://IP:7734/` |
| Data específica | `gerar_relatorio_por_data.bat` (aceita `D/M`, `DD/MM` ou `DD/MM/AA[AA]`) |
| Período | `gerar_relatorio_intervalo.bat`, botão **Por período** ou `http://IP:7734/periodo` |
| Forçar atualização | Botão **Atualizar** ou menu da bandeja → *Atualizar dados de hoje* |
| Trocar o banco | Menu da bandeja → *Selecionar banco (FDB)...* ou `http://IP:7734/selecionar-fdb` |
| Configurações | Botão **Configurações** no relatório ou `http://IP:7734/config` |
| Reiniciar | Menu da bandeja → *Reiniciar servidor* ou `api.ps1 -Endpoint restart` |

**Atalhos de teclado do relatório** (fora de campos de texto):

| Tecla | Efeito |
|---|---|
| `Insert` ou `CapsLock`+`P` | Adiciona `[proibidos]`: oculta vendas com itens proibidos |
| `Delete` | Adiciona `[-proibidos]`: mostra **somente** vendas com itens proibidos (na busca, só quando não há texto à frente do cursor) |
| `Esc` | Fecha janelas e modais |
| Personalizadas | Configuráveis em *Configurações → Teclas de atalho* (F1–F12, Insert, Delete, Home, End, PageUp/Down e combinações com Ctrl/Alt) |

---

## Busca e filtros (coringas)

A caixa de busca aceita filtros combináveis. A ajuda completa fica no botão **Ajuda** do relatório.

| Coringa | Significado | Exemplo |
|---|---|---|
| `>` `>=` `<` `<=` | Valor maior / menor | `>100`, `<150-granel` |
| `100-200` | Intervalo de valores | `50-80` |
| `=151` / `=151*5` | Combinação de vendas que somam o alvo (com tolerância opcional) | `=151*5` |
| `*` `/` `?` | Padrões de dígitos no valor | `15*`, `/15/`, `1?0` |
| `palavra*`, `*palavra`, `*palavra*` | Começa com / termina com / contém | `RACAO*`, `*GATO` |
| `A\|B` | Ou | `dinheiro\|pix` |
| `+` | E (todos os filtros) | `>50+dinheiro+-entrega` |
| `-termo` | Exclui | `cartao-credito-debito` |
| `[a,~b,=c]` | Lista de exclusão (token, contém, exato) | `[granel,~entrega,=pix]` |
| `[proibidos]` / `[-proibidos]` | Oculta / isola vendas com itens proibidos | `[-p]` |
| `vendedor:` `item:` `caixa:` `numero:` `cliente:` `hora:` `pag:` `nat:` `tipo:` | Filtro por campo | `vend:MARIA`, `item:*RACAO*`, `tipo:nfce` |

Os botões **Todos / Gerencial / NFC-e / NF-e**, ao lado da busca, restringem o tipo de documento.

---

## Configuração (`config.json`)

| Chave | Padrão | Descrição |
|---|---|---|
| `appName` | `"Relatorios"` | Nome exibido no título, na bandeja e nas janelas |
| `porta` | `7734` | Porta HTTP do servidor |
| `fdbPath` | `""` | Caminho do `SMALL.FDB`; salvo automaticamente ao selecionar o banco |
| `fbHost` | `""` | Host do Firebird; salvo automaticamente quando o banco é encontrado |
| `fbUser` / `fbPass` | `SYSDBA` / `masterkey` | Credenciais do Firebird (repassadas aos processos por variável de ambiente, nunca pela linha de comando) |
| `maquinaIP` | automático | IP desta máquina na rede; atualizado a cada inicialização |
| `pollInterval` | `100` | Intervalo (ms, mínimo 100) da verificação de reserva do navegador (o aviso principal chega na hora por SSE); a verificação completa do servidor usa 5× esse valor, no mínimo 1 s |
| `spawnTimeoutMs` | `120000` | Tempo máximo (30 s a 600 s) para gerar um relatório; aumente para períodos longos |
| `toastDuration` | `5000` | Duração dos avisos na tela (ms) |
| `janelaCorrecaoHoraMin` | `180` | Janela (min) da correção de horário (só na tela), de 5 a 720 (veja [Correção automática de horário](#correção-automática-de-horário)) |
| `maxLogLines` | `5000` | Linhas mantidas no `relatorio.log` |
| `logDebug` | `false` | Registra detalhes de rotina (tempos de consulta etc.) |
| `favicon` | `""` | Ícone personalizado (arquivo dentro da pasta do sistema) |
| `proibidos` | `[]` | Lista de produtos/termos do filtro de proibidos |
| `teclasPersonalizadas` | `[]` | Atalhos: `{ "tecla": "F2", "comando": "[-proibidos]>150", "acao": "" }` |

O arquivo `hora-fixada-cache.json` é criado e mantido pelo próprio sistema (não faz parte do pacote). Ele guarda os horários já corrigidos do dia e não precisa ser editado. O mesmo vale para `relatorio.log` e `favicon.png` (criado ao enviar um ícone).

---

## API HTTP

Todas as rotas respondem na porta configurada (padrão `7734`).

| Rota | Método | Descrição |
|---|---|---|
| `/` | GET | Relatório de hoje |
| `/periodo?i=AAAA-MM-DD&f=AAAA-MM-DD` | GET | Relatório de um período (sem parâmetros: formulário) |
| `/atualizar` | GET | Descarta o cache de hoje e regenera |
| `/config` | GET | Página de configurações |
| `/selecionar-fdb` | GET | Página de seleção do banco |
| `/pronto?k=CHAVE` | GET | Estado de uma geração em andamento |
| `/api/status` | GET | Quantidade e total do dia, por tipo, e avisos de correção |
| `/api/db-status` | GET | Estado da conexão com o banco |
| `/api/events` | GET | Fluxo SSE (atualização em tempo real) |
| `/api/config` | GET/POST | Lê e salva as configurações |
| `/api/proibidos` | GET/POST | Lê e salva a lista de proibidos |
| `/api/salvar-fdb` | POST | Define o banco: `{ "caminho": "C:\\...\\SMALL.FDB" }` ou `"IP:C:\\...\\SMALL.FDB"` |
| `/api/abrir-picker-fdb` | GET | Abre o seletor de arquivos do Windows na máquina servidora |
| `/api/upload-favicon` | POST | Envia um ícone PNG/ICO/JPEG (até 2 MB) |
| `/api/navigate/hoje` · `/config` · `/selecionar-fdb` · `/periodo/INI/FIM` · `/hash/{config\|periodo}` · `/foco` | GET | Comandam as abas abertas via SSE |
| `/api/sse-clients` | GET | Número de abas conectadas |
| `/api/restart` | GET | Reinicia o servidor (apenas rede local) |
| `/api/encerrar[?reiniciar=1&origem=texto]` | GET | Encerramento ordenado: registra no log, avisa as abas abertas e sai (apenas rede local) |
| `/api/log-error`, `/api/hora-usuario` | POST | Uso interno do navegador |

---

## Cliente de linha de comando (`api.ps1`)

Cliente PowerShell para todas as rotas acima. Pode ser usado na própria máquina ou em outro computador da rede.

```powershell
.\api.ps1                                   # menu interativo
.\api.ps1 -Endpoint status                  # vendas e total do dia
.\api.ps1 -Endpoint db-status
.\api.ps1 -Endpoint proibidos -Payload @("GRANEL","ENTREGA")
.\api.ps1 -Endpoint navigate-periodo -Payload @("2026-10-01","2026-10-05")
.\api.ps1 -Endpoint restart -MaquinaIP 192.168.1.50
.\api.ps1 -Endpoint meu-ip                  # nome e IP(s) desta máquina
.\api.ps1 -Endpoint itens-venda -Payload @("2026-10-07","000123")
.\api.ps1 -Endpoint abrir-periodo -Payload @("2026-10-01","2026-10-05")
.\api.ps1 -Endpoint encerrar -Payload SIM   # desliga o servidor
```

O cabeçalho do menu mostra o **nome e o IP desta máquina** (a que abriu o `api.ps1`) — o IP da placa de rede usada para chegar ao servidor — e avisa quando ela é a própria máquina do servidor.

| Opção | O que faz |
|---|---|
| `meu-ip` | Nome, usuário e todos os IPv4 desta máquina |
| `encerrar` | Desliga o servidor de forma ordenada (pede `SIM`); para ligar de novo, `restart` ou o atalho |
| `foco` | Traz a aba do relatório para frente |
| `modal-config` / `modal-periodo` | Abre a janela de configuração / "gerar por período" na aba aberta |
| `atualizar` | Força uma nova geração do relatório de hoje |
| `itens-venda` | Itens de uma venda (data + número do cupom/pedido) |
| `abrir-navegador` / `abrir-periodo` | Abre o relatório (de hoje / de um período) no navegador **desta** máquina |

No `status`, o valor `-1` significa "ainda não lido do banco" (servidor recém-ligado ou banco fora do ar) — a resposta traz um campo `obs` explicando.

Repete automaticamente em falha de rede ou erro 5xx; erros 4xx falham na hora. Erros mostram também o motivo enviado pelo servidor. Cada chamada se identifica no log do servidor com o nome do computador e do usuário.

---

## Correção automática de horário

Relógios de PDV adiantados ou atrasados e vendas abertas há muito tempo gravam horários que embaralham a ordem do relatório. O sistema corrige isso **só na tela do relatório**: o banco de dados nunca é alterado (ver [Somente leitura](#somente-leitura)).

| Situação | Regra (Gerencial, NFC-e e NF-e) |
|---|---|
| **Venda nova** (apareceu com o sistema ligado) | Hora no futuro, ou entre 3 min e a **janela de correção** atrás → exibida com a hora em que apareceu. Até 3 min atrás → aceita. Mais antiga que a janela → ignora. A janela é configurável e o padrão é **3 horas**. |
| **Venda que já existia** ao ligar, reconectar ou trocar de banco | Exibida como está (só hora no futuro é ajustada) — não dá para saber se a hora dela estava errada quando chegou. |
| **Exibição** | A hora decidida fica guardada em `hora-fixada-cache.json` (arquivo da pasta do sistema, fora do banco), para a venda não "pular" de posição a cada atualização. |

A **janela de correção** fica em *Configurações → Janela de correção de horário (min)*, no relatório ou em `/config`, ou na chave `janelaCorrecaoHoraMin` do `config.json`. O padrão é 180 min (3 horas), o mínimo é 5 min e o máximo é 720 min (12 horas). A mudança vale na hora, sem reiniciar. Perto da meia-noite a janela começa às 00:00 (nunca alcança vendas do dia anterior) e as correções continuam ativas.

Cada correção é registrada no log (`Hora corrigida na tela (banco não alterado)`) e avisada na tela.

Se uma venda com hora fixada for **cancelada** ou **convertida** (gerencial → NFC-e/NF-e), a entrada dela no `hora-fixada-cache.json` passa a mostrar isso — a hora fixada não muda:

```json
"2026-10-07|63467": { "tipo": "gerencial", "hora": "12:55", "situacao": "cancelada" },
"2026-10-07|63449": { "tipo": "gerencial", "hora": "11:48", "situacao": "convertida",
                      "convertidaEm": { "tipo": "nfce", "numero": "125269" } }
```

Se a venda voltar a ficar ativa, os campos `situacao`/`convertidaEm` saem.

---

## Somente leitura

O sistema **nunca escreve no banco do Small Commerce** — nenhum `UPDATE`, `INSERT`, `DELETE` ou alteração de estrutura, em nenhuma situação. Duas travas, no servidor e no gerador:

1. **Comando:** só é enviado ao banco SQL que começa com `SELECT` ou `WITH`. Qualquer outro comando é recusado antes de sair do sistema.
2. **Transação:** toda leitura roda numa transação **somente leitura** do próprio Firebird (READ COMMITTED, sem espera). Mesmo que um comando de escrita escapasse da primeira trava, o Firebird o recusaria (`Attempted update during read-only transaction`) — e a leitura nunca fica esperando o caixa.

Verificado num Firebird 3 com o sistema em uso e vendas simuladas: milhares de transações observadas pelo monitoramento do próprio Firebird (`MON$TRANSACTIONS`), **todas somente leitura**.

Arquivos que o sistema grava ficam **só na pasta dele** (`config.json`, `relatorio.log`, `hora-fixada-cache.json`).

**Índices:** ao conectar, o sistema confere no catálogo do banco (só lendo) se `NFCE.DATA`, `PAGAMENT.DATA` e `VENDAS.SAIDAD` têm índice e escreve no log `Índices: ... ok` ou `AVISO índices: sem índice em ...`. Sem índice cada leitura percorre a tabela inteira; como o sistema é somente leitura, ele **não cria** índices — o aviso diz o que pedir ao suporte do Small Commerce. O fast-poll usa essa mesma leitura para decidir o que vai na consulta rápida (ver acima).

---

## Segurança

- Senha do Firebird passada por **variável de ambiente**, nunca pela linha de comando (que fica visível na lista de processos).
- Proteção contra **XSS**: todo JSON embutido em `<script>` é escapado, e textos do usuário são escapados no HTML.
- Validação de todas as entradas da API: listas, datas de calendário, tamanhos máximos e caminhos de ícone restritos à pasta do sistema.
- Registro de erros do navegador **sem quebras de linha forjáveis** no log.
- Reinício remoto aceito só da rede local. As demais rotas são abertas à rede da loja, por design.
- Gravação **atômica** (arquivo temporário + renomear) de `config.json`, do cache de horas e dos relatórios: um desligamento no meio da gravação nunca corrompe os arquivos.
- O instalador do Node.js confere o **SHA-256** oficial (ou a assinatura digital) antes de executar.

---

## Logs e diagnóstico

Tudo vai para **`relatorio.log`**, na pasta do sistema: servidor, bandeja, instalador e removedor, no formato `[DD-MM-AAAA] [HH:MM:SS] [CATEGORIA] mensagem`. A categoria logo após o horário facilita achar e filtrar (por exemplo, procure `[VENDAS]`):

```
[07-10-2026] [08:00:01] [SERVIDOR] === Servidor iniciado 07/10/2026 === Servidor v2.15.4 | Gerador v3.8.0
[07-10-2026] [08:00:06] [BANCO] Índices: NFCE.DATA, PAGAMENT.DATA — ok (consultas rápidas).
[07-10-2026] [12:43:31] [VENDAS] FastPoll: Gerencial: vendas 30 → 31 (↑ +1), ... | Pagamentos: 40 → 41 ... → regerando.
```

| Categoria | O que registra |
|---|---|
| `[VENDAS]` | Venda nova, alterada, excluída ou convertida detectada; hora corrigida; reconciliação gerencial → NF-e |
| `[FASTPOLL]` | Detecção rápida: modo, ritmo das consultas, virada de dia |
| `[BANCO]` | Conexão com o Firebird, caminho do FDB, índices, credenciais |
| `[GERADOR]` | Geração do relatório (processo filho, HTML) |
| `[SERVIDOR]` | Início, parada e reinício do servidor |
| `[API]` | Chamadas de outros computadores (`api.ps1` etc.) |
| `[NAVEGADOR]` | Erros enviados pela tela do relatório |
| `[CONFIG]` | Configurações, proibidos, ícone |
| `[REDE]` | IP da máquina |
| `[TRAY]` / `[INSTALL]` / `[REMOVER]` | Ícone da bandeja, instalador e removedor |
| `[DEBUG]` | Detalhes (só com `"logDebug": true`) |
| `[SISTEMA]` | Demais mensagens e erros não tratados |

- Chamadas à API vindas de **outros computadores** são registradas com IP e nome da máquina.
- Para investigar desempenho, ative `"logDebug": true` no `config.json`.

---

## Testes automáticos

Os testes rodam **sem Firebird real**: um banco simulado em `test/mock-firebird` responde às consultas do servidor e do gerador.

```bash
npm test
```

No Windows, basta dar **duplo clique em `test\executar-testes.bat`**. Ele confere o Node.js, roda a bateria e mostra o resultado na tela; o código de saída é 0 se tudo passou.

Eles cobrem a garantia de **somente leitura** (nenhum comando de escrita e nenhuma transação de escrita chega ao banco), a atualização da tela numa rajada de vendas, a proteção contra XSS, a mescla do cache de horas entre processos, o painel de duplicatas, a regra de correção de horário (incluindo a janela configurável) e a validação das rotas da API.

---

## Estrutura do projeto

```
├── servidor-relatorio.js          Servidor HTTP/SSE e monitoramento do banco
├── gerar-relatorio-html.js        Geração do relatório (subprocesso)
├── config.json                    Configurações
├── iniciar-tray.ps1               Ícone na bandeja + watchdog
├── launcher.vbs / bootstrap.vbs   Inicialização oculta
├── instalar-na-inicializacao.bat  Instalação da inicialização automática
├── _criar-tarefa.ps1              Auxiliar do instalador: cria a tarefa agendada completa
├── remover-inicializacao.bat      Remove a inicialização automática
├── _remover-inicializacao.ps1     Auxiliar do remover-inicializacao.bat
├── gerar_relatorio_do_dia.bat     Abre o relatório de hoje
├── gerar_relatorio_por_data.bat   Abre o relatório de uma data
├── gerar_relatorio_intervalo.bat  Abre o relatório de um período
├── api.ps1                        Cliente de linha de comando da API
├── _instalar-node.ps1             Instalador do Node.js
├── node-firebird.bat              Instalador do módulo node-firebird
├── package.json                   Script de testes (npm test)
└── test/
    ├── executar-testes.bat        Roda os testes no Windows (duplo clique)
    ├── relatorio.test.js          Testes automáticos
    └── mock-firebird/             Firebird simulado usado pelos testes
```

---

## Solução de problemas

| Sintoma | O que verificar |
|---|---|
| Página "Banco de dados não encontrado" | Selecione o `SMALL.FDB` na página ou pelo menu da bandeja; confira se o Firebird está rodando (porta 3050) |
| "Falha ao conectar" / senha incorreta | Ajuste `fbUser` e `fbPass` no `config.json` e reinicie pelo menu da bandeja |
| Outro computador não abre o relatório | Porta 7734 no firewall (rode o instalador como administrador) e IP em `maquinaIP` |
| Relatório de período longo não termina | Aumente `spawnTimeoutMs` no `config.json` (até 600000) |
| Servidor continua iniciando sozinho após a remoção | Rode `remover-inicializacao.bat` como administrador e veja as linhas `[REMOVER]` no `relatorio.log` |
| Servidor não inicia no logon | Rode `instalar-na-inicializacao.bat` de novo; veja as linhas `[INSTALL]` e `[TRAY]` no `relatorio.log` |
| Qualquer outro problema | Consulte o `relatorio.log`, que registra erros, avisos e a versão em uso |

---

## Créditos

**Desenvolvido por Ruda Gabriel.**

Concepção, regras de negócio e manutenção do sistema: **Ruda Gabriel**.

© 2026 Ruda Gabriel. Todos os direitos reservados.
