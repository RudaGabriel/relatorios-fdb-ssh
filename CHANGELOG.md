# Changelog

Histórico completo de versões de cada arquivo do projeto, da mais recente para a mais antiga.
Cada arquivo traz no cabeçalho só a entrada da **versão atual**; o histórico completo fica aqui.

Versões em uso hoje:

| Arquivo | Versão |
|---|---|
| [`servidor-relatorio.js`](#servidor-relatoriojs) | 2.22.0 |
| [`gerar-relatorio-html.js`](#gerar-relatorio-htmljs) | 3.26.1 |
| [`api.ps1`](#apips1) | 1.8.0 |
| [`iniciar-tray.ps1`](#iniciar-trayps1) | 1.6.1 |
| [`instalar-na-inicializacao.bat`](#instalar-na-inicializacaobat) | 1.13.1 |
| [`_criar-tarefa.ps1`](#_criar-tarefaps1) | 1.0.0 |
| [`bootstrap.vbs`](#bootstrapvbs) | 1.1.0 |
| [`launcher.vbs`](#launchervbs) | 1.0.1 |
| [`remover-inicializacao.bat`](#remover-inicializacaobat) | 1.0.0 |
| [`_remover-inicializacao.ps1`](#_remover-inicializacaops1) | 1.0.1 |
| [`_instalar-node.ps1`](#_instalar-nodeps1) | 1.3.0 |
| [`node-firebird.bat`](#node-firebirdbat) | 1.1.1 |
| [`gerar_relatorio_do_dia.bat`](#gerar_relatorio_do_diabat) | 1.4.2 |
| [`gerar_relatorio_por_data.bat`](#gerar_relatorio_por_databat) | 1.5.0 |
| [`gerar_relatorio_intervalo.bat`](#gerar_relatorio_intervalobat) | 1.5.0 |

---

## `servidor-relatorio.js`

Servidor.

### 2.22.0 — 2026-10-28 22:00

**Recarga desligada: a venda nova entra do mesmo jeito.**

- Com "Recarregar relatório ao detectar mudanças" desligado, a venda nova não fica mais só no aviso "Há vendas novas". A página troca os dados no lugar (`window.__atualizarSemRecarregar`, do gerador 3.26.0+), sem recarregar. O aviso continua só como reserva, se essa troca falhar ou com um gerador antigo.
- O selo do canto mostra "↻ ao vivo" (desligado) ou "↻ auto" (ligado).

### 2.21.0 — 2026-10-28 21:00

**Apelido do aparelho.**

- Cada aparelho pode ganhar um apelido (ex.: "Celular do Caixa 1"). Ele é guardado em `preferencias-aparelhos.json`, no campo `apelido`, com até 40 caracteres e sem caracteres de controle, aspas ou `< >`. O nome real descoberto na rede (Bonjour/NetBIOS/DNS) não muda.
- O apelido aparece no log (`"Celular do Caixa 1" — iphone-xr (100.103.59.92)`), em `/api/config` (`aparelho.apelido`) e em `/api/dispositivos` (`apelido`).
- O próprio aparelho define o apelido em "Minhas preferências", e o computador do servidor pode definir ao editar o aparelho (`apelido` no POST de `/api/config`; vazio tira o apelido).
- "Voltar ao padrão do servidor" e "Aplicar a todos os aparelhos" mantêm o apelido, porque ele não é preferência do relatório.

### 2.20.0 — 2026-10-28 18:00

**Acesso de qualquer lugar (Tailscale) e recarga automática opcional.**

- **Fora da loja com o Tailscale.** O Tailscale cria uma rede privada e criptografada entre a máquina da loja e o celular (cada um com o app, na mesma conta), sem abrir porta no roteador e sem expor nada à internet.
  - Os endereços dele (`100.64.0.0/10` e `fd7a:115c:a1e0::/48`) passam a valer como rede local.
  - O IP do Tailscale desta máquina conta como o próprio computador do servidor.
  - O IP do Tailscale nunca vira o "IP da loja" (`maquinaIP`) nem entra na busca do banco pela rede.
- `/qr` ganhou a seção **"Fora da loja"**: mostra o QR code do endereço do Tailscale, ou o passo a passo para ativar. `/api/qr` traz o campo `externo`, e `/qr.svg?externo=1` gera a imagem.
- **Segurança com túnel ou proxy** (cloudflared, ngrok, proxy reverso nesta máquina): um pedido com `X-Forwarded-For`, `Forwarded`, `CF-Connecting-IP`, `X-Real-IP` ou `True-Client-IP` chega de `127.0.0.1`, mas vem da internet. Ele nunca é tratado como o computador do servidor nem como rede local. Antes, ganharia acesso total.
- **Correção na página `/config`:** ela exigia intervalo mínimo de 200 ms, mas o servidor aceita a partir de 100 ms e a própria página diz "De 100 ms". Salvar 100 dava "Intervalo mínimo é 200 ms". Agora usa os mesmos limites do servidor (100 a 60000).
- **Recarga automática respeita o aparelho.** Com a opção desligada (gerador 3.23.0+), a página não recarrega sozinha. Aparece o aviso fixo "● Há vendas novas" com o botão **Atualizar** (e × para ocultar). O selo vira "⏸ manual".
  - Religar a opção com venda pendente atualiza na hora.
  - A volta do servidor depois de uma queda continua recarregando sempre.

### 2.19.1 — 2026-10-24 02:30

**Lista padrão do servidor para importar.**

- `/api/proibidos-servidor`: devolve os termos proibidos do padrão do servidor (`config.json`), para um aparelho importar para a lista dele.

### 2.19.0 — 2026-10-24 01:30

**Preferências por aparelho.**

- Cada aparelho da rede (celular, outro computador) tem as **suas** preferências: duração dos avisos, termos proibidos e teclas de atalho. Quando um muda, os outros não são afetados. Aparelho sem preferência própria segue o padrão do servidor.
- Guardadas em `preferencias-aparelhos.json` na pasta do sistema (nunca no banco; o arquivo não é versionado). O aparelho é reconhecido por um cookie próprio (`fdb_ap`, só um identificador aleatório); quem não guarda cookie (ex.: `api.ps1`), pelo IP.
- Só o **computador do servidor** (onde estão o launcher e o `servidor-relatorio.js`) muda o padrão de todos e as configurações do sistema (nome, intervalo, linhas do log, janela de correção, ícone) e troca o banco. De outro aparelho, esses campos são ignorados (e o ícone e o banco respondem 403).
- O computador do servidor edita ou restaura as preferências de qualquer aparelho (`/api/config?aparelho=<chave>`, `{restaurar:true}`) e pode aplicar o padrão a todos (`aplicarTodos`). As telas do aparelho afetado recebem um aviso `prefs` pelo SSE e atualizam na hora.
- A página de cada aparelho já vem com as preferências dele (`window.__APARELHO__`), sem mostrar o padrão antes. `/api/proibidos` e a nova `/api/preferencias` respondem por aparelho. `/api/dispositivos` (só para o computador do servidor) traz a chave e as preferências próprias de cada um.
- "Editar configurações" (bandeja/`api.ps1`) abre o modal só nas telas do computador do servidor — antes abria também nos celulares.
- Todos os registros vão para o log na categoria `[CONFIG]`, dizendo qual aparelho mudou o quê.

### 2.18.0 — 2026-10-23 22:00

**QR code para abrir no celular.**

- Gerador de QR code próprio, sem biblioteca e sem internet (modo byte UTF-8, correção nível M, versões 1 a 10, máscara pela menor penalidade — conferido módulo a módulo com uma biblioteca de referência e lido por um leitor de verdade).
- `/qr`: página com o QR code grande, o endereço e "Copiar endereço" — para mostrar na tela e escanear com o celular. `/qr.svg`: só a imagem. `/api/qr`: o endereço em texto.
- O endereço é sempre o IP desta máquina na rede (`http://IP:porta/`), nunca `localhost` — o celular precisa estar no mesmo Wi-Fi.

### 2.17.0 — 2026-10-23 16:30

**Dispositivos conectados no log; recarregamento sem piscar.**

- Nova categoria de log `[CONEXAO]`: cada celular ou computador da rede que abre o relatório aparece com tipo, modelo, sistema e navegador, IP e o **nome do aparelho**. O navegador não envia o nome de "Ajustes → Geral → Sobre"; o servidor pergunta ao próprio aparelho pela rede — Bonjour/mDNS (iPhone, iPad, Mac e muitos Android; no iPhone o nome local vem do nome em "Sobre", ex.: "iPhone do Caixa" → `iPhone-do-Caixa`), NetBIOS (computadores Windows) e, como reserva, o DNS do roteador. Busca em paralelo, até ~1,6 s, com cache de 10 min.
- Cada rota acessada pelo aparelho (página e `/api`) vira uma linha com método, rota, resultado e tempo (`[API]` para `/api`). As chamadas automáticas (status, pronto, events, db-status, hora-usuario) não geram uma linha cada: entram num resumo a cada 10 min. Telas em tempo real (SSE) abertas/fechadas são registradas; fechar e reabrir em até 8 s (o recarregamento automático a cada venda) só conta no resumo. Sem atividade por 3 min e sem tela aberta: "Dispositivo saiu", com tempo conectado e rotas. A própria máquina do servidor fica de fora; o `api.ps1` aparece com o nome do computador que ele envia.
- `/api/dispositivos` (só rede local): aparelhos com o relatório aberto agora.
- O recarregamento automático chama `window.__antesRecarga` (gerador 3.19.0+) antes de recarregar: a tela volta no mesmo ponto e com os mesmos filtros, sem piscar.
- Nada disso lê ou grava no banco.

### 2.16.0 — 2026-10-22 16:00

**Controle remoto pelo api.ps1.**

- `/api/temas` e `/api/navigate/tema/ID`: troca o tema das telas abertas (SSE "tema"; a página aplica e salva, como a escolha no menu). Lista lida do próprio gerador.
- `/api/navigate/aviso` (POST `{msg, segundos}`): aviso em destaque em todas as telas.
- `/api/navigate/recarregar`: recarrega todas as telas abertas.
- `/api/info`: versões, máquina, banco, memória, tempo ligado e abas conectadas.
- `/api/log?linhas=N&filtro=texto`: últimas linhas do relatorio.log (só rede local).
- `/api/programas` e `/api/programas/abrir` (POST `{nome}`): abre na máquina do servidor um programa da lista `programas` do config.json LOCAL (+ "Pasta do sistema" e "Log do servidor"). Pela rede só se escolhe um nome — nunca caminho ou comando livre — e a lista não pode ser alterada pela API. Só rede local.

### 2.15.6 — 2026-10-16 19:30

**Acentos dos itens no modal de detalhes.**

- /api/itens-detalhe lê a DESCRICAO do ALTERACA como bytes (CHARACTER SET OCTETS) e decodifica no Node: UTF-8 válido como está, senão Windows-1252. Coluna sem charset (NONE) com acento chegava com o caractere U+FFFD. Firebird que recusar a conversão: a consulta é refeita do jeito antigo.

### 2.15.5 — 2026-10-07 23:00

**Correções da varredura de bugs.**

- pollStatus (reserva) comparava vendas+pagamentos (400) com o total da geração, que conta só vendas (201): ao ligar dava sempre "Dados alterados: vendas 400 > 201 → regerando", e gravava a soma no status que a tela compara (recarga à toa). Agora tem linha de base própria e não grava qt/total; regenera pelo mesmo caminho do fast-poll (sem apagar a geração em curso). A 1ª linha de base do fast-poll gera uma vez em silêncio — cobre a venda feita entre a 1ª geração e ela.
- Fast-poll: watchdog e callbacks de um ciclo anterior (troca de banco, reconexão) não derrubam mais a conexão nova; a parte complementar (sem índice) tem prazo maior que 2 s e conta para "saudável".
- Parar o polling descarta a venda pendente; ciclo do pollStatus de um banco anterior não grava nada.
- Somente leitura: se a versão do node-firebird não puder ser lida, a transação continua readOnly (antes caía na forma de lista, que no driver 1.x/2.x vira transação de ESCRITA com espera).
- Log: stack de várias linhas — cada linha física leva data, hora e categoria; data e hora do mesmo instante; poda ao ligar; erros da tela limitados a 30/min.
- pollInterval 100–60000 ms e maxLogLines 100–100000 (sem teto, um valor enorme virava setInterval de 1 ms ou log sem limite); GET /api/config devolve os valores efetivos.
- /periodo: no máximo 3 períodos gerando ao mesmo tempo.
- Cache de hora só é regravado na saída se havia gravação pendente.

### 2.15.4 — 2026-10-07 22:00

**Log categorizado e cache de hora sem sobrescrever.**

- Toda linha do relatorio.log leva a categoria logo após o horário: [VENDAS], [FASTPOLL], [BANCO], [GERADOR], [SERVIDOR], [API], [NAVEGADOR], [CONFIG], [REDE], [DEBUG], [SISTEMA] — além de [TRAY], [INSTALL] e [REMOVER], que já existiam. Etiquetas antigas no meio da mensagem ([BROWSER-ERROR], [FDB Manual]...) viraram categoria. console.error/warn e exceções não tratadas também ganham horário e categoria. A leitura das mensagens únicas do dia aceita os dois formatos.
- hora-fixada-cache.json: o disco prevalece sobre a cópia em memória do servidor (lida no boot) — senão um reinício apagaria a "situacao" (cancelada/convertida) que o gerador v3.8.0 grava.

### 2.15.3 — 2026-10-07 21:00

**Um refresh também na exclusão e na conversão em NFC-e.**

- Log da loja: venda excluída ainda dava 2 refresh (a venda sai, depois o pagamento) e gerencial convertido em NFC-e dava 3 (some do gerencial e fica "aguardando autorização", vira NFC-e, muda o pagamento). A espera passou a valer para QUALQUER mudança de quantidade (entrou ou saiu: espera o pagamento, até 1,5 s) e para NFC-e aguardando autorização (espera a autorização, até 8 s); a outra parte é sempre lida uma vez antes de gerar. Uma geração por movimento.

### 2.15.2 — 2026-10-07 20:00

**Um refresh por venda (não dois).**

- O caixa grava a venda (NFCE) e o pagamento (PAGAMENT) em transações separadas. A parte rápida via a venda e gerava; a complementar via o pagamento ~1 s depois e gerava de novo: DOIS refresh por venda (log da loja: "Gerencial: vendas 36 → 37" e, 1 s depois, "Pagamentos: 38 → 39", cada um com "→ regerando"). Agora a mudança da parte rápida fica pendente: a complementar roda na hora e, se é venda nova, é relida até o pagamento aparecer (no máximo 1,5 s); então UMA geração com tudo, e uma linha só no log. Outras mudanças esperam uma leitura.

### 2.15.1 — 2026-10-07 19:00

**/api/status com a contagem por tipo desde o início.**

- g/nfc/nf (Gerencial, NFC-e, NF-e) ficavam -1 até a 1ª conferência do pollStatus — com o fast-poll completo saudável, até 10 s depois de ligar. Agora o fast-poll também preenche (mesma regra: sem canceladas, total > 0), a cada leitura da NFCE.

### 2.15.0 — 2026-10-07 18:00

**Fast-poll dividido pelos ÍNDICES do banco.**

- A sondagem lê no catálogo (só leitura, mesma conexão, em sequência) quais colunas de data têm índice: NFCE.DATA, PAGAMENT.DATA e VENDAS.SAIDAD/EMISSAO. Tabelas COM índice vão para a consulta rápida (no máximo 1/4 do tempo do banco); SEM índice, para a complementar (1/12, entre 250 ms e 30 s) — juntas, o mesmo teto de 1/3. Se todas têm índice (ou nenhuma tem) não há o que separar: consulta única, como antes. Na loja (índice só em NFCE.DATA), reproduzido num Firebird 3 com 300 mil vendas: venda nova detectada em ~327 ms em vez de ~730 ms; troca de forma de pagamento em ~780 ms.
- Log mostra as tabelas e o ritmo de cada parte; o aviso de índices sai da própria sondagem (sem a conexão extra de antes).
- pollStatus (reserva) a cada 10 s enquanto o fast-poll completo está saudável — ele também percorre tabelas sem índice.
- Corrigido: consulta medida em 0 ms era tratada como "não medida" e o tempo nunca aparecia no log.

### 2.14.0 — 2026-10-07 16:30

**Somente leitura, detecção mais rápida e segura.**

- SOMENTE LEITURA: o sistema nunca mais escreve no banco. Removidos os UPDATE de correção de horário (nfce/pagament/gerencial); duas travas em toda conexão (_somenteLeitura): só SELECT/WITH sai para o banco e toda transação é read-only (isc_tpb_read, sem espera) — o Firebird recusa escrita. O node-firebird abria transação de ESCRITA por padrão. Verificado no MON$TRANSACTIONS de um Firebird 3: 100% read-only.
- Correção de horário só na TELA, decidida pelo gerador e guardada no hora-fixada-cache.json; linha de base (--linha-de-base) ao ligar, reconectar e trocar de banco; correções avisadas no log e na tela. Sem as correções próprias, o pollStatus abre 2 a 3 conexões a menos por segundo.
- Detecção (COMMIT → aviso no navegador ~314 → ~140 ms): conclusão antecipada pelo aviso "@@RELATORIO_PRONTO@@"; gerador pré-aquecido; fast-poll ADAPTATIVO (a partir de 15 ms, no máximo 1/3 do tempo do banco; medido com 300 mil vendas: ~45 ms com índice, ~3 s sem); pollStatus 2 → 1 s com a mesma folga e sem regerar em dobro; polling de reserva do navegador 200 → 100 ms.
- Rajada de vendas: a geração em curso não é mais cancelada — termina, atualiza a tela, e uma nova começa em seguida (antes, com vendas a cada < ~150 ms, a tela só atualizava quando o movimento parava).
- Índices: confere no catálogo (só leitura, conexão própria) se NFCE.DATA, PAGAMENT.DATA e VENDAS.SAIDAD têm índice e registra no log "Índices: ... ok" ou "AVISO índices: sem índice em ...". Tempo da consulta do fast-poll sempre registrado na 1ª medição.

### 2.13.0 — 2026-10-07 14:30

**Detecção e atualização no menor tempo possível.**

Medido num Firebird 3 local (COMMIT no banco → aviso SSE no navegador): ~314 ms → ~140 ms.
- Conclusão antecipada: o gerador avisa "@@RELATORIO_PRONTO@@" assim que grava o HTML; o servidor avisa o navegador nesse instante, sem esperar o fechamento das conexões do filho com o Firebird (~100 ms).
- Gerador pré-aquecido: um processo reserva fica com o Node e o node-firebird carregados (~45 ms) e recebe a ordem pela entrada padrão; só então carrega o gerador, que lê config/data/hora na hora. Reposto a cada uso, descartado ao encerrar; qualquer problema → spawn normal.
- Fast-poll ADAPTATIVO: a partir de 15 ms, mas o próximo ciclo só começa após 3× o tempo médio da consulta — nunca ocupa mais de ~1/3 do tempo do Firebird (o mesmo banco do caixa). Medido com 300 mil vendas: ~45 ms com índice em DATA; sem índice a consulta leva ~1 s e o ciclo vai a 3 s, com aviso no log (antes, a 50 ms fixos, consultava sem parar).
- pollStatus: 2 s → 1 s, com a mesma folga de 1/3; não regera de novo o que o fast-poll completo já regerou (antes: geração e recarga de tela em dobro a cada venda).
- Polling de reserva do navegador: padrão 200 → 100 ms (mínimo 100).

### 2.12.0 — 2026-10-07 11:00

**Fast-poll com detecção completa por tipo.**

A consulta antiga somava tudo (gerencial + NFC-e + NF-e + pagamentos) em uma quantidade e um total, e era cega para mudanças que se compensam.
- Quantidade, total e ASSINATURA (soma de MOD(HASH(...))) por tipo: Gerencial (99), NFC-e (65), NF-e (55) e outros; canceladas; NFC-e aguardando autorização; vendas sem vendedor.
- Pagamentos: quantidade, total, assinatura de pedido|caixa|forma|valor de todas as linhas do dia (troca Dinheiro → PIX agora é detectada).
- NF-e da tabela VENDAS (antes fora do fast-poll): quantidade, total, assinatura e canceladas.
- Detecta: venda que muda de tipo com o mesmo valor, troca de vendedor, valores que sobem numa venda e descem em outra, troca de forma de pagamento. Log por tipo com sentido e diferença (↑/↓).
- Uma varredura por tabela (antes 3 a 4 na NFCE e 2 na PAGAMENT); 6 ms num Firebird 3 de teste.
- HORA fora da assinatura: a correção de horário do próprio servidor não dispara regeneração extra.
- Montada a partir das colunas reais (sondadas uma vez por banco, com timeout) e testada ao conectar. Banco que não aceita a consulta (sem HASH, coluna diferente) fica no modo básico; se ela passar a falhar depois, o servidor testa a básica na mesma conexão e, se esta funciona, muda para o modo básico em vez de entrar em laço de reconexão.

### 2.11.0 — 2026-10-05 22:30

**Encerramento com mensagem clara.**

Antes, ao encerrar (tray, Ctrl+C, /api/restart, queda), nada avisava: o log não registrava e o relatório aberto ficava parado na tela como se estivesse funcionando.
- Encerramento único (_encerrarServidor): registra "=== Servidor encerrado: motivo ===" no relatorio.log, avisa as abas abertas por SSE, mata os subprocessos e sai. Usado por Ctrl+C/SIGTERM/SIGBREAK/SIGHUP, /api/restart e pela nova rota /api/encerrar (chamada pelo tray).
- Saídas fora desse caminho registram "Servidor finalizado (código N)".
- Relatório aberto: faixa fixa no topo "Servidor de relatórios encerrado" / "Servidor reiniciando..." / "Sem conexão com o servidor" (conexão perdida por mais de 4 s); a página recarrega sozinha quando o servidor volta.

### 2.10.0 — 2026-10-05 21:45

**Janela de correção de horário das gerenciais configurável ("janelaCorrecaoHoraMin" no config.json, editável em /config e no modal do relatório).**

Padrão passa de 1 h para 3 h (180 min); aceita 5 a 720 min e vale sem reiniciar. Perto da meia-noite a janela agora é recortada em 00:00 em vez de suspender as correções (com 3 h, ficariam desligadas de 00:00 a 03:00).

### 2.9.1 — 2026-10-05 17:30

**Chave do hora-fixada-cache.json no mesmo formato do gerador ("YYYY-MM-DD|numero" sem zeros à esquerda).**

Antes o servidor gravava o número cru do banco ("061449") e o gerador "61449" — a mesma venda podia ter duas entradas. A busca confere os dois formatos, então entradas antigas continuam valendo (nenhuma gerencial é corrigida de novo na atualização). Testes automáticos em test/ (npm test).

### 2.9.0 — 2026-10-05 16:24

**Revisão completa (corretude, segurança, desempenho).**

- CRÍTICO: _corrigirHorariosVelhos reescrevia no banco a hora de TODAS as NFC-e/pagamentos do dia a cada reinício (Set volátil vazio) e deslocava toda venda nova em ~1 min (qualquer venda vira "velha" 1 min depois). Agora usa regra de "primeira visão": a 1ª varredura após boot/troca de banco só registra o que já existe (linha de base) e apenas documentos que APARECEM já com hora velha são corrigidos.
- hora-fixada-cache.json: gravação passa a mesclar com o disco (servidor e gerador sobrescreviam as entradas um do outro).
- Gerações supersedidas: timeout/erro de uma geração antiga não sobrescreve mais o cache nem agenda retentativa sobre a geração nova.
- Troca de banco (/api/salvar-fdb) e reset de cache matam as gerações em voo; banco salvo sem conexão agora reconecta sozinho em segundo plano (antes ficava parado até reiniciar o servidor).
- Credenciais: lidas de config.json (fbUser/fbPass, antes ignoradas) e repassadas ao gerador por variável de ambiente, não mais por argumento de linha de comando (visível na lista de processos).
- Segurança: JSON embutido em <script> escapado (XSS em /config), teclasPersonalizadas/proibidos validados em /api/config, /api/log-error saneado contra injeção de linhas no log, seletor de FDB com uma única instância por vez, validação de data de calendário em /periodo.
- Rotas /api/navigate/hash/{config|periodo} e /api/navigate/foco, que o tray já chamava mas não existiam (menu "Gerar por período" não fazia nada com aba aberta).
- Desempenho: agendarRegen deixa de criar um processo Node a cada ~0,5 s sem nenhuma mudança; regera de imediato só sem HTML válido e, com HTML válido, a cada _REGEN_SEGURANCA_MS (mudanças reais continuam sendo detectadas em ~50 ms pelo fast-poll).
- Logger: fila de linhas pendentes limitada se o disco falhar.
- Removido código morto (agoraAjustado).

### 2.8.5 — 2026-09-23

**RECONCILIACAO/AVISO RECONCILIACAO agora sempre vão pro relatorio.log.**

- CAUSA: o roteador de stdout do filho (gerar-relatorio-html.js) só gravava linhas iniciadas por ">", "OK:", "Conectando em:" ou "Conectado!" — e mesmo essas só via logDebug() (exige logDebug:true no config.json) e só na 1ª geração do dia (_queryLogsHoje). As linhas "RECONCILIACAO: ..."/"AVISO RECONCILIACAO: ..." (fusão automática Gerencial→NF-e por valor idêntico, introduzida no gerador v2.7.7+) caíam nesse buffer e eram descartadas silenciosamente — nunca apareciam no log, em nenhuma configuração.
- Corrigido: essas duas linhas agora são reconhecidas antes do filtro de rotina e gravadas via logTs() (sempre registra, independente de logDebug/_queryLogsHoje) — é evento de negócio que afeta o total do dia, não ruído de performance.

### 2.8.4 — 2026-08-08 07:00

**Versões do servidor E do gerador na linha de início do log.**

- A marca de início passa a terminar com "Servidor vX.Y.Z | Gerador vX.Y.Z". Os dois arquivos são atualizados juntos com frequência, e uma combinação incompatível já causou sintomas confusos antes (o marcador "CANCELADA" aparecendo na coluna de hora quando só o servidor tinha sido trocado). Ver as duas versões lado a lado na abertura do log torna esse desencontro imediato de identificar.
- A versão do gerador é lida do @version no cabeçalho do próprio arquivo (só os primeiros 600 caracteres). Leitura de arquivo em vez de require(): o gerador é um script executável que abre conexão com o banco ao ser carregado, não um módulo. Se o arquivo faltar ou não for legível, registra "ausente" em vez de impedir o boot.

---

## `gerar-relatorio-html.js`

Gerador do relatório.

### 3.26.1 — 2026-10-28 23:00

**Exemplos neutros.**

- Placeholder do apelido: "ex.: Celular do Caixa 1".
- Ajuda de busca: `vendedor:FULANO`, `vend:BELTRANO*`, `cli:FULANO*`.
- Comentários do código: vendedor A/B e "cliente identificado".
- Também ficaram neutros:
  - README e CHANGELOG ("iPhone do Caixa", "Atendente Número 1", VENDEDOR A/B);
  - os testes (vendedores "VENDEDOR A…D", produtos genéricos no lugar de marcas);
  - comentários do servidor e do `bootstrap.vbs`.
- Mantidos: a autoria (`@author`, "Desenvolvido por", `package.json`) e o nome do sistema de origem (Small Commerce/SmallSoft), usado nos caminhos de instalação para achar o banco.

### 3.26.0 — 2026-10-28 22:00

**Vendas novas entram sem recarregar a página.**

- Com "Recarregar relatório ao detectar mudanças" desligado, cada venda nova aparece sozinha, como sempre; só a página não recarrega.
  - O relatório novo é buscado em segundo plano, e só os dados são trocados: vendas, duplicatas (com as escolhas salvas), quantidades, totais, vendedores, painel detalhado e "Gerado em".
  - Filtros, busca, rolagem, janelas abertas (inclusive a de detalhes de uma venda) e o painel ficam exatamente como estão.
  - Se o relatório novo ainda estiver sendo gerado, espera e tenta de novo. Várias vendas seguidas são agrupadas numa atualização.
- A preparação dos dados virou funções reutilizáveis, que rodam na carga e a cada atualização: `_prepararDados`, `_indexarVendas`, `_dupLerListas`/`_dupAplicarSalvas`/`_dupAtualizarBotao` e `_atualizarCabecalho`.
- Textos da opção atualizados: "Desligado: as vendas novas continuam entrando sozinhas, mas a página não recarrega".

### 3.25.0 — 2026-10-28 21:00

**"Nome deste aparelho" em Minhas preferências.**

- Novo campo no topo de "Minhas preferências" para dar um apelido ao aparelho (ex.: "Celular do Caixa 1"). O texto explica que o nome real (ex.: "iphone-xr") não muda. Salvar só o apelido também funciona.
- O campo aparece também quando o computador do servidor edita um aparelho. A lista de aparelhos conectados no modal mostra o apelido.

### 3.24.1 — 2026-10-28 20:00

**Correção no celular (Configurações).**

- "Duração das mensagens de aviso" aparecia com o campo espremido (vazio) e o botão "Padrão (5s)" passando da borda. A regra de duas colunas da 3.24.0 valia também no celular; agora vale só no computador, e no celular o rótulo fica em cima e o campo embaixo.
- Os botões "Importar do servidor" e "Juntar com os do servidor" dividem a largura por igual.

### 3.24.0 — 2026-10-28 19:00

**Menu Tema só com os temas.**

- O botão **Tema** agora mostra só os temas de cores.
- Visualização, Desempenho, Atualização ("Recarregar relatório ao detectar mudanças") e Tamanho do texto foram para **Configurações**, na seção **"Nesta tela"**, no topo. Lá, valem na hora, sem precisar salvar, e só neste aparelho. A seção funciona no computador e no celular e não aparece quando o computador do servidor edita as preferências de outro aparelho.
- Modal de Configurações reorganizado no computador e no celular:
  - mais largo (640 px), com "Fechar" sempre à direita do título;
  - campos simples em duas colunas alinhadas (rótulo | campo);
  - seções grandes na largura toda: Nesta tela, ícone, proibidos, teclas e aparelhos. Antes ficavam espremidas na coluna do rótulo; a lista de aparelhos aparecia minúscula.
- Teclas de atalho em blocos alinhados: tecla, Gravar, comando e × numa linha, com a ação embaixo. No celular, o comando e a ação ocupam a largura toda. Antes os campos caíam desencontrados um embaixo do outro.

### 3.23.0 — 2026-10-28 18:00

**"Recarregar relatório ao detectar mudanças" e QR code fora da loja.**

- Menu **Tema → Atualização** ganhou a caixa **"Recarregar relatório ao detectar mudanças"**. É ligada por padrão e vale só para este aparelho (`fdb_recarga_auto`).
  - Desligada, a página não recarrega sozinha: filtros, busca, rolagem, painel e janelas abertas ficam como estão.
  - Quando entra venda, aparece "Há vendas novas" com o botão Atualizar. Ao atualizar, busca e filtros são restaurados como na recarga automática.
- Janela **"Abrir no celular"** ganhou duas abas: **Na loja (Wi-Fi)** e **Fora da loja**. A segunda mostra o QR code do endereço do Tailscale, ou o passo a passo para ativar.

### 3.22.1 — 2026-10-24 02:30

**Termos proibidos: importar do servidor.**

- Em "Minhas preferências" (e quando o computador do servidor edita um aparelho) e no editor "Proibidos" de um aparelho da rede, há dois botões:
  - **Importar do servidor**: troca a lista do aparelho pela lista padrão do servidor.
  - **Juntar com os do servidor**: acrescenta só os termos que faltam, sem repetir (maiúsculas e minúsculas contam como iguais).
- Nenhum dos dois salva sozinho. A pessoa confere a lista e clica em Salvar. Os avisos dizem quantos termos entraram, quando a lista já está igual e quando o servidor não tem termos.
- O editor "Proibidos" diz se a lista vale só para este aparelho ou é o padrão de todos.

### 3.22.0 — 2026-10-24 01:30

**Preferências por aparelho.**

- Num aparelho da rede, "Configurações" vira **"Minhas preferências"**: duração dos avisos, proibidos e teclas de atalho, que valem só para ele. Só vai o que foi mexido, e o resto continua seguindo o padrão do servidor. Mostra o que é próprio e tem o botão "Voltar ao padrão do servidor". Nome, intervalo, log, janela e ícone ficam ocultos, porque só o computador do servidor altera.
- No computador do servidor: o modal edita o **padrão de todos** e traz "Aplicar a TODOS os aparelhos" e a lista dos aparelhos conectados para editar as preferências de cada um. `/?cfgAparelho=<chave>` abre direto nas preferências de um aparelho; a bandeja usa isso.
- As preferências do aparelho vêm embutidas na página, sem "piscar" o padrão, e são aplicadas ao vivo quando mudam (aviso `prefs`), inclusive em outra aba do mesmo aparelho.
- A lista de proibidos de um aparelho vale mesmo vazia (antes, uma lista limpa no servidor não chegava às telas).

### 3.21.1 — 2026-10-23 23:30

**Lista até o fim da tela no modo detalhado; voltar ao topo no celular.**

- Modo detalhado: com o painel de gráficos minimizado, a lista ocupa exatamente o espaço até o rodapé (antes sobrava uma faixa vazia embaixo, principalmente com o texto reduzido — o zoom também encolhia a altura de 78% da tela). Com o painel aberto, a lista continua com 78% da tela e cresce se sobrar espaço.
- Celular: botão redondo pequeno "voltar ao topo" (36 px, levemente translúcido) acima da barra de baixo, no canto direito; aparece só depois de descer cerca de 1,2 tela e volta suave ao topo (instantâneo no modo leve). No computador não aparece.
- Testes: `config.json` de fábrica conferido pela versão do git (o da pasta de uma loja instalada tem o nome e o banco dela); gravação do estado simulado tenta de novo quando o Windows recusa o rename (EPERM) por o arquivo estar em leitura.

### 3.21.0 — 2026-10-23 22:00

**QR code para o celular; tamanho do texto no computador.**

- Botão **Celular** no topo (só no computador): abre uma janela com o QR code do endereço desta máquina na rede, o endereço e "Copiar endereço". Aponte a câmera do celular e o relatório abre.
- Menu Tema → **Tamanho do texto** agora também no computador (A− / Padrão / A+, de 80% a 140%), salvo separado do tamanho do celular. A página continua ocupando a tela inteira (a altura é compensada) e as janelas nunca passam da tela.

### 3.20.0 — 2026-10-23 21:30

**Animações de saída (modo Completo).**

- Antes só havia animações de entrada (menu Tema, avisos e dicas já tinham saída). Agora:
  - **Janelas** (venda, ajuda, duplicatas, configurações, período, Copiar/Mais/Vendedores no celular): ao fechar, a caixa encolhe e esmaece; no celular, desce de volta. Antes só o fundo escurecido sumia e a caixa desaparecia de uma vez.
  - **Lista de vendas e painel detalhado**: ao filtrar por vendedor, tipo ou busca, limpar filtros, minimizar/restaurar cartões ou trocar a visualização, o conteúdo antigo sai deslizando e esmaecendo enquanto o novo entra com a cascata. Usa a transição nativa do navegador (Chrome/Edge 111+, Safari 18+); sem ela, a troca acontece direto, como antes.
- Modo Leve e recarregamento automático (venda nova) continuam sem animação.

### 3.19.0 — 2026-10-23 16:30

**Recarregamento automático sem piscar.**

- Quando entra, muda ou sai uma venda, a tela recarrega sozinha. Antes, todas as animações de entrada rodavam de novo (a tela inteira "piscava"), os valores contavam desde zero, a rolagem voltava ao topo e os filtros se perdiam. Agora a página guarda antes de recarregar a posição na lista, a busca, o tipo e o vendedor; a nova aparece direto — sem animações de entrada nem contagem — no mesmo ponto da lista (rolagem da página no celular, da tabela ou do painel no PC) e com os mesmos filtros. Se a pessoa tocar ou rolar enquanto a posição é reaplicada, o ajuste para na hora.
- As animações continuam normais ao abrir a página, filtrar, abrir janelas etc. Precisa do servidor 2.17.0+.

### 3.18.0 — 2026-10-23 15:30

**Celular: uma linha só, totais em pares e tamanho do texto.**

- Tudo adaptável: badges do topo, título e contagem da tabela e os dados de cada venda tentam ficar numa linha só — se o texto não cabe, a letra diminui (até um mínimo legível); só se nem assim couber, volta ao tamanho normal e quebra linha. Medições em lote, sem travar a lista.
- Badges de totais e de quantidades: cada par "Nome: valor" (Total, Gerencial, NFC-e, NF-e) fica inteiro e lado a lado, sem o "―"; quando falta espaço, o par inteiro desce — nunca separa o nome do valor.
- Menu Tema → **Tamanho do texto** (aparece só no celular): A− / Padrão / A+, de 80% a 140%, salvo no aparelho. Aumenta a página, as janelas e a barra de baixo (esta até 120%); o menu fica parado enquanto se ajusta. Filtros por tipo deslizam para o lado quando não cabem.
- No computador nada muda.

### 3.17.0 — 2026-10-22 23:00

**Celular: visual compacto.**

- Seguindo o modelo enviado: badges do topo empilhados na largura toda (texto à esquerda), botões do topo centralizados, título da tabela justificado, cartões de venda mais densos (padding e fontes menores — número, total, dados e itens), com os dados da venda cabendo numa linha, e barra de baixo mais baixa (botões de 40 px).
- No computador nada muda.

### 3.16.1 — 2026-10-22 22:45

**Celular: selo "↻ auto" e títulos do painel.**

- O selo "↻ auto" fica oculto no celular — não havia canto livre e ele cobria as vendas e os cartões. A atualização automática continua ligada; no computador o selo continua aparecendo.
- Painel detalhado no celular: o texto extra do título ("pico 16h", "clique para filtrar"…) vai inteiro para a linha de baixo, em vez de ser cortado ("p.."); o botão de minimizar fica no canto.

### 3.16.0 — 2026-10-22 22:30

**Celular: barra de baixo e janelas.**

- Barra de baixo: o botão "+ Itens" virou **Vendas**, que rola até a lista de vendas do dia; o botão **Copiar** abre um mini modal com todas as opções de cópia (tudo, tudo + itens, sem dinheiro, só gerencial). O "Mais" fica com proibidos, vendedores, ajuda e limpar filtros.
- Janelas no celular: cabeçalho compacto com "Fechar" ao lado do título e campos empilhados (rótulo em cima, campo na largura toda) — Configurações e Gerar por período não passam mais da borda nem rolam para o lado.
- Em qualquer tela, a coluna de valores das linhas de rótulo/valor (`.kv`) pode encolher (`minmax(0, 1fr)`), em vez de empurrar a janela para fora.

### 3.15.0 — 2026-10-22 22:00

**Celular: página rola inteira.**

- Até 680 px de largura (celular), a página rola inteira — antes o topo e o cabeçalho da tabela ficavam presos e as vendas rolavam numa faixa estreita entre eles e a barra de baixo.
- A fileira de botões do cabeçalho da tabela fica oculta no celular (cortada pela largura); as mesmas ações estão em "Mais", na barra de baixo.
- O fim da lista e o selo "↻ auto" ficam acima da barra de baixo; a barra respeita a área do gesto do iPhone; com uma janela aberta (venda, ajuda, duplicatas), o fundo não rola.
- No computador nada muda.

### 3.14.0 — 2026-10-22 21:30

**Menu Tema auto-ajustável.**

- O menu Tema (`#tmMenu`) mede o espaço disponível na janela e, se não couber, se compacta em níveis: mais colunas (2 linhas de temas), prévias mais baixas, sem as dicas, espaçamentos menores e, no último nível, alarga para todos os temas ficarem numa linha só. Reajusta ao redimensionar a janela.
- Testado de 1920×1080 até 1100×420 sem rolagem; a rolagem interna fica só como último recurso em janelas ainda menores.

### 3.13.1 — 2026-10-22 21:00

**Chips de itens sem corte.**

- A caixa dos chips de itens (`.tdItemsWrap`) não corta mais o conteúdo: o chip que sobe e cresce ao passar o mouse (modo Completo) aparece inteiro, e nenhum chip some quando a venda tem itens + "+N mais" + desconto + duplicata — a linha cresce para caber.

### 3.13.0 — 2026-10-22 20:30

**Novo tema "Brasa Noturna".**

- Painel grafite sobre fundo azul-noite com brasas laranja nas bordas, cards com reflexo quente no canto, títulos em caixa alta e abas sublinhadas em laranja.
- No painel detalhado: linhas, barras e anéis laranja com brilho; barras do gráfico "acesas" por dentro e etiqueta do pico escura com borda clara. O brilho fica desligado no modo Leve.

### 3.12.0 — 2026-10-22 19:30

**Movimento no modo Completo.**

- Desempenho "Completo": entrada animada do topo, barra lateral, tabela e linhas (em cascata), modais com efeito "pop", botões/chips/itens com transição de mola, onda ao clicar, valores em R$ que "contam" até o número novo, painel detalhado redesenhando arcos/linhas ao trocar filtro e transição suave de cores ao trocar o tema.
- Escolher "Completo" manualmente vale mesmo com "reduzir movimento" do sistema; no modo Leve (ou automático em aparelho fraco) nada disso roda.

### 3.11.0 — 2026-10-22 18:00

**Visualização detalhada: painel com gráficos.**

- Menu Tema → "Visualização": Simplificada (como antes, só a tabela) ou Detalhada — painel acima da tabela no estilo dos painéis profissionais: cartões de indicadores (faturamento com minigráfico, ticket médio e maior venda, anéis de Gerencial/NFC-e/NF-e, vendedor destaque), gráfico combinado (área = faturamento, barras = nº de vendas, por hora ou por dia no período, com o pico marcado), rosca por tipo, ranking de vendedores, formas de pagamento e produtos mais vendidos.
- Segue os filtros da tela (vendedor, tipo e busca). Clique no ranking filtra o vendedor; clique num tipo (cartão ou legenda) filtra o tipo. Tooltips nos pontos, barras e fatias.
- Gráficos em SVG feitos no próprio relatório (sem biblioteca externa — funciona sem internet), com a paleta de cada tema; animação só na primeira montagem e nenhuma no modo leve. No celular, 2 colunas.
- Tema HUD Ciano com desenho próprio (estilo painel de controle): anéis grossos de porcentagem, barras sólidas com linhas-guia verticais, linha tracejada do faturamento acumulado com marcadores vazados, tabela por hora com faixas e vendedores em anéis com a porcentagem numa caixa. Trocar o tema redesenha o painel na hora.
- Botão SVG de minimizar/restaurar em cada painel e "Minimizar painel"/"Restaurar todos" no topo; fica salvo no navegador.

### 3.10.0 — 2026-10-22 17:00

**Modo leve para aparelhos fracos; tela de celular sem corte.**

- Modo leve automático para computadores, notebooks e celulares fracos: sem animações de entrada, desfoque, sombras pesadas, brilho de texto nem fundo fixo; transições de 80 ms; tabela desenhada em fatias menores. O visual do tema continua o mesmo.
- Detecção: hardware informado pelo navegador (memória/núcleos, celular com pouca memória), economia de dados, "reduzir movimento" do sistema e um teste rápido de processamento após o carregamento (mediana de 3 rodadas > 14 ms; PC atual ≈ 4 ms). O resultado fica salvo por 7 dias: a página já abre leve, sem trocar no meio.
- Menu Tema → "Desempenho": Automático (padrão) / Completo / Leve, com o motivo.
- Celular: a área da tabela passava da tela (botões alargavam a coluna) e cortava o valor das vendas. Coluna limitada em `minmax(0, 1fr)`.

### 3.9.1 — 2026-10-22 16:00

**Tema trocado à distância.**

- `window.__aplicarTema`: o servidor (api.ps1 → SSE "tema") troca o tema da tela, que fica salvo no navegador e marcado no menu; um aviso informa quem está na tela.

### 3.9.0 — 2026-10-22 15:00

**Temas de estilo no lugar dos temas que só mudavam a cor.**

- Saíram os 14 temas que só trocavam a cor. Ficam "Escuro" e "Claro" e entram 4 temas de ESTILO, que mudam também a forma (cantos, bordas, brilho, fundo, cards, tabela e lista de vendedores):
  - **HUD Ciano** — painel futurista azul-marinho, linhas ciano com brilho, cantos retos.
  - **Índigo Neon** — índigo arredondado, lateral mais clara, destaques em degradê e pílulas.
  - **Executivo** — grafite corporativo denso, títulos em caixa alta, destaque laranja.
  - **Âmbar Vidro** — vidro escuro com brilhos âmbar nos cantos e cards bem arredondados.
- Quem usava um tema removido passa sozinho para "Claro" (se era um tema claro) ou "Escuro" (os demais), e a troca fica salva. Menu de temas em 3 colunas, com prévia de cada estilo.

### 3.8.7 — 2026-10-17 15:00

**Rastro da escolha no painel Duplicatas; badge do total nunca estoura.**

- Painel Duplicatas: a opção escolhida fica preenchida com "✓" e "Escolha aplicada: …", o par pisca e um aviso confirma. Trocar a escolha de um par já decidido aplica na hora (a página recarrega e reabre o painel no par). Na tabela, a venda que ficou ganha o chip "Duplicata: <documento> oculta" (ou "também aparece"), com o porquê no tooltip; clicar no chip abre o painel com o par destacado.
- Badge #bDiaBrk ainda estourava: a verificação só rodava quando a largura da barra mudava, e a fonte web chegando depois do carregamento alargava o texto sem novo ajuste. Agora o próprio CSS garante: sem espaço, os badges descem de linha e o total quebra por dentro em último caso. O ajuste por etapas (oculta hora, encolhe o botão de vendedor, compacta) também reage a mudança de conteúdo e ao fim do carregamento das fontes.
- Filtros "NFC-e"/"NF-e" não quebram mais em duas linhas quando o espaço aperta, e a caixa de busca não some mais (sumia perto de 1100 px): tem largura mínima e, sem espaço, os botões descem para a linha de baixo.

### 3.8.6 — 2026-10-16 20:30

**NFC-e com desconto reemitida como NF-e; badge do total na tela.**

- NFC-e 125636 × NF-e 000307 continuavam as duas na lista: a NFC-e tem a linha "Desconto de 5%" (item de valor negativo) e a NF-e não, então as listas de itens nunca eram iguais. A comparação agora usa só PRODUTOS (descontos/acréscimos fora), em todas as reconciliações e no auto-teste. A hora deixou de ser critério (a da NF-e é a de saída) e cliente também (NFC-e traz CPF/"consumidor"). A NF-e sempre prevalece.
- Badge #bDiaBrk estourava para fora do monitor: a grade da página (.app) sem coluna definida crescia até a largura do conteúdo e o excesso era cortado. Coluna travada em minmax(0, 1fr) e ajuste em etapas aplicadas de uma vez (sem piscar): oculta hora, encolhe o botão de vendedor, badges compactos, quebra de linha dos badges e, por último, quebra dentro do próprio total. Testado de 1920 a 390 px.

### 3.8.5 — 2026-10-16 19:30

**Nomes com acento saem certos ("Atendente Número 1").**

- O SmallSoft grava nomes em colunas sem charset (NONE) com bytes Windows-1252; pedidos como texto numa conexão UTF8, o "í" chegava como U+FFFD ("N�mero"). Vendedor, cliente, natureza, status, formas de pagamento e descrição dos itens (NFCE, ALTERACA, PAGAMENT, VENDAS, ITENS001) agora são lidos como bytes (CHARACTER SET OCTETS) e decodificados no Node: UTF-8 válido como está, senão Windows-1252 (latin1 se o Node não tiver ICU completo). Testado no Firebird 3 com node-firebird 1.1.9, 1.1.10, 2.0.0 e 2.18.2 e colunas NONE/UTF8/WIN1252.
- Firebird que recusar a conversão: a consulta é refeita do jeito antigo (aviso "AVISO TEXTO" no log) — a geração nunca cai por causa disso.

### 3.8.4 — 2026-10-16 18:00

**NFC-e reemitida como NF-e conta uma vez só.**

- NFC-e 125636 (vendedor A, crédito) e NF-e 000307 (cliente, sem vendedor), ambas de R$ 453,35 com os mesmos 3 itens, eram somadas — a venda aparecia em dobro no total. Nova reconciliação NFC-e → NF-e: mesma data, mesmo valor e a MESMA lista de itens (os dois lados com itens), sem vendedores ou clientes diferentes, NF-e não anterior à NFC-e. A NF-e prevalece e herda vendedor, hora e formas de pagamento que não tiver; a NFC-e vira "convertida" no hora-fixada-cache.json.
- Painel Duplicatas também lista esses pares: "Manter apenas NF-e" (padrão), "Manter as duas", "Manter apenas a NFC-e" e "Perguntar depois".

### 3.8.3 — 2026-10-08 19:30

**Gerencial convertida sai sozinha; escolha por par no painel Duplicatas.**

- A reconciliação gerencial → NF-e comparava o NFCE.TOTAL/HORA BRUTOS da gerencial, mas o total exibido vem dos itens do ALTERACA (ou do PAGAMENT): o auto-teste via o par (gerencial 062418 × NF-e 000306, R$ 1215,51, mesmo vendedor) e a gerencial continuava na tela e na soma. Nova reconciliação FINAL sobre as linhas já calculadas, com o mesmo critério do auto-teste (mesma data, mesmo valor, documento 0–20 min depois, vendedores não diferentes) mais uma trava: com itens dos dois lados, precisa haver ao menos um item em comum (a mesma trava vale no aviso POSSIVEL_DUPLICIDADE). Cada documento absorve no máximo 1 gerencial; documento com vínculo pela coluna GERENCIAL fica de fora. Vale para NFC-e e NF-e. O documento fiscal sempre prevalece: herda pagamento, itens, vendedor e cliente que não tiver; a gerencial vira "convertida" no hora-fixada-cache.json.
- Painel Duplicatas (fallback de dúvida), por par: "Manter apenas NF-e/NFC-e" (padrão), "Manter as duas", "Manter apenas a gerencial" e "Perguntar depois". Escolha salva no navegador; totais do dia e por vendedor acompanham; pares já decididos aparecem no painel para trocar a escolha (vale na próxima atualização).

### 3.8.2 — 2026-10-08 09:00

**Vendedores diferentes não são a mesma venda.**

- O aviso POSSIVEL_DUPLICIDADE (gerencial × NFC-e/NF-e de mesmo valor, até 20 min depois) comparava só valor e horário: gerencial 063538 (VENDEDOR A) × NFC-e 125319 (VENDEDOR B) era apontada como possível duplicidade. Agora, se os DOIS vendedores são conhecidos e diferentes, o par é descartado. Vendedor vazio, "?" ou "(aguardando autorização)" — a NFC-e convertida só ganha vendedor depois da SEFAZ — não descarta.
- A mesma regra vale na reconciliação gerencial → NF-e da tabela VENDAS, que absorve a gerencial e muda o total do dia: com vendedores diferentes, não absorve.

### 3.8.1 — 2026-10-07 23:00

**Correções da varredura de bugs.**

- Situação no hora-fixada-cache.json: venda que vai para a tela é sempre "ativa", mesmo que outra linha com a mesma chave esteja cancelada (número repetido, NFC-e ainda sem número próprio); conversão reconhecida por QUALQUER número da gerencial (mesmo critério da tela) e antes do cancelamento (o PDV pode marcar a origem com 'S' ao converter); NF-e da tabela VENDAS cancelada também ganha a situação; número de "convertidaEm" sempre sem zeros à esquerda.
- Somente leitura: se a versão do node-firebird não puder ser lida (pacote que bloqueia o package.json), a transação continua readOnly — antes caía na forma de lista, que no driver 1.x/2.x vira transação de ESCRITA com espera.

### 3.8.0 — 2026-10-07 22:00

**Situação da venda no hora-fixada-cache.json.**

- Venda que já tinha hora fixada e depois foi CANCELADA ou CONVERTIDA (gerencial → NFC-e/NF-e) continuava no arquivo como ativa. Agora a entrada ganha "situacao": "cancelada" | "convertida" e, na conversão, "convertidaEm": {tipo, numero} do documento fiscal (vínculo GERENCIAL da NFCE, ou a reconciliação com a NF-e da tabela VENDAS). Voltou a ficar ativa → os campos saem. A hora fixada nunca muda; só entradas que já existem são atualizadas; o arquivo só é regravado quando algo mudou.

### 3.7.0 — 2026-10-07 16:30

**Somente leitura e correção de horário só na tela.**

- Duas travas em toda conexão (_somenteLeitura, bloco idêntico ao do servidor): só SELECT/WITH sai para o banco e toda transação é read-only, READ COMMITTED com rec_version e sem espera. Antes passava ISOLATION_READ_UNCOMMITTED, que no node-firebird 1.x abria transação de ESCRITA com espera.
- --linha-de-base (enviado pelo servidor ao ligar/reconectar/trocar de banco): venda de hoje ainda sem decisão de hora é registrada como está (só hora no futuro é ajustada) — evita "corrigir" vendas legítimas ao ligar no meio do dia.
- Correções feitas na geração são informadas ao servidor ("@@CORRECOES_HORA@@") para log e aviso na tela. Aviso "@@RELATORIO_PRONTO@@" ao gravar o HTML (o servidor avisa o navegador sem esperar o fechamento das conexões). Polling padrão 100 ms.

### 3.6.0 — 2026-10-07 14:30

**Aviso de pronto.**

assim que o HTML e o cache de horas estão gravados, imprime a linha "@@RELATORIO_PRONTO@@". O servidor (v2.13.0+) conclui a geração e avisa o navegador nesse instante, sem esperar o fechamento das conexões com o Firebird (~100 ms). Configurações: intervalo de polling padrão 100 ms (mínimo 100). Com servidor antigo a linha é ignorada e tudo segue como antes.

### 3.5.0 — 2026-10-06 16:00

**Volta o chip de desconto na coluna Itens (tinha se perdido numa atualização).**

depois dos 3 itens e do "+N mais…", a venda com desconto ganha o chip vermelho "tdItemChip tdItemDesc" com o texto "Desconto de 10% (−R$ 7,50)", cortado com reticências quando não couber na célula. Ao passar o mouse mostra o detalhamento (valor e % do desconto, soma dos itens, total com desconto e cada linha de desconto); o clique abre o modal normalmente. Mesma regra do modal: item com valor negativo é desconto, % sobre a soma dos itens positivos. Percentual abaixo de 1% aparece com uma casa (0,5%) no chip e no modal, que antes arredondava para 1%. Altura máxima da célula de itens ampliada para caber o chip.

### 3.4.0 — 2026-10-06 11:30

**Termos proibidos.**

contador de termos adicionados (com quantos são filtros de valor e aviso acima do limite de 500) nos dois editores (Configurações e "Editar lista de proibidos"). O formato da caixa é detectado e, se não for "um termo por linha", ajustado automaticamente ao colar, ao sair do campo e ao salvar: separados por vírgula, ponto e vírgula, tabulação ou barra vertical, lista JSON, marcadores ("- ", "1. "), aspas, espaços extras e repetidos (sem diferenciar acento/maiúsculas). Vírgula entre dígitos é decimal ("AGUA 1,5L", ">100=6578,96") e nunca separa termos.

### 3.3.1 — 2026-10-05 22:00

**Padrão de fábrica sem dados de loja.**

a lista padrão de "proibidos" (marcas fixas de uma loja específica, aplicada automaticamente em toda instalação nova e sempre que a lista do usuário ficava vazia) passa a ser vazia — "Restaurar padrão" agora limpa a lista. Exemplo do campo de nome trocado para "ex: Minha Loja".

### 3.3.0 — 2026-10-05 21:45

**Janela de correção de horário configurável.**

lida de "janelaCorrecaoHoraMin" no config.json (mesma chave do servidor), padrão 180 min (3 horas) em vez de 1 hora fixa, limites de 5 a 720 min. Novo campo "Janela de correção de horário (min)" no modal de configurações, com botão "Padrão (3h)".

### 3.2.2 — 2026-10-05 21:30

**Mescla da v3.2.1 (16 temas, data junto da hora no detalhe e demais recursos) com as correções que já estavam no GitHub (v2.9.2).**

escape de JSON em <script> contra XSS (_jsonParaScript), mescla do hora-fixada-cache.json gravando só as chaves alteradas, credenciais por variável de ambiente (RELATORIO_FB_USER/RELATORIO_FB_PASS do servidor e FIREBIRD_USER/ FIREBIRD_PASSWORD da v3.2.1), atalhos Delete/Insert/CapsLock+P sem agir dentro de campos de texto, e linhas de duplicata reconstituídas com _idx/_busca (clique e busca funcionam nelas).

### 2.9.2 — 2026-10-05 17:30

**Atalhos de proibidos (Delete → [-proibidos], Insert / CapsLock+P → [proibidos]) deixam de agir dentro de campos de texto.**

a tecla Delete não apagava mais nada na busca, na lista de proibidos e nas configurações, e digitar "P" com CapsLock ligado em qualquer campo aplicava o filtro. Na busca, o Delete só vira atalho quando não há nada à frente do cursor. Cliques automáticos do atalho protegidos contra elemento ausente.

### 2.9.1 — 2026-10-05 17:05

**Mescla da v2.9.0 (painel "Duplicatas" com decisão do usuário) com a revisão de segurança e concorrência feita sobre a v2.7.9.**

- XSS: __TECLAS_PERSONALIZADAS__ e o JSON de dados passam por _jsonParaScript (escape de "</script>", U+2028, U+2029); modal de configurações escapa caminho do favicon e nome do sistema.
- hora-fixada-cache.json: grava só as chaves alteradas nesta execução, mesclando com o disco (não apaga entradas do servidor/outras gerações).
- Credenciais por variável de ambiente RELATORIO_FB_USER/RELATORIO_FB_PASS; aviso de credencial de fábrica só quando é de fato SYSDBA/masterkey.
- Painel "Duplicatas" (v2.9.0) preservado, com 2 correções: qs("#...", el) ignorava o modal ainda fora da página → TypeError que impedia o relatório inteiro de renderizar quando havia duplicata pendente; linhas reconstituídas ("manter") sem _idx/_busca → clique e busca não funcionavam nelas; fechar() usado antes de declarado.

### 2.8.0 — 2026-10-05 16:24

**Revisão completa (segurança e concorrência).**

- XSS: __TECLAS_PERSONALIZADAS__ era embutido em <script> com JSON.stringify puro — um comando de atalho contendo "</script>" executava código em todo relatório aberto. Agora usa o mesmo escape do JSON de dados (_jsonParaScript).
- XSS: modal de configurações inseria o caminho do favicon e o nome do sistema no HTML sem escapar "<" e "&".
- hora-fixada-cache.json: a gravação passa a reler o disco e mesclar só as chaves alteradas nesta execução — antes sobrescrevia o arquivo inteiro com a cópia lida no início e apagava as entradas gravadas nesse meio-tempo pelo servidor ou por outra geração.
- Credenciais: aceitas por variável de ambiente RELATORIO_FB_USER / RELATORIO_FB_PASS (o servidor não as passa mais na linha de comando); o aviso de credencial de fábrica só aparece quando elas são de fato SYSDBA/masterkey.

### 2.7.9 — 2026-09-23

**Reativa fusão automática Gerencial→NF-e por valor idêntico, a pedido do usuário (regra de negócio.**

gerenciais do filtro [proibidos] são convertidas manualmente por fora do fluxo integrado, então nunca terão vínculo de coluna — valor idêntico no mesmo dia é o sinal correto e deve sempre prevalecer).
- A v2.7.8 tinha rebaixado essa reconciliação para somente aviso, por causa do risco de colisão (R$118,75 é preço de produto comum e se repete no dia). Reativada agora com trava adicional: cada NF-e só pode absorver NO MÁXIMO 1 gerencial — gerenciais candidatas ao mesmo valor são processadas em ordem de horário e casadas uma de cada vez, nunca duas desaparecendo em cima do mesmo documento. Com mais de uma NF-e candidata para a mesma gerencial, escolhe a mais próxima em horário. Tudo fica registrado via "RECONCILIACAO: ..." no console para auditoria.
- Mantém a v2.7.8 (vínculo real via coluna GERENCIAL para o caso Gerencial→NFC-e, sem qualquer heurística) e a v2.7.6 (descarta NF-e com STATUS de rejeição da SEFAZ antes de virar candidata).

### 2.7.5 — 2026-08-08 02:30

**Nova regra de hora fixa (definida pelo usuário), agora idêntica nos dois lados.**

- TOLERANCIA_RELOGIO_MIN passou de 1,5 para 3 min e MAXIMO_ATRASO_MIN de 18 para 60 min. Nenhum dos dois batia com a regra pedida, e o segundo também não batia com a janela usada pelo servidor — havia uma faixa em que um lado corrigia e o outro não, fazendo a venda parecer "pular" de horário conforme quem processou por último.
- Regra final: futuro -> corrige para a hora atual; até 3 min atrás -> aceita como está (marca OK); de 3 min a 1 hora atrás -> corrige para a hora atual; mais de 1 hora atrás -> ignora.
- Verificado por simulação em toda a faixa (+5, 0, -3, -3.1, -30, -60, -61, -90 min): cada intervalo cai na ação correta.

---

## `api.ps1`

Cliente de linha de comando.

### 1.8.0 — 2026-10-23 16:30

**Dispositivos conectados.**

- Opção 37 / `-Endpoint dispositivos`: celulares e computadores da rede com o relatório aberto agora — tipo, modelo, sistema, navegador, IP, nome do aparelho, telas abertas e rotas acessadas (servidor 2.17.0+).

### 1.7.0 — 2026-10-22 20:30

**Ajuda e "cancelar e voltar".**

- Menu: `H` (ou `help`, `ajuda`, `?`) lista todos os comandos novamente; Enter vazio só pede a opção de novo. Modo direto: `.\api.ps1 -Endpoint help`.
- Opções 30 (tema) e 36 (abrir-programa): item "0. Cancelar e voltar ao menu" (0 ou Enter voltam ao menu).
- Na 36, confirmação S/N antes de abrir o programa na máquina do servidor; qualquer outra resposta cancela.

### 1.6.0 — 2026-10-22 16:00

**Controle remoto.**

- Novos: `temas`, `tema` (troca o tema das telas abertas), `aviso` (mensagem em todas as telas), `recarregar-abas`, `info` (versões, máquina, banco, memória), `log` (últimas linhas do relatorio.log com filtro e cores), `programas` e `abrir-programa` (abre na máquina do servidor um programa da lista `programas` do config.json de lá). Menu: opções 29 a 36.

### 1.5.1 — 2026-10-07 22:30

**Correcoes da varredura de bugs.**

- Menu: "continue" dentro de um switch age sobre o SWITCH, nao sobre o laco - cancelar a opcao 21 ou deixar a 7 em branco seguia para o comando e mostrava um erro em seguida. Laco rotulado (continue menu).
- "encerrar": confirmacao SIM igual no menu e no modo direto (maiusculas); textos dizem que, com o icone da bandeja ativo, o servidor e' religado em ate ~10 s.

### 1.5.0 — 2026-10-07 19:00

**IP desta maquina e rotas que faltavam.**

- Cabecalho do menu mostra o nome e o IP DESTA maquina (a que abriu o api.ps1): o IP e' o da placa de rede usada para chegar ao servidor (nao um IP qualquer de VPN/VirtualBox); avisa quando esta maquina e' a propria maquina do servidor. Opcao 20 lista todos os IPs.
- Novas opcoes para rotas do servidor que existiam e nao estavam no menu: encerrar (desligar o servidor, com confirmacao), foco (trazer a aba do relatorio para frente), modal-config / modal-periodo (abrir essas janelas na aba aberta), atualizar (forcar nova geracao do relatorio de hoje), itens-venda (itens de uma venda: data + numero), abrir-navegador e abrir-periodo (abrir o relatorio NESTA maquina).
- status: quando algum valor vem -1 ("ainda nao lido"), a resposta traz um campo "obs" explicando (servidor 2.15.1+ preenche a contagem por tipo logo na primeira leitura do fast-poll).
- Erros HTTP mostram tambem o motivo enviado pelo servidor (antes so' "500 (Internal Server Error)", sem dizer o que falhou).

### 1.4.0 — 2026-10-05 16:24

**Revisao completa.**

- Invoke-ApiCall repetia (com espera exponencial) ate' respostas 4xx do servidor - erros definitivos como 400/403/404, que nunca mudam numa nova tentativa. Agora 4xx falha na hora com "HTTP <codigo>"; so' falhas de rede e 5xx sao repetidas.
- PowerShell 7: falha de conexao chega como HttpRequestException (nao WebException) e era rotulada "Erro:" - o fallback do "restart" (iniciar via launcher.vbs quando o servidor esta fora do ar) nunca disparava. Agora as duas formas sao reconhecidas como "Falha de rede".
- sse-test consultava /api/sse-clients (JSON comum), nao o fluxo SSE. Agora conecta de fato em /api/events e le a primeira linha do fluxo.

### 1.3.1 — 2026-08-12 21:30

**Revisao no eixo precisao (etapa 5/6).**

- upload-favicon: validava so' a existencia do caminho e ja chamava ReadAllBytes, que le o arquivo INTEIRO de uma vez. Apontar por engano para um video ou ISO travaria a maquina tentando alocar tudo em RAM. Agora confere antes: nao pode ser pasta, nao pode estar vazio, tem que caber no limite de 2 MB do servidor e a extensao precisa ser PNG/ICO/ JPG. A validacao real continua no servidor (bytes magicos); esta e' um aviso amigavel e uma protecao contra upload longo fadado a falhar.
- navigate-periodo: qualquer texto era interpolado direto na URL. Erro de digitacao so' viraria erro no servidor, com mensagem generica, e um valor com barra ou ".." alteraria o caminho da requisicao. Agora exige AAAA-MM-DD, confirma que a data existe no calendario e que a inicial nao e' posterior a final.

---

## `iniciar-tray.ps1`

Ícone da bandeja.

### 1.6.1 — 2026-10-28 21:00

- Dispositivos conectados: a coluna "Nome do aparelho" mostra o apelido, com o nome real entre parênteses (ex.: `Celular do Caixa 1 (iphone-xr)`).

### 1.6.0 — 2026-10-24 01:30

**Preferências por aparelho na janela "Dispositivos conectados".**

- Nova coluna **Preferências**: "padrão do servidor" ou "próprias: …".
- Botão **"Configurações do aparelho..."** (ou duplo clique): abre o relatório nesta máquina já com as preferências daquele aparelho para editar. Botão **"Voltar ao padrão"** apaga as preferências próprias dele, com confirmação.
- Rodapé refeito com layout automático. Os botões apareciam cortados e sem texto com a escala da tela em 125%/150%.
- A seleção da lista é mantida entre as atualizações automáticas (a cada 5 s).
- "Editar configurações..." abre o navegador quando nenhuma tela desta máquina recebe o pedido (os celulares não recebem mais).

### 1.5.2 — 2026-10-23 23:30

**Cabeçalho do menu sem corte.**

- Status ("No ar · banco conectado") e contagem ("1 tela aberta · 0 aparelhos na rede") em duas linhas, e a largura do menu é recalculada depois de atualizar o texto — antes a linha única saía cortada.

### 1.5.1 — 2026-10-23 22:00

**QR code.**

- Novo item **Abrir no celular (QR code)...**: abre a página `/qr` do servidor, com o QR code do endereço desta máquina na rede, para escanear com o celular.

### 1.5.0 — 2026-10-23 21:00

**Menu completo, com ícones.**

- Todas as opções, em grupos:
  - cabeçalho com o nome do sistema e status ao vivo (servidor no ar, banco conectado, telas abertas, aparelhos na rede);
  - **Abrir relatório** e **Abrir em nova aba do navegador**;
  - **Atualizar dados de hoje** e **Gerar por período...**;
  - **Telas abertas ▸** trazer o relatório para frente, recarregar todas as telas, enviar aviso para as telas, tema das telas (lista lida do servidor);
  - **Dispositivos conectados...** — janela com nome do aparelho, IP, tipo, sistema, navegador, telas, horários, requisições e rotas; atualiza a cada 5 s;
  - **Configurações ▸** editar configurações, selecionar banco (FDB), status do banco de dados;
  - **Ferramentas ▸** informações do sistema, copiar endereço de acesso (para abrir em outro PC ou celular), abrir pasta do sistema, abrir o log, acompanhar o log ao vivo, cliente da API (`api.ps1`), programas (lista do `config.json`);
  - **Reiniciar servidor** e **Sair** (como antes).
- Ícones vetoriais coloridos — os mesmos SVG (Lucide) do relatório, desenhados por um leitor de SVG embutido (C# compatível com o PowerShell 5.1), nítidos em qualquer escala de tela; menu com fundo branco, destaque azul-claro e textos com acento (o arquivo continua 100% ASCII). Sem `favicon.png`, a bandeja usa um ícone próprio em vez do genérico do Windows.
- Se o visual não puder ser montado (C# bloqueado na máquina, por exemplo), o menu funciona igual, só sem ícones — registrado no log como aviso.

### 1.4.1 — 2026-10-07 22:30

**Correcoes da varredura de bugs.**

- Mutex abandonado (tray anterior morto sem liberar) era tratado como "outra instancia rodando" e o icone nao subia mais; agora e' adquirido.
- "Reiniciar servidor" so' anuncia sucesso se o processo novo continua vivo apos 2 s (antes bastava o Start retornar, mesmo com a porta ocupada).
- Data e hora do log tiradas do MESMO instante (virada da meia-noite).

### 1.4.0 — 2026-10-05 22:30

**Encerramento com mensagem clara.**

"Sair" e "Reiniciar servidor" matavam o processo direto (taskkill /F): o servidor nao tinha chance de registrar nada no log nem avisar as telas abertas, e o icone simplesmente sumia. Agora o tray pede o encerramento ordenado (/api/encerrar - servidor registra no relatorio.log e mostra o aviso "Servidor encerrado" nos relatorios abertos), espera ate 5 s e so' entao usa taskkill como ultimo recurso. Ao sair, mostra uma janela confirmando que o servidor foi encerrado e como inicia-lo de novo.

### 1.3.0 — 2026-10-05 16:24

**Credenciais do Firebird repassadas ao servidor por variavel de ambiente (RELATORIO_FB_USER / RELATORIO_FB_PASS) em vez de "--user X --pass Y" na linha de comando.**

a linha de comando de qualquer processo e' visivel a todos os usuarios da maquina (Gerenciador de Tarefas, wmic), e uma senha com espaco quebrava os argumentos (ia sem aspas). servidor-relatorio.js v2.9.0+ le essas variaveis.

### 1.2.4 — 2026-08-12 21:30

**Revisao no eixo precisao (etapa 5/6).**

- "Sair" usava Kill(), que encerra APENAS o processo do servidor. Os subprocessos criados por ele (geracoes de relatorio em andamento) continuavam vivos, orfaos, segurando conexao com o Firebird e invisiveis para quem acabou de sair do sistema. Trocado por taskkill /F /T, que derruba a arvore inteira -- exatamente o que o "Reiniciar servidor" ja fazia neste mesmo arquivo. A divergencia entre os dois caminhos era descuido, nao intencao.
- O encerramento manual passou a ser registrado no log.

---

## `instalar-na-inicializacao.bat`

Instalador da inicialização automática.

### 1.13.1 — 2026-10-07 22:30

**Acentos (nome e caminhos).**

- O nome do sistema ia para o config.json por um .ps1 temporario gravado em UTF-8 (chcp 65001) que o PowerShell 5.1 le como ANSI: "Farmacia" com acento virava lixo. Agora nome e caminho vao por variavel de ambiente (Unicode, sem escape).
- O atalho da pasta Inicializar (alternativa a tarefa) gravava o caminho do bootstrap em UTF-8 dentro de um .vbs, que o wscript le como ANSI: perfil com acento nunca iniciava. Agora o .vbs monta o caminho na hora com %%LOCALAPPDATA%%. O bootstrap.vbs v1.1.0 le o launcher.path em UTF-8.
- Removido o rotulo :bootstrap_ok duplicado ("Bootstrap criado" saia 2x).

### 1.13.0 — 2026-10-07 10:00

**Tarefa agendada com a configuracao completa (via _criar-tarefa.ps1, ao lado deste .bat).**

dispara "Ao fazer logon" de qualquer usuario E "Ao inicializar"; nenhuma condicao (ocioso, energia AC, reativar, rede); executa por demanda, executa assim que possivel se a inicializacao foi perdida, reinicia a cada 1 min ate 99x em caso de falha, sem limite de tempo, forca a interrupcao e nunca inicia uma segunda instancia. Sem o auxiliar (ou se ele falhar), cria a tarefa basica pelo schtasks como antes. NOVO ARQUIVO NECESSARIO: _criar-tarefa.ps1 na pasta do sistema.

### 1.12.0 — 2026-10-06 16:30

**Tarefa agendada roda IMEDIATAMENTE no logon (inclusive no logon automatico logo apos ligar o computador).**

removido o atraso de 2 min (/delay 0002:00). A espera pela pasta de rede continua garantida pelo bootstrap.vbs (ate 30 min). Alem disso a tarefa deixa de ter os padroes do schtasks que podiam segura-la: "so iniciar na energia AC" (notebook na bateria nunca iniciava), "parar se passar para bateria" e limite de execucao de 72 h.

### 1.11.2 — 2026-10-06 10:00

**A mensagem final indica o remover-inicializacao.bat (remove tarefa, atalho, registro e bootstrap) em vez do comando schtasks, que so' apagava a tarefa.**

### 1.11.1 — 2026-10-05 17:30

**O nome do sistema perdia TODOS os espacos ("Loja Silva" virava "LojaSilva") no titulo, no nome da tarefa agendada, do atalho e da regra de firewall.**

o "!APP_NAME: =!" que so' deveria TESTAR se o nome estava vazio sobrescrevia a propria variavel. Agora o teste usa uma variavel separada, e a tarefa/atalho/regra com o nome antigo (sem espacos) sao removidos para nao ficarem duplicados.

### 1.11.0 — 2026-08-12 22:30

**bootstrap.vbs deixou de ser GERADO e passou a ser COPIADO.**

- Gerar o arquivo linha a linha com "echo" exigia escapar ( ) & < > e conviver com as regras de expansao do cmd. Falhou de tres formas diferentes em producao: bloco fechando cedo (arquivo pela metade e codigo aparecendo na tela), BOM que o wscript recusa (800A0408) e escapes vazando ("Erro de sintaxe" na linha 6, 800A03EA -- o erro apontava o caractere 54 de uma linha que so' deveria ter 52).
- Agora bootstrap.vbs e' arquivo do projeto, versionado como qualquer outro, e o instalador so' faz "copy". Copiar nao tem escape, nem expansao, nem encoding a definir -- elimina a classe inteira de falhas.
- O caminho do launcher (unico dado dinamico) vai em "launcher.path", arquivo texto de uma linha gravado com um echo simples ao lado do bootstrap, que o le em tempo de execucao.
- Removido o bloco de fallback do CMD (21 linhas): era codigo morto que reproduzia a mesma geracao fragil.
- launcher.path tambem e' apagado junto com o bootstrap antigo.
- NOVO ARQUIVO NECESSARIO: bootstrap.vbs deve estar na pasta do sistema.

---

## `_criar-tarefa.ps1`

Auxiliar do instalador (tarefa agendada).

### 1.0.0 — 2026-10-07 10:00

**Primeira versao.**

---

## `bootstrap.vbs`

Bootstrap do logon.

### 1.1.0 — 2026-10-07 22:30

**launcher.path lido em UTF-8.**

O instalador roda com "chcp 65001" e grava o arquivo em UTF-8; aqui ele era lido como ANSI, e um caminho com acento (C:\Relatorios com acento, perfil "Usuário" com acento) nunca era encontrado: o servidor nao subia no logon. Le em UTF-8 (ADODB.Stream) e, se o arquivo nao existir assim, tenta tambem a leitura antiga (ANSI) - cobre launcher.path gravado por versoes anteriores.

### 1.0.0 — 2026-08-12 22:30

**Criado como arquivo estatico do projeto, substituindo a geracao dinamica por echo em instalar-na-inicializacao.bat.**

---

## `launcher.vbs`

Launcher.

### 1.0.1 — 2026-08-07 20:35

**Etapa 4/6 (eixo precisao).**

Removidos todos os caracteres nao-ASCII (travessao e seta, que estavam apenas em comentarios). Mesma classe de risco ja corrigida nos .ps1 e .bat do projeto: wscript.exe le arquivos .vbs sem BOM usando a code page do sistema, e bytes multi-byte de UTF-8 podem ser reinterpretados de forma incorreta, corrompendo o parsing do script a partir dali. Arquivo agora 100% ASCII, como todo o resto do projeto.

---

## `remover-inicializacao.bat`

Removedor da inicialização automática.

### 1.0.0 — 2026-10-06 10:00

**Primeira versao.**

Mantem CRLF e somente ASCII - edite com editor que preserve CRLF.

---

## `_remover-inicializacao.ps1`

Auxiliar do removedor.

### 1.0.1 — 2026-10-07 22:30

**Data e hora do log do MESMO instante.**

### 1.0.0 — 2026-10-06 10:00

**Primeira versao.**

---

## `_instalar-node.ps1`

Instalador do Node.js.

### 1.3.0 — 2026-10-05 16:24

**Revisao completa.**

- Integridade: o MSI baixado era executado como Administrador sem nenhuma verificacao. Agora o SHA-256 e' conferido contra o SHASUMS256.txt oficial da mesma versao; sem acesso a ele, exige assinatura digital (Authenticode) valida do arquivo.
- Auto-elevacao: a instancia nao elevada sempre saia com codigo 0, mesmo quando a elevada falhava - os .bat seguiam como se o Node estivesse instalado. Agora o codigo de saida da instancia elevada e' repassado.
- Node.js 20 (fim de suporte em abril/2026) trocado pela LTS 22.22.0.
- Read-Host protegido: os .bat chamam este script com -NonInteractive, onde Read-Host lanca erro em vez de esperar o ENTER.

### 1.2.1 — 2026-08-07 15:30

**Prevencao (causa raiz encontrada em iniciar-tray.ps1, mesma familia de risco).**

- Havia um travessao Unicode dentro de um Write-Log real (nao em comentario) na secao de download do MSI. Windows PowerShell 5.1 nao assume UTF-8 por padrao para .ps1 sem BOM - pode reinterpretar bytes multi-byte incorretamente e corromper o parsing do script a partir dali. Removidos todos os caracteres nao-ASCII do arquivo; agora 100% ASCII. Ver changelog de iniciar-tray.ps1 v1.2.2 para o caso concreto que motivou essa checagem em todos os .ps1 do projeto.

---

## `node-firebird.bat`

Instalador do node-firebird.

### 1.1.1 — 2026-08-08 05:10

**Quebras de linha convertidas para CRLF, a convencao correta do Windows.**

Estes arquivos estavam com LF puro; funcionavam porque so' usam "goto", mas "call :label" quebra nesse formato (ver instalar-na-inicializacao.bat v1.8.1). Padronizado em todo o projeto para evitar a armadilha em edicoes futuras. Se for editar, use um editor que preserve CRLF.

---

## `gerar_relatorio_do_dia.bat`

Atalho: relatório do dia.

### 1.4.2 — 2026-10-05 16:24

**"echo" sem ponto apos instalar o node-firebird imprimia "ECHO is off." / "ECHO desativado." na tela; trocado por "echo." (linha em branco, como no resto do arquivo).**

Mantem CRLF - edite com editor que preserve CRLF.

### 1.4.1 — 2026-08-08 05:10

**Quebras de linha convertidas para CRLF, a convencao correta do Windows.**

Estes arquivos estavam com LF puro; funcionavam porque so' usam "goto", mas "call :label" quebra nesse formato (ver instalar-na-inicializacao.bat v1.8.1). Padronizado em todo o projeto para evitar a armadilha em edicoes futuras. Se for editar, use um editor que preserve CRLF.

---

## `gerar_relatorio_por_data.bat`

Atalho: relatório por data.

### 1.5.0 — 2026-10-05 16:24

**Ano padrao obtido via PowerShell.**

"wmic" foi removido do Windows 11 24H2+, e sem ele o ano ficava com lixo (nao vazio), passando pelo "if not defined". Ano com 2 digitos (ex: 01/03/26) agora vira 2026, e o ano tambem e' validado (2000-2099) antes de montar a URL. Mantem CRLF - edite com editor que preserve CRLF.

### 1.4.1 — 2026-08-08 05:10

**Quebras de linha convertidas para CRLF, a convencao correta do Windows.**

Estes arquivos estavam com LF puro; funcionavam porque so' usam "goto", mas "call :label" quebra nesse formato (ver instalar-na-inicializacao.bat v1.8.1). Padronizado em todo o projeto para evitar a armadilha em edicoes futuras. Se for editar, use um editor que preserve CRLF.

---

## `gerar_relatorio_intervalo.bat`

Atalho: relatório por intervalo.

### 1.5.0 — 2026-10-05 16:24

**Ano padrao obtido via PowerShell.**

"wmic" foi removido do Windows 11 24H2+, e sem ele o ano ficava com lixo (nao vazio), passando pelo "if not defined". Ano com 2 digitos (ex: 01/03/26) agora vira 2026, e o ano tambem e' validado (2000-2099) antes de montar a URL. Mantem CRLF - edite com editor que preserve CRLF.

### 1.4.1 — 2026-08-08 05:10

**Quebras de linha convertidas para CRLF, a convencao correta do Windows.**

Estes arquivos estavam com LF puro; funcionavam porque so' usam "goto", mas "call :label" quebra nesse formato (ver instalar-na-inicializacao.bat v1.8.1). Padronizado em todo o projeto para evitar a armadilha em edicoes futuras. Se for editar, use um editor que preserve CRLF.
