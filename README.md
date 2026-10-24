<div align="center">

# 📊 Relatórios FDB

### Painel de vendas em tempo real para lojas que usam o Small Commerce (Firebird)

<img alt="servidor: v2.18.0" src="https://img.shields.io/badge/servidor-v2.18.0-2563EB?style=flat">
<img alt="gerador: v3.21.0" src="https://img.shields.io/badge/gerador-v3.21.0-2563EB?style=flat">
<img alt="plataforma: Windows 10 | 11" src="https://img.shields.io/badge/plataforma-Windows%2010%20%7C%2011-0078D4?style=flat&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyNCAyNCcgZmlsbD0nd2hpdGUnPjxyZWN0IHg9JzMnIHk9JzMnIHdpZHRoPSc4JyBoZWlnaHQ9JzgnLz48cmVjdCB4PScxMycgeT0nMycgd2lkdGg9JzgnIGhlaWdodD0nOCcvPjxyZWN0IHg9JzMnIHk9JzEzJyB3aWR0aD0nOCcgaGVpZ2h0PSc4Jy8%2BPHJlY3QgeD0nMTMnIHk9JzEzJyB3aWR0aD0nOCcgaGVpZ2h0PSc4Jy8%2BPC9zdmc%2B&logoColor=white">
<img alt="idioma: pt-BR" src="https://img.shields.io/badge/idioma-pt--BR-16A34A?style=flat">
<img alt="banco: somente leitura" src="https://img.shields.io/badge/banco-somente%20leitura-DC2626?style=flat&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyNCAyNCcgZmlsbD0nbm9uZScgc3Ryb2tlPSd3aGl0ZScgc3Ryb2tlLXdpZHRoPScyLjInIHN0cm9rZS1saW5lY2FwPSdyb3VuZCcgc3Ryb2tlLWxpbmVqb2luPSdyb3VuZCc%2BPHBhdGggZD0nTTEyIDIyczgtNCA4LTEwVjVsLTgtMy04IDN2N2MwIDYgOCAxMCA4IDEweicvPjxwYXRoIGQ9J205IDEyIDIgMiA0LTQnLz48L3N2Zz4%3D&logoColor=white">
<img alt="funciona: sem internet" src="https://img.shields.io/badge/funciona-sem%20internet-0891B2?style=flat">
<img alt="testes: 26 passando" src="https://img.shields.io/badge/testes-26%20passando-22C55E?style=flat&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyNCAyNCcgZmlsbD0nbm9uZScgc3Ryb2tlPSd3aGl0ZScgc3Ryb2tlLXdpZHRoPScyLjInIHN0cm9rZS1saW5lY2FwPSdyb3VuZCcgc3Ryb2tlLWxpbmVqb2luPSdyb3VuZCc%2BPHBhdGggZD0nTTkgMnY2TDQgMTlhMiAyIDAgMCAwIDEuOCAzaDEyLjRhMiAyIDAgMCAwIDEuOC0zTDE1IDhWMicvPjxwYXRoIGQ9J004IDJoOCcvPjxwYXRoIGQ9J003IDE1aDEwJy8%2BPC9zdmc%2B&logoColor=white">
<img alt="licença: proprietária" src="https://img.shields.io/badge/licen%C3%A7a-propriet%C3%A1ria-6B7280?style=flat">

