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
- **Fast-poll:** consulta leve a cada 50 ms numa conexão persistente com o Firebird. Detecta:
  - venda nova, cancelamento e mudança de total;
  - NFC-e autorizada;
  - vendedor ou forma de pagamento preenchidos depois da venda.
- **Atualização automática do navegador por SSE** (Server-Sent Events), com polling HTTP como reserva.
- Avisos na tela (toasts) para correções de horário.

### Interface
- **16 temas de cores** (10 escuros e 6 claros), com prévia no menu; a escolha fica salva no navegador.
- Tabela no computador e cartões no celular, com renderização em blocos para dias com muitas vendas.
- **Busca avançada** com coringas de valor, texto, campo e operadores lógicos (veja [abaixo](#busca-e-filtros-coringas)).
- **Filtro de "proibidos"**: lista de produtos ou marcas que podem ser ocultados ou isolados com uma tecla.
- **Teclas de atalho personalizáveis**: cada tecla executa um comando de busca e/ou uma ação (copiar, filtrar, trocar tema…).
- **Ferramentas de cópia** para a área de transferência: tudo, com itens, sem dinheiro, só gerencial.
- Configurações editáveis pela própria tela: nome do sistema, ícone, intervalos, proibidos e atalhos.

### Operação
- **Ícone na bandeja do Windows** com abrir relatório, atualizar, gerar por período, configurações, selecionar banco, reiniciar e sair.
- **Watchdog:** o servidor é reiniciado sozinho se cair ou travar.
- **Inicialização automática no logon**, com espera de até 30 min pela pasta de rede e pelo banco.
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
                                                                  ├─ fast-poll (50 ms) ─┐
                                                                  ├─ pollStatus (≥2 s)  ├─▶ Firebird (SMALL.FDB)
                                                                  ├─ correções de hora ─┘
                                                                  └─ gera o HTML em subprocesso:
                                                                       node gerar-relatorio-html.js ─▶ Firebird
 Navegador (qualquer PC da rede) ◀── HTTP :7734 + SSE ──┘
```

| Componente | Função |
|---|---|
| `servidor-relatorio.js` | Servidor HTTP e SSE. Detecta o banco, monitora mudanças, corrige horários, mantém o cache de relatórios e coordena as gerações. |
| `gerar-relatorio-html.js` | Subprocesso que consulta o Firebird e monta o HTML completo do relatório (dados, interface e scripts). |
| `iniciar-tray.ps1` | Ícone na bandeja, menu de ações e watchdog que reinicia o servidor se ele cair ou travar. |
| `launcher.vbs` / `bootstrap.vbs` | Iniciam o tray de forma oculta. O bootstrap fica local e espera a pasta de rede aparecer no logon. |
| `instalar-na-inicializacao.bat` | Configura a inicialização automática (tarefa agendada ou pasta Inicializar), a regra de firewall e o nome do sistema. |
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
   - inicia o servidor imediatamente.
3. Se o banco não usar as credenciais de fábrica, defina `fbUser` e `fbPass` no `config.json`.
4. Abra o relatório pelo ícone da bandeja (duplo clique) ou em `http://localhost:7734`.

> Para só testar, sem inicialização automática, execute `gerar_relatorio_do_dia.bat`.

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
| `pollInterval` | `200` | Intervalo (ms) de verificação do navegador; o servidor usa no mínimo 2 s para a verificação completa |
| `spawnTimeoutMs` | `120000` | Tempo máximo (30 s a 600 s) para gerar um relatório; aumente para períodos longos |
| `toastDuration` | `5000` | Duração dos avisos na tela (ms) |
| `maxLogLines` | `5000` | Linhas mantidas no `relatorio.log` |
| `logDebug` | `false` | Registra detalhes de rotina (tempos de consulta etc.) |
| `favicon` | `""` | Ícone personalizado (arquivo dentro da pasta do sistema) |
| `proibidos` | `[]` | Lista de produtos/termos do filtro de proibidos |
| `teclasPersonalizadas` | `[]` | Atalhos: `{ "tecla": "F2", "comando": "[-proibidos]>150", "acao": "" }` |

O arquivo `hora-fixada-cache.json` é mantido pelo próprio sistema. Ele guarda os horários já corrigidos do dia e não precisa ser editado.

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
```

Repete automaticamente em falha de rede ou erro 5xx; erros 4xx falham na hora. Cada chamada se identifica no log do servidor com o nome do computador e do usuário.

---

## Correção automática de horário

Relógios de PDV adiantados ou atrasados e vendas abertas há muito tempo gravam horários que embaralham a ordem do relatório. O sistema corrige isso com regras fixas:

| Documento | Regra |
|---|---|
| **Gerencial** | Hora no futuro, ou entre 3 min e 1 h atrás → passa a ser a hora atual. Até 3 min atrás → aceita. Mais de 1 h → ignora. |
| **NFC-e / NF-e e pagamentos** | Só documentos que **aparecem** no banco já com mais de 1 min de atraso são corrigidos. O que já existia quando o servidor iniciou nunca é alterado. |
| **Exibição** | A hora fixada fica guardada em `hora-fixada-cache.json`, para a venda não "pular" de posição a cada atualização. |

Cada correção é registrada no log e avisada na tela.

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

Tudo vai para **`relatorio.log`**, na pasta do sistema: servidor, bandeja e instalador, no formato `[DD-MM-AAAA] [HH:MM:SS] mensagem`. A primeira linha de cada dia mostra as versões em uso:

```
[05-10-2026] [08:00:01] === Servidor iniciado 05/10/2026 === Servidor v2.9.1 | Gerador v3.2.2
```

- Chamadas à API vindas de **outros computadores** são registradas com IP e nome da máquina.
- Para investigar desempenho, ative `"logDebug": true` no `config.json`.

---

## Testes automáticos

Os testes rodam **sem Firebird real**: um banco simulado em `test/mock-firebird` responde às consultas do servidor e do gerador.

```bash
npm test
```

Eles cobrem a proteção contra XSS, a mescla do cache de horas entre processos, o painel de duplicatas, a regra de correção de horário e a validação das rotas da API.

---

## Estrutura do projeto

```
├── servidor-relatorio.js          Servidor HTTP/SSE e monitoramento do banco
├── gerar-relatorio-html.js        Geração do relatório (subprocesso)
├── config.json                    Configurações
├── hora-fixada-cache.json         Horários corrigidos do dia (automático)
├── iniciar-tray.ps1               Ícone na bandeja + watchdog
├── launcher.vbs / bootstrap.vbs   Inicialização oculta
├── instalar-na-inicializacao.bat  Instalação da inicialização automática
├── gerar_relatorio_do_dia.bat     Abre o relatório de hoje
├── gerar_relatorio_por_data.bat   Abre o relatório de uma data
├── gerar_relatorio_intervalo.bat  Abre o relatório de um período
├── api.ps1                        Cliente de linha de comando da API
├── _instalar-node.ps1             Instalador do Node.js
├── node-firebird.bat              Instalador do módulo node-firebird
├── package.json                   Script de testes (npm test)
└── test/                          Testes automáticos e Firebird simulado
```

---

## Solução de problemas

| Sintoma | O que verificar |
|---|---|
| Página "Banco de dados não encontrado" | Selecione o `SMALL.FDB` na página ou pelo menu da bandeja; confira se o Firebird está rodando (porta 3050) |
| "Falha ao conectar" / senha incorreta | Ajuste `fbUser` e `fbPass` no `config.json` e reinicie pelo menu da bandeja |
| Outro computador não abre o relatório | Porta 7734 no firewall (rode o instalador como administrador) e IP em `maquinaIP` |
| Relatório de período longo não termina | Aumente `spawnTimeoutMs` no `config.json` (até 600000) |
| Servidor não inicia no logon | Rode `instalar-na-inicializacao.bat` de novo; veja as linhas `[INSTALL]` e `[TRAY]` no `relatorio.log` |
| Qualquer outro problema | Consulte o `relatorio.log`, que registra erros, avisos e a versão em uso |

---

## Créditos

**Desenvolvido por Ruda Gabriel.**

Concepção, regras de negócio e manutenção do sistema: **Ruda Gabriel**.

© 2026 Ruda Gabriel. Todos os direitos reservados.
