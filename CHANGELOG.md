# Changelog

Histórico completo de versões de cada arquivo do projeto, da mais recente para a mais antiga.
Cada arquivo traz no cabeçalho só a entrada da **versão atual**; o histórico completo fica aqui.

Versões em uso hoje:

| Arquivo | Versão |
|---|---|
| [`servidor-relatorio.js`](#servidor-relatoriojs) | 2.15.5 |
| [`gerar-relatorio-html.js`](#gerar-relatorio-htmljs) | 3.8.2 |
| [`api.ps1`](#apips1) | 1.5.1 |
| [`iniciar-tray.ps1`](#iniciar-trayps1) | 1.4.1 |
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

### 3.8.2 — 2026-10-08 09:00

**Vendedores diferentes não são a mesma venda.**

- O aviso POSSIVEL_DUPLICIDADE (gerencial × NFC-e/NF-e de mesmo valor, até 20 min depois) comparava só valor e horário: gerencial 063538 (RICHARD) × NFC-e 125319 (GERENCIA) era apontada como possível duplicidade. Agora, se os DOIS vendedores são conhecidos e diferentes, o par é descartado. Vendedor vazio, "?" ou "(aguardando autorização)" — a NFC-e convertida só ganha vendedor depois da SEFAZ — não descarta.
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

O instalador roda com "chcp 65001" e grava o arquivo em UTF-8; aqui ele era lido como ANSI, e um caminho com acento (C:\Relatorios com acento, perfil "Joao" com til) nunca era encontrado: o servidor nao subia no logon. Le em UTF-8 (ADODB.Stream) e, se o arquivo nao existir assim, tenta tambem a leitura antiga (ANSI) - cobre launcher.path gravado por versoes anteriores.

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