<img alt="Node.js: 18+" src="https://img.shields.io/badge/Node.js-18%2B-339933?style=flat&logo=nodedotjs&logoColor=white">
<img alt="JavaScript: ES2022" src="https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?style=flat&logo=javascript&logoColor=black">
<img alt="HTML5" src="https://img.shields.io/badge/HTML5-E34F26?style=flat&logo=html5&logoColor=white">
<img alt="CSS" src="https://img.shields.io/badge/CSS-1572B6?style=flat&logo=css&logoColor=white">
<img alt="Firebird: Small Commerce" src="https://img.shields.io/badge/Firebird-Small%20Commerce-B71C1C?style=flat&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyNCAyNCcgZmlsbD0nbm9uZScgc3Ryb2tlPSd3aGl0ZScgc3Ryb2tlLXdpZHRoPScyLjInIHN0cm9rZS1saW5lY2FwPSdyb3VuZCcgc3Ryb2tlLWxpbmVqb2luPSdyb3VuZCc%2BPGVsbGlwc2UgY3g9JzEyJyBjeT0nNScgcng9JzknIHJ5PSczJy8%2BPHBhdGggZD0nTTMgNXYxNGE5IDMgMCAwIDAgMTggMFY1Jy8%2BPHBhdGggZD0nTTMgMTJhOSAzIDAgMCAwIDE4IDAnLz48L3N2Zz4%3D&logoColor=white">
<img alt="node-firebird" src="https://img.shields.io/badge/node--firebird-driver-CB3837?style=flat&logo=npm&logoColor=white">
<img alt="PowerShell: 5.1" src="https://img.shields.io/badge/PowerShell-5.1-012456?style=flat&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyNCAyNCcgZmlsbD0nbm9uZScgc3Ryb2tlPSd3aGl0ZScgc3Ryb2tlLXdpZHRoPScyLjInIHN0cm9rZS1saW5lY2FwPSdyb3VuZCcgc3Ryb2tlLWxpbmVqb2luPSdyb3VuZCc%2BPHBvbHlsaW5lIHBvaW50cz0nNCAxNyAxMCAxMSA0IDUnLz48bGluZSB4MT0nMTInIHkxPScxOScgeDI9JzIwJyB5Mj0nMTknLz48L3N2Zz4%3D&logoColor=white">
<img alt="SSE: tempo real" src="https://img.shields.io/badge/SSE-tempo%20real-7C3AED?style=flat&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyNCAyNCcgZmlsbD0nbm9uZScgc3Ryb2tlPSd3aGl0ZScgc3Ryb2tlLXdpZHRoPScyLjInIHN0cm9rZS1saW5lY2FwPSdyb3VuZCcgc3Ryb2tlLWxpbmVqb2luPSdyb3VuZCc%2BPHBhdGggZD0nTTEzIDIgMyAxNGg5bC0xIDggMTAtMTJoLTlsMS04eicvPjwvc3ZnPg%3D%3D&logoColor=white">
<img alt="SVG: gráficos e ícones" src="https://img.shields.io/badge/SVG-gr%C3%A1ficos%20e%20%C3%ADcones-FFB13B?style=flat&logo=svg&logoColor=black">
<img alt="Lucide: ícones" src="https://img.shields.io/badge/Lucide-%C3%ADcones-F56565?style=flat&logo=lucide&logoColor=white">
<img alt="QR code: gerador próprio" src="https://img.shields.io/badge/QR%20code-gerador%20pr%C3%B3prio-111827?style=flat&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyNCAyNCcgZmlsbD0nbm9uZScgc3Ryb2tlPSd3aGl0ZScgc3Ryb2tlLXdpZHRoPScyLjInIHN0cm9rZS1saW5lY2FwPSdyb3VuZCcgc3Ryb2tlLWxpbmVqb2luPSdyb3VuZCc%2BPHJlY3QgeD0nMycgeT0nMycgd2lkdGg9JzUnIGhlaWdodD0nNScgcng9JzEnLz48cmVjdCB4PScxNicgeT0nMycgd2lkdGg9JzUnIGhlaWdodD0nNScgcng9JzEnLz48cmVjdCB4PSczJyB5PScxNicgd2lkdGg9JzUnIGhlaWdodD0nNScgcng9JzEnLz48cGF0aCBkPSdNMjEgMTZoLTNhMiAyIDAgMCAwLTIgMnYzJy8%2BPHBhdGggZD0nTTEyIDd2M2EyIDIgMCAwIDEtMiAySDcnLz48cGF0aCBkPSdNMTYgMTJoMScvPjxwYXRoIGQ9J00xMiAyMXYtMScvPjwvc3ZnPg%3D%3D&logoColor=white">
<img alt="node:test" src="https://img.shields.io/badge/node%3Atest-testes%20nativos-5FA04E?style=flat&logo=nodedotjs&logoColor=white">

**As vendas do dia na tela, atualizadas a cada venda · No computador e no celular · Nunca escreve no banco · Funciona sem internet**

[Instalar](#instalacao) · [Usar](#uso) · [Recursos](#recursos) · [Celular](#celular) · [Configurar](#configuracao) · [API](#api) · [Problemas](#problemas)

</div>

---

## O que é

Um servidor Node.js que **lê** o banco do Small Commerce (`SMALL.FDB`) e publica, na rede da loja, um painel web com as vendas do dia — **Gerencial, NFC-e e NF-e** — por vendedor, forma de pagamento e item. A tela se atualiza sozinha em menos de um segundo a cada venda, cancelamento ou autorização da SEFAZ.

Roda em segundo plano no Windows, com ícone na bandeja: inicia com o logon, se recupera sozinho de quedas e abre em qualquer computador ou celular da loja pelo navegador.

| | |
|---|---|
| ⚡ **Tempo real** | Venda nova aparece em ~0,3 s, sem apertar nada |
| 📱 **Computador e celular** | Layout próprio para cada tela; abre no celular por QR code |
| 🔒 **Somente leitura** | Nenhum `INSERT`, `UPDATE` ou `DELETE` — o banco do caixa nunca é alterado |
| 🌐 **Sem internet** | Tudo local: gráficos, ícones e QR code são gerados pelo próprio sistema |
| 🛟 **Se cuida sozinho** | Watchdog, reconexão automática com o banco e aviso na tela quando o servidor cai |

---

<a id="instalacao"></a>
## 🚀 Instalação em 3 passos

> **Requisitos:** Windows 10 ou 11 · acesso ao Firebird do Small Commerce (local ou na rede, porta 3050). O Node.js 18+ e o módulo `node-firebird` são instalados sozinhos.

1. **Copie a pasta do sistema** para a máquina servidora (ou para uma pasta de rede).
2. **Execute `instalar-na-inicializacao.bat`.** Ele pede permissão de administrador, instala o que faltar, pergunta o nome da loja, libera a porta 7734 no firewall, cria a inicialização automática e já liga o servidor.
3. **Abra o relatório:** duplo clique no ícone da bandeja ou `http://localhost:7734`.

> 💡 Banco com senha própria? Defina `fbUser` e `fbPass` no `config.json`.
> Só quer testar, sem inicialização automática? Execute `gerar_relatorio_do_dia.bat`.

<details>
<summary><b>O que a inicialização automática faz</b></summary>

A tarefa dispara **ao fazer logon** (qualquer usuário) e **ao ligar o computador**, sem condições (ocioso, energia, rede — funciona em notebook na bateria). Se falhar, tenta de novo a cada 1 min (até 99 vezes), não tem limite de tempo, nunca abre uma segunda cópia e espera até 30 min pela pasta de rede e pelo banco.

</details>

<details>
<summary><b>Remover a inicialização automática</b></summary>

Execute **`remover-inicializacao.bat`**. Ele remove tudo o que inicia o relatório sozinho:

- a tarefa agendada (com qualquer nome, inclusive de versões antigas);
- o atalho na pasta Inicializar e as entradas `Run` do registro;
- o bootstrap local em `%LOCALAPPDATA%\RelatoriosBootstrap`.

Antes, ele pergunta se deve **encerrar os processos do relatório**:

- **S** — o servidor encerra de forma ordenada (as telas abertas mostram "Servidor de relatórios encerrado"); o que não responder é forçado.
- **N** — o servidor continua até você sair pela bandeja ou reiniciar o computador.

Só são tocados processos `node`, `powershell`, `wscript` e `cscript` que citam arquivos do sistema — um editor com um desses arquivos aberto nunca é encerrado. O UAC só é pedido se algum item exigir. Não são apagados: `config.json`, logs, cache e a regra de firewall. Para reativar, rode o instalador de novo.

</details>

---

<a id="uso"></a>
## 🖥️ Uso no dia a dia

| Quero… | Como |
|---|---|
| Ver as vendas de hoje | Duplo clique no ícone da bandeja · `gerar_relatorio_do_dia.bat` · `http://IP:7734/` |
| Abrir no celular | Botão **Celular** no topo (mostra um QR code) · bandeja → *Abrir no celular (QR code)* |
| Ver uma data | `gerar_relatorio_por_data.bat` (aceita `D/M`, `DD/MM` ou `DD/MM/AA[AA]`) |
| Ver um período | Botão **Por período** · `gerar_relatorio_intervalo.bat` · `http://IP:7734/periodo` |
| Forçar atualização | Botão **Atualizar** · bandeja → *Atualizar dados de hoje* |
| Mudar tema, visualização ou tamanho do texto | Botão **Tema** |
| Trocar o banco | Bandeja → *Configurações → Selecionar banco (FDB)* · `http://IP:7734/selecionar-fdb` |
| Configurar | Botão **Configurações** · `http://IP:7734/config` |
| Ver quem está conectado | Bandeja → *Dispositivos conectados* |
| Reiniciar | Bandeja → *Reiniciar servidor* · `api.ps1 -Endpoint restart` |

<details>
<summary><b>Atalhos de teclado</b> (fora de campos de texto)</summary>

| Tecla | Efeito |
|---|---|
| `Insert` ou `CapsLock`+`P` | Adiciona `[proibidos]`: oculta vendas com itens proibidos |
| `Delete` | Adiciona `[-proibidos]`: mostra **só** vendas com itens proibidos |
| `Esc` | Fecha janelas |
| Personalizadas | *Configurações → Teclas de atalho* (F1–F12, Insert, Delete, Home, End, PageUp/Down e combinações com Ctrl/Alt) |

</details>

---

<a id="recursos"></a>
## ✨ Recursos

### 🧾 Relatório
- **Hoje, uma data ou um período**, unindo as tabelas `NFCE` (Gerencial 99, NFC-e 65 e NF-e 55), `VENDAS` (NF-e) e `PAGAMENT` (formas de pagamento).
- **Totais por tipo e por vendedor**, com quantidade e valor.
- **Detalhe da venda:** itens, quantidades, preços, descontos, pagamentos, cliente, natureza da operação e hora.
- **Reconciliação automática:** gerencial convertida em NFC-e ou NF-e não conta duas vezes; NF-e rejeitada pela SEFAZ é descartada; vendas aguardando autorização aparecem na hora, com rótulo próprio.
- **Painel "Duplicatas"** para as gerenciais suprimidas, com *Manter todas*, *Perguntar depois* ou *Não perguntar mais*.

### 🎨 Interface
- **7 temas:** Escuro e Claro + 5 de estilo (HUD Ciano, Índigo Neon, Executivo, Âmbar Vidro e Brasa Noturna), que mudam também cantos, bordas, brilho e fundo.
- **Visualização detalhada:** indicadores e gráficos — faturamento e vendas por hora, participação por tipo, ranking de vendedores, pagamentos e produtos — acima da tabela, seguindo os filtros.
- **Desempenho:** *Completo* (animações de entrada e saída em tudo) ou *Leve* (sem animações, para máquinas fracas); o *Automático* detecta sozinho.
- **Tamanho do texto** de 80% a 140%, no computador e no celular (salvos separados).
- **Busca avançada** com coringas (veja [abaixo](#busca)), **filtro de proibidos**, **chip de desconto** nos itens, **ferramentas de cópia** e **teclas de atalho** personalizáveis.
- **Recarregamento sem piscar:** quando entra uma venda, a tela volta no mesmo ponto da lista e com os mesmos filtros.

### 🛠️ Operação
- **Bandeja do Windows** com menu completo e ícones: status ao vivo, abrir, atualizar, período, telas abertas (trazer para frente, recarregar, enviar aviso, tema), dispositivos conectados, configurações, ferramentas (informações, copiar endereço, pasta, log, log ao vivo, `api.ps1`, programas), reiniciar e sair.
- **Watchdog:** reinicia o servidor se cair ou travar.
- **Detecção do banco:** caminhos conhecidos → `config.json` → varredura da rede na porta 3050 → página para escolher o `SMALL.FDB`. Reconecta sozinho quando o banco volta.
- **Instalação automática de dependências** (Node.js com verificação de integridade e `node-firebird`).

<details>
<summary><b>⚡ Como a detecção em tempo real funciona por dentro</b></summary>

- **Fast-poll** a partir de 15 ms numa conexão persistente, adaptativo (nunca ocupa mais de 1/3 do tempo do banco do caixa), separado por tipo (Gerencial, NFC-e e NF-e, inclusive a NF-e gravada só em `VENDAS`). Detecta venda nova e cancelamento; total que sobe ou desce; venda que muda de tipo; troca de vendedor, de número ou de forma de pagamento; NFC-e autorizada.
- **Dividido pelos índices:** as tabelas com índice na data vão para a consulta rápida; as sem índice, para uma complementar mais espaçada. Ex.: `FastPoll: consulta rápida (NFCE, com índice) ~13 ms → a cada ~52 ms | complementar (PAGAMENT, VENDAS, sem índice) ~269 ms → a cada ~3228 ms`.
- **Gerador pré-aquecido** (Node e driver já carregados) e aviso de "HTML pronto" sem esperar fechar conexões.
- **Um refresh por movimento:** a geração espera o pagamento da venda (até 1,5 s) e a autorização da NFC-e convertida (até 8 s) e gera uma vez só, com tudo.
- **Tempo até a tela atualizar:** ~140 ms do registro no banco ao aviso no navegador (Firebird 3 local).
- Cada venda e cada pagamento entram numa assinatura (hash) somada por tipo; se o Firebird não aceitar essa consulta, o fast-poll segue no modo básico, sem parar.
- **Navegador:** atualização por SSE (Server-Sent Events), com polling HTTP de reserva; faixa de aviso quando o servidor cai e volta sozinho.

</details>

---

<a id="celular"></a>
## 📱 Celular e rede da loja

- **Abrir no celular:** clique em **Celular** no topo do relatório (ou na bandeja → *Abrir no celular*) e aponte a câmera para o QR code. O celular precisa estar no **mesmo Wi-Fi**. O endereço é sempre o IP da máquina na rede (`http://IP:7734/`), e o QR code é gerado pelo próprio sistema, sem internet.
- **Layout próprio:** a página rola inteira, cartões compactos, badges em pares "nome: valor", barra fixa com **Copiar** (todas as opções de cópia), **Vendas** (vai para a lista) e **Mais**.
- **Quem está conectado:** cada celular ou computador que abre o relatório aparece no log (`[CONEXAO]`) e na janela *Dispositivos conectados* da bandeja — tipo, modelo, sistema, navegador, IP, **nome do aparelho** e rotas acessadas.
- **Preferências de cada aparelho:** duração dos avisos, termos proibidos e teclas de atalho são **de cada aparelho** (em *Configurações → Minhas preferências*). Quando um muda, os outros não são afetados. Só o **computador do servidor** muda o padrão de todos, o nome, o intervalo, o log, a janela de correção, o ícone e o banco. Ele também edita ou restaura as preferências de qualquer aparelho conectado (bandeja → *Dispositivos conectados* → *Configurações do aparelho...* / *Voltar ao padrão*). Ficam em `preferencias-aparelhos.json`, na pasta do sistema, nunca no banco.

<details>
<summary><b>Como o nome do aparelho é descoberto</b></summary>

O navegador não envia o nome de "Ajustes → Geral → Sobre"; o servidor pergunta ao próprio aparelho pela rede: **Bonjour/mDNS** (iPhone, iPad, Mac e muitos Android — no iPhone o nome vem do nome em "Sobre", ex.: "iPhone de Ruda" → `iPhone-de-Ruda`), **NetBIOS** (computadores Windows) e, como reserva, o **DNS do roteador**. Sem resposta (rede de visitantes, roteador que bloqueia Bonjour), aparece "não informado pelo aparelho".

```
[CONEXAO] Novo dispositivo conectado: Celular iPhone (iOS 17.5, Safari 17.5) | IP 192.168.1.50 | nome: iPhone-de-Ruda (Bonjour)
[CONEXAO] Acesso: GET / ← iPhone-de-Ruda (192.168.1.50) → 200 (3 ms)
[API]     API: GET /api/itens-venda?data=2026-10-23&numero=064759 ← iPhone-de-Ruda (192.168.1.50) → 200 (41 ms)
[CONEXAO] Atividade de iPhone-de-Ruda nos últimos 10 min — chamadas automáticas: /api/status ×1200, recarregamentos automáticos ×4
[CONEXAO] Dispositivo saiu: iPhone-de-Ruda (192.168.1.50) — conectado das 16:20 às 16:49 (30 min) | rotas: / ×5, /api/itens-venda ×2
```

</details>

---

<a id="busca"></a>
## 🔎 Busca e filtros

A caixa de busca aceita filtros combináveis; a ajuda completa fica no botão **Ajuda**. Os botões **Todos / Gerencial / NFC-e / NF-e** restringem o tipo.

| Coringa | Significado | Exemplo |
|---|---|---|
| `>` `>=` `<` `<=` | Valor maior / menor | `>100`, `<150-granel` |
| `100-200` | Intervalo de valores | `50-80` |
| `=151` / `=151*5` | Vendas que somam o alvo (com tolerância) | `=151*5` |
| `*` `/` `?` | Padrões de dígitos no valor | `15*`, `/15/`, `1?0` |
| `palavra*` · `*palavra` · `*palavra*` | Começa / termina / contém | `RACAO*`, `*GATO` |
| `A\|B` | Ou | `dinheiro\|pix` |
| `+` | E | `>50+dinheiro+-entrega` |
| `-termo` | Exclui | `cartao-credito-debito` |
| `[a,~b,=c]` | Lista de exclusão (token, contém, exato) | `[granel,~entrega,=pix]` |
| `[proibidos]` / `[-proibidos]` | Oculta / isola vendas com itens proibidos | `[-p]` |
| `vendedor:` `item:` `caixa:` `numero:` `cliente:` `hora:` `pag:` `nat:` `tipo:` | Por campo | `vend:MARIA`, `tipo:nfce` |

---

<a id="configuracao"></a>
## ⚙️ Configuração (`config.json`)

A maior parte pode ser editada pela própria tela (**Configurações**), no computador do servidor. Os outros aparelhos só mudam as **próprias** preferências (avisos, proibidos, teclas; veja [Celular](#celular)). As chaves:

| Chave | Padrão | Para que serve |
|---|---|---|
| `appName` | `"Relatorios"` | Nome exibido no título, na bandeja e nas janelas |
| `porta` | `7734` | Porta HTTP |
| `fdbPath` / `fbHost` | automático | Caminho do `SMALL.FDB` e host do Firebird (salvos ao encontrar o banco) |
| `fbUser` / `fbPass` | `SYSDBA` / `masterkey` | Credenciais do Firebird (passadas por variável de ambiente, nunca pela linha de comando) |
| `maquinaIP` | automático | IP desta máquina na rede (atualizado a cada início) |
| `pollInterval` | `100` | Verificação de reserva do navegador (ms, mín. 100) |
| `spawnTimeoutMs` | `120000` | Tempo máximo de geração (30 s a 600 s) — aumente para períodos longos |
| `toastDuration` | `5000` | Duração dos avisos na tela (ms) |
| `janelaCorrecaoHoraMin` | `180` | Janela da correção de horário, de 5 a 720 min ([detalhes](#horario)) |
| `maxLogLines` / `logDebug` | `5000` / `false` | Tamanho do `relatorio.log` / detalhes de rotina |
| `favicon` | `""` | Ícone personalizado (arquivo da pasta do sistema) |
| `proibidos` | `[]` | Termos do filtro de proibidos |
| `teclasPersonalizadas` | `[]` | Atalhos: `{ "tecla": "F2", "comando": "[-proibidos]>150", "acao": "" }` |
| `programas` | `[]` | Programas que a bandeja e o `api.ps1` podem abrir: `{ "nome": "Small Commerce", "caminho": "C:\\Small\\Small.exe", "args": "" }` (só editável neste arquivo) |

> `hora-fixada-cache.json`, `relatorio.log` e `favicon.png` são criados e mantidos pelo próprio sistema.

---

<a id="leitura"></a>
## 🔒 Somente leitura e segurança

O sistema **nunca escreve no banco do Small Commerce** — nenhum `UPDATE`, `INSERT`, `DELETE` ou alteração de estrutura. Duas travas, no servidor e no gerador:

1. **Comando:** só sai para o banco SQL que começa com `SELECT` ou `WITH`; qualquer outro é recusado antes.
2. **Transação:** toda leitura roda numa transação **somente leitura** do Firebird (READ COMMITTED, sem espera). Mesmo que um comando de escrita escapasse, o próprio Firebird recusaria.

Verificado num Firebird 3 em uso: milhares de transações observadas em `MON$TRANSACTIONS`, **todas somente leitura**. O sistema também **não cria índices**: se faltarem, o log diz o que pedir ao suporte do Small Commerce.

<details>
<summary><b>Demais proteções</b></summary>

- Senha do Firebird por **variável de ambiente** (não aparece na lista de processos).
- Proteção contra **XSS** (JSON embutido escapado; textos do usuário escapados).
- Validação de todas as entradas da API (listas, datas, tamanhos, caminhos de ícone restritos à pasta).
- Log de erros do navegador **sem quebras de linha forjáveis**.
- Reinício remoto, leitura do log, lista de dispositivos e abertura de programas **só da rede local**. Programas: pela rede só se escolhe **um nome** da lista do `config.json` — nunca caminho ou comando livre.
- Gravação **atômica** de `config.json`, cache de horas e relatórios.
- O instalador do Node.js confere o **SHA-256** oficial (ou a assinatura digital) antes de executar.

</details>

<a id="horario"></a>
<details>
<summary><b>🕐 Correção automática de horário (só na tela)</b></summary>

Relógios de PDV adiantados ou atrasados embaralham a ordem do relatório. O sistema corrige **só na tela** — o banco nunca é alterado.

| Situação | Regra |
|---|---|
| **Venda nova** | Hora no futuro, ou entre 3 min e a janela de correção atrás → exibida com a hora em que apareceu. Até 3 min → aceita. Mais antiga que a janela → ignora. Padrão: **3 horas**. |
| **Venda que já existia** ao ligar/reconectar | Exibida como está (só hora no futuro é ajustada). |
| **Exibição** | A hora decidida fica em `hora-fixada-cache.json` (fora do banco), para a venda não "pular" de posição. |

A janela fica em *Configurações → Janela de correção de horário* ou em `janelaCorrecaoHoraMin` (5 a 720 min) e vale na hora. Perto da meia-noite começa às 00:00. Venda com hora fixada que for cancelada ou convertida ganha `situacao` (e `convertidaEm`) no cache.

</details>

---

<a id="api"></a>
## 🔌 API e linha de comando

Tudo responde na porta configurada (padrão `7734`). O **`api.ps1`** (PowerShell) dá acesso a todas as rotas, com menu interativo — use na própria máquina ou em outro computador da rede:

```powershell
.\api.ps1                                   # menu interativo (H = listar comandos)
.\api.ps1 -Endpoint status                  # vendas e total do dia
.\api.ps1 -Endpoint dispositivos            # quem está com o relatório aberto
.\api.ps1 -Endpoint aviso -Payload "Fechamento às 18h"
.\api.ps1 -Endpoint tema -Payload hud       # troca o tema das telas abertas
.\api.ps1 -Endpoint log -Payload @{ linhas = 100; filtro = "ERRO" }
.\api.ps1 -Endpoint restart -MaquinaIP 192.168.1.50
```

<details>
<summary><b>Todas as rotas HTTP</b></summary>

| Rota | Método | Descrição |
|---|---|---|
| `/` | GET | Relatório de hoje |
| `/periodo?i=AAAA-MM-DD&f=AAAA-MM-DD` | GET | Relatório de um período (sem parâmetros: formulário) |
| `/atualizar` | GET | Descarta o cache de hoje e regenera |
| `/config` · `/selecionar-fdb` | GET | Páginas de configurações e de seleção do banco |
| `/qr` · `/qr.svg` · `/api/qr` | GET | QR code do endereço desta máquina na rede (página, imagem, texto) |
| `/pronto?k=CHAVE` | GET | Estado de uma geração em andamento |
| `/api/status` | GET | Quantidade e total do dia, por tipo, e avisos de correção |
| `/api/db-status` | GET | Estado da conexão com o banco |
| `/api/events` | GET | Fluxo SSE (tempo real) |
| `/api/config` · `/api/proibidos` | GET/POST | Lê e salva configurações / lista de proibidos |
| `/api/salvar-fdb` | POST | Define o banco: `{ "caminho": "C:\\...\\SMALL.FDB" }` ou `"IP:C:\\...\\SMALL.FDB"` |
| `/api/abrir-picker-fdb` | GET | Abre o seletor de arquivos do Windows na máquina servidora |
| `/api/upload-favicon` | POST | Envia um ícone PNG/ICO/JPEG (até 2 MB) |
| `/api/navigate/hoje` · `/config` · `/selecionar-fdb` · `/periodo/INI/FIM` · `/hash/{config\|periodo}` · `/foco` · `/recarregar` | GET | Comandam as telas abertas via SSE |
| `/api/navigate/tema/ID` · `/api/temas` | GET | Troca o tema das telas abertas / lista os temas |
| `/api/navigate/aviso` | POST | Aviso nas telas abertas: `{ "msg": "texto", "segundos": 12 }` |
| `/api/sse-clients` | GET | Número de telas conectadas |
| `/api/info` | GET | Versões, máquina, banco, memória e tempo ligado |
| `/api/log?linhas=N&filtro=texto` | GET | Últimas linhas do `relatorio.log` (rede local) |
| `/api/dispositivos` | GET | Aparelhos com o relatório aberto: nome, IP, tipo, rotas (rede local) |
| `/api/programas` · `/api/programas/abrir` | GET/POST | Lista / abre um programa da lista do `config.json` (rede local) |
| `/api/restart` · `/api/encerrar` | GET | Reinicia / encerra de forma ordenada (rede local) |
| `/api/log-error` · `/api/hora-usuario` | POST | Uso interno do navegador |

No `status`, `-1` significa "ainda não lido do banco"; a resposta traz `obs` explicando. O `api.ps1` repete sozinho em falha de rede ou erro 5xx e mostra o motivo enviado pelo servidor.

</details>

---

## 📜 Logs e diagnóstico

Tudo vai para **`relatorio.log`**, na pasta do sistema, no formato `[DD-MM-AAAA] [HH:MM:SS] [CATEGORIA] mensagem`. Pela bandeja: *Ferramentas → Abrir o log* ou *Acompanhar o log ao vivo*.

| Categoria | O que registra |
|---|---|
| `[VENDAS]` | Venda nova, alterada, excluída ou convertida; hora corrigida |
| `[FASTPOLL]` | Detecção rápida: modo, ritmo, virada de dia |
| `[BANCO]` | Conexão com o Firebird, caminho do FDB, índices |
| `[GERADOR]` | Geração do relatório |
| `[SERVIDOR]` | Início, parada e reinício |
| `[CONEXAO]` / `[API]` | Aparelhos da rede (nome, IP, rotas) / chamadas `/api` de outros aparelhos |
| `[NAVEGADOR]` | Erros enviados pela tela do relatório |
| `[CONFIG]` · `[REDE]` | Configurações e ícone · IP da máquina |
| `[TRAY]` · `[INSTALL]` · `[REMOVER]` | Bandeja, instalador e removedor |
| `[DEBUG]` · `[SISTEMA]` | Detalhes (com `"logDebug": true`) · demais mensagens |

```
[07-10-2026] [08:00:01] [SERVIDOR] === Servidor iniciado 07/10/2026 === Servidor v2.18.0 | Gerador v3.21.0
[07-10-2026] [08:00:06] [BANCO] Índices: NFCE.DATA, PAGAMENT.DATA — ok (consultas rápidas).
[07-10-2026] [12:43:31] [VENDAS] FastPoll: Gerencial: vendas 30 → 31 (↑ +1) ... → regerando.
```

---

## 🧪 Testes

Rodam **sem Firebird real** — um banco simulado em `test/mock-firebird` responde às consultas.

```bash
npm test
```

No Windows: duplo clique em **`test\executar-testes.bat`**. Os 26 testes cobrem a garantia de **somente leitura**, a atualização numa rajada de vendas, XSS, o cache de horas, o painel de duplicatas, a correção de horário, os dispositivos conectados, o controle remoto e a validação das rotas.

---

## 🗂️ Como é organizado

```
 Windows (logon)
   └─ Tarefa agendada ─▶ bootstrap.vbs ─▶ launcher.vbs ─▶ iniciar-tray.ps1   (bandeja + watchdog)
                                                            └─▶ node servidor-relatorio.js
                                                                  ├─ fast-poll ──────┐
                                                                  ├─ verificação     ├─▶ Firebird (SMALL.FDB) — SOMENTE LEITURA
                                                                  └─ node gerar-relatorio-html.js ─┘
 Navegador (computador ou celular da rede) ◀── HTTP :7734 + SSE
```

<details>
<summary><b>Arquivos do projeto</b></summary>

| Arquivo | Função |
|---|---|
| `servidor-relatorio.js` | Servidor HTTP/SSE: detecta o banco, monitora mudanças, cache, gerações, dispositivos e QR code |
| `gerar-relatorio-html.js` | Subprocesso que consulta o Firebird e monta o relatório (dados, interface e scripts) |
| `iniciar-tray.ps1` | Ícone na bandeja, menu e watchdog |
| `launcher.vbs` / `bootstrap.vbs` | Iniciam a bandeja de forma oculta (o bootstrap espera a pasta de rede no logon) |
| `instalar-na-inicializacao.bat` · `_criar-tarefa.ps1` | Inicialização automática, firewall e nome do sistema |
| `remover-inicializacao.bat` · `_remover-inicializacao.ps1` | Desfazem a inicialização automática |
| `gerar_relatorio_do_dia.bat` · `_por_data.bat` · `_intervalo.bat` | Abrem o relatório (iniciam o servidor se preciso) |
| `api.ps1` | Cliente de linha de comando da API |
| `_instalar-node.ps1` · `node-firebird.bat` | Instalam o Node.js e o `node-firebird` |
| `config.json` | Configurações |
| `package.json` · `test/` | Testes automáticos (`npm test`, `executar-testes.bat`, Firebird simulado) |
| `CHANGELOG.md` | Histórico completo de versões de cada arquivo (o cabeçalho de cada arquivo traz só a versão atual) |

</details>

---

<a id="problemas"></a>
## 🩺 Solução de problemas

| Sintoma | O que fazer |
|---|---|
| "Banco de dados não encontrado" | Escolha o `SMALL.FDB` na página ou pela bandeja; confira se o Firebird está rodando (porta 3050) |
| "Falha ao conectar" / senha incorreta | Ajuste `fbUser` e `fbPass` no `config.json` e reinicie pela bandeja |
| Outro computador ou celular não abre | Mesmo Wi-Fi/rede? Porta 7734 no firewall (rode o instalador como administrador); confira o IP em *Ferramentas → Informações* |
| Relatório de período longo não termina | Aumente `spawnTimeoutMs` (até 600000) |
| Servidor não inicia no logon | Rode `instalar-na-inicializacao.bat` de novo e veja as linhas `[INSTALL]` e `[TRAY]` no log |
| Continua iniciando sozinho após remover | Rode `remover-inicializacao.bat` como administrador e veja as linhas `[REMOVER]` |
| Qualquer outro problema | O `relatorio.log` registra erros, avisos e a versão em uso |

---

<div align="center">

**Desenvolvido por Ruda Gabriel** — concepção, regras de negócio e manutenção.

© 2026 Ruda Gabriel. Todos os direitos reservados.

</div>
