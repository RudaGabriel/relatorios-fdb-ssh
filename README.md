<div align="center">

# 📊 Relatórios FDB

### Painel de vendas em tempo real para lojas que usam o Small Commerce (Firebird)

<img alt="servidor: v2.23.0" src="https://img.shields.io/badge/servidor-v2.23.0-2563EB?style=flat">
<img alt="gerador: v3.27.0" src="https://img.shields.io/badge/gerador-v3.27.0-2563EB?style=flat">
<img alt="bandeja: v1.6.1" src="https://img.shields.io/badge/bandeja-v1.6.1-2563EB?style=flat">
<img alt="plataforma: Windows 10 | 11" src="https://img.shields.io/badge/plataforma-Windows%2010%20%7C%2011-0078D4?style=flat&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyNCAyNCcgZmlsbD0nd2hpdGUnPjxyZWN0IHg9JzMnIHk9JzMnIHdpZHRoPSc4JyBoZWlnaHQ9JzgnLz48cmVjdCB4PScxMycgeT0nMycgd2lkdGg9JzgnIGhlaWdodD0nOCcvPjxyZWN0IHg9JzMnIHk9JzEzJyB3aWR0aD0nOCcgaGVpZ2h0PSc4Jy8%2BPHJlY3QgeD0nMTMnIHk9JzEzJyB3aWR0aD0nOCcgaGVpZ2h0PSc4Jy8%2BPC9zdmc%2B&logoColor=white">
<img alt="idioma: pt-BR" src="https://img.shields.io/badge/idioma-pt--BR-16A34A?style=flat">
<img alt="banco: somente leitura" src="https://img.shields.io/badge/banco-somente%20leitura-DC2626?style=flat&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyNCAyNCcgZmlsbD0nbm9uZScgc3Ryb2tlPSd3aGl0ZScgc3Ryb2tlLXdpZHRoPScyLjInIHN0cm9rZS1saW5lY2FwPSdyb3VuZCcgc3Ryb2tlLWxpbmVqb2luPSdyb3VuZCc%2BPHBhdGggZD0nTTEyIDIyczgtNCA4LTEwVjVsLTgtMy04IDN2N2MwIDYgOCAxMCA4IDEweicvPjxwYXRoIGQ9J205IDEyIDIgMiA0LTQnLz48L3N2Zz4%3D&logoColor=white">
<img alt="funciona: sem internet" src="https://img.shields.io/badge/funciona-sem%20internet-0891B2?style=flat">
<img alt="testes: 28 passando" src="https://img.shields.io/badge/testes-28%20passando-22C55E?style=flat&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyNCAyNCcgZmlsbD0nbm9uZScgc3Ryb2tlPSd3aGl0ZScgc3Ryb2tlLXdpZHRoPScyLjInIHN0cm9rZS1saW5lY2FwPSdyb3VuZCcgc3Ryb2tlLWxpbmVqb2luPSdyb3VuZCc%2BPHBhdGggZD0nTTkgMnY2TDQgMTlhMiAyIDAgMCAwIDEuOCAzaDEyLjRhMiAyIDAgMCAwIDEuOC0zTDE1IDhWMicvPjxwYXRoIGQ9J004IDJoOCcvPjxwYXRoIGQ9J003IDE1aDEwJy8%2BPC9zdmc%2B&logoColor=white">
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
<img alt="Tailscale: acesso de qualquer lugar" src="https://img.shields.io/badge/Tailscale-acesso%20de%20qualquer%20lugar-242424?style=flat&logo=tailscale&logoColor=white">
<img alt="WinForms: bandeja" src="https://img.shields.io/badge/WinForms-bandeja%20do%20Windows-512BD4?style=flat&logo=dotnet&logoColor=white">

**As vendas do dia na tela, atualizadas a cada venda · No computador e no celular · Na loja ou de qualquer lugar · Nunca escreve no banco · Funciona sem internet**

[Instalar](#instalacao) · [Usar](#uso) · [Recursos](#recursos) · [Celular](#celular) · [Fora da loja](#fora) · [Liberar para outra pessoa](#compartilhar) · [Aparelhos](#aparelhos) · [Configurar](#configuracao) · [API](#api) · [Problemas](#problemas)

</div>

---

## O que é

Um servidor Node.js que **lê** o banco do Small Commerce (`SMALL.FDB`) e publica, na rede da loja, um painel web com as vendas do dia — **Gerencial, NFC-e e NF-e** — por vendedor, forma de pagamento e item. A tela se atualiza sozinha em menos de um segundo a cada venda, cancelamento ou autorização da SEFAZ.

Roda em segundo plano no Windows, com ícone na bandeja: inicia com o logon, se recupera sozinho de quedas e abre em qualquer computador ou celular da loja pelo navegador.

| | |
|---|---|
| ⚡ **Tempo real** | Venda nova aparece em ~0,3 s, sem apertar nada — com ou sem recarregar a página |
| 📱 **Computador e celular** | Layout próprio para cada tela; abre no celular por QR code |
| 🌍 **De qualquer lugar** | Pelo Tailscale (grátis): 4G ou outro Wi-Fi, sem abrir porta no roteador e sem expor nada na internet |
| 👤 **Cada aparelho do seu jeito** | Avisos, proibidos, teclas, apelido e opções de tela por aparelho — só o computador do servidor muda para todos |
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
| Abrir fora da loja (4G, outro Wi-Fi) | **Celular → Fora da loja** (com o Tailscale — veja [Fora da loja](#fora)) |
| Liberar o acesso para outra pessoa | Painel do Tailscale → computador da loja → **⋯ → Share…** (veja [Liberar para outra pessoa](#compartilhar)) |
| Ver uma data | `gerar_relatorio_por_data.bat` (aceita `D/M`, `DD/MM` ou `DD/MM/AA[AA]`) |
| Ver um período | Botão **Por período** · `gerar_relatorio_intervalo.bat` · `http://IP:7734/periodo` |
| Forçar atualização | Botão **Atualizar** · bandeja → *Atualizar dados de hoje* |
| Mudar o tema de cores | Botão **Tema** |
| Visualização, desempenho, recarregar ou não, tamanho do texto | **Configurações → Nesta tela** (vale na hora, só neste aparelho) |
| Dar um nome ao aparelho, mudar avisos/proibidos/teclas só dele | **Configurações → Minhas preferências** (veja [Aparelhos](#aparelhos)) |
| Trocar o banco | Bandeja → *Configurações → Selecionar banco (FDB)* · `http://IP:7734/selecionar-fdb` |
| Configurar | Botão **Configurações** · `http://IP:7734/config` |
| Ver quem está conectado / editar um aparelho | Bandeja → *Dispositivos conectados* (*Configurações do aparelho...*, *Voltar ao padrão*) |
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
- **Menu Tema** só com os temas; as demais opções da tela ficam em **Configurações → Nesta tela**:
  - **Visualização:** *Simplificada* (só a tabela) ou *Detalhada* (com o painel de gráficos).
  - **Desempenho:** *Completo* (animações de entrada e saída em tudo) ou *Leve* (sem animações, para máquinas fracas); o *Automático* detecta sozinho.
  - **Atualização:** *Recarregar relatório ao detectar mudanças*. Ligado, a página recarrega a cada venda. Desligado, a venda nova entra **sem recarregar** — filtros, busca, rolagem e janelas abertas ficam como estão.
  - **Tamanho do texto** de 80% a 140%, no computador e no celular (salvos separados).
- **Busca avançada** com coringas (veja [abaixo](#busca)), **filtro de proibidos**, **chip de desconto** nos itens, **ferramentas de cópia** e **teclas de atalho** personalizáveis.
- **Recarregamento sem piscar:** quando a página recarrega, ela volta no mesmo ponto da lista e com os mesmos filtros.
- **Celular:** botão **voltar ao topo** depois de descer bastante; modo detalhado com a lista indo até o fim da tela no computador.

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
- **Quem está conectado:** cada celular ou computador que abre o relatório aparece no log (`[CONEXAO]`) e na janela *Dispositivos conectados* da bandeja — tipo, modelo, sistema, navegador, IP, **nome do aparelho** (e o apelido, se tiver), preferências e rotas acessadas.
- **Fora da loja** e **preferências por aparelho**: veja [Acesso fora da loja](#fora) e [Preferências de cada aparelho](#aparelhos).

<details>
<summary><b>Como o nome do aparelho é descoberto</b></summary>

O navegador não envia o nome de "Ajustes → Geral → Sobre"; o servidor pergunta ao próprio aparelho pela rede: **Bonjour/mDNS** (iPhone, iPad, Mac e muitos Android — no iPhone o nome vem do nome em "Sobre", ex.: "iPhone do Caixa" → `iPhone-do-Caixa`), **NetBIOS** (computadores Windows) e, como reserva, o **DNS do roteador**. Sem resposta (rede de visitantes, roteador que bloqueia Bonjour), aparece "não informado pelo aparelho".

```
[CONEXAO] Novo dispositivo conectado: Celular iPhone (iOS 17.5, Safari 17.5) | IP 192.168.1.50 | nome: iPhone-do-Caixa (Bonjour)
[CONEXAO] Acesso: GET / ← iPhone-do-Caixa (192.168.1.50) → 200 (3 ms)
[API]     API: GET /api/itens-venda?data=2026-10-23&numero=064759 ← iPhone-do-Caixa (192.168.1.50) → 200 (41 ms)
[CONEXAO] Atividade de iPhone-do-Caixa nos últimos 10 min — chamadas automáticas: /api/status ×1200, recarregamentos automáticos ×4
[CONEXAO] Dispositivo saiu: iPhone-do-Caixa (192.168.1.50) — conectado das 16:20 às 16:49 (30 min) | rotas: / ×5, /api/itens-venda ×2
```

</details>

---

<a id="fora"></a>
## 🌍 Acesso fora da loja (Tailscale)

Para abrir o relatório no 4G ou em outro Wi-Fi, use o **Tailscale** (gratuito). Ele cria uma rede **privada e criptografada** só entre os seus aparelhos: não abre porta no roteador e o relatório não fica exposto na internet. Só os seus aparelhos e quem você liberar acessam.

1. **No computador do servidor:** instale o Tailscale (<https://tailscale.com/download>) e entre com uma conta (Google, Microsoft ou Apple). No ícone dele, ative **Preferences → Run unattended**. No painel <https://login.tailscale.com/admin/machines>, em **⋯ → Disable key expiry** no computador da loja, para ele não se desconectar sozinho depois de 180 dias.
2. **No celular:** instale o app **Tailscale**, entre com a **mesma conta**, permita a configuração de VPN e deixe-o ligado (no iPhone dá para ativar "VPN On Demand").
3. **No relatório:** **Celular → aba "Fora da loja"** (ou bandeja → *Abrir no celular*) e escaneie o QR code. O endereço usa o **nome** da máquina no Tailscale, ex.: `http://pc-loja.tailxxxx.ts.net:7734/` (o IP `http://100.x.y.z:7734/` também funciona).

> **O endereço muda?** Não. O nome (MagicDNS) é **fixo**: é o nome da máquina + o nome da sua rede no Tailscale, e só muda se alguém renomear um dos dois no painel, ou se a máquina for removida e adicionada de novo. O IP `100.x` também é fixo nessas mesmas condições. Pode salvar nos favoritos ou na tela de início do celular. Se o nome não aparecer, ative o **MagicDNS** em <https://login.tailscale.com/admin/dns> (vem ligado por padrão nas contas novas).

Não precisa reiniciar o servidor nem mexer no roteador: o sistema detecta o Tailscale sozinho, e a regra de firewall do instalador já vale para essa rede.

<a id="compartilhar"></a>
### 🤝 Liberar o acesso para outra pessoa (sem passar o seu e-mail)

Use o **compartilhamento de máquina** do Tailscale: a pessoa entra com a conta **dela** e você libera **só o computador da loja**. Ela não entra na sua conta, não vê seus outros aparelhos e você pode tirar o acesso quando quiser.

1. **A outra pessoa, no celular dela:** instala o app **Tailscale** e entra com a conta **dela** (Google, Microsoft, Apple ou e-mail).
2. **Você, no painel** <https://login.tailscale.com/admin/machines> (com a sua conta): no **computador da loja**, clique em **⋯ → Share…** e escolha **Copy share link** (ou convide pelo e-mail dela). Mande o link para ela.
3. **Ela abre o link** no celular, já logada na conta dela, e toca em **Accept** — o computador da loja aparece no app dela.
4. **Ela acessa** pelo mesmo endereço: `http://pc-loja.tailxxxx.ts.net:7734` (ou pelo IP `http://100.x.y.z:7734`, se o nome não abrir no aparelho dela).

- **Tirar o acesso:** no mesmo **⋯ → Share…**, remova o compartilhamento — para na hora.
- No relatório, ela é um aparelho como os outros: tem as próprias preferências e apelido, aparece em *Dispositivos conectados* e **não** muda configurações do sistema, banco nem ícone.
- O compartilhamento libera o computador inteiro para o aparelho dela (não só o relatório). O instalador do relatório só abre a porta 7734 no firewall do Windows; se você usa compartilhamento de pastas ou acesso remoto nesse computador, confira se eles não ficam liberados para a rede do Tailscale.
- **Não use** "Invite users" (<https://login.tailscale.com/admin/users>) para isso: o convidado entra na **sua** rede e pode ver todos os seus aparelhos.

> ⚠️ Túneis públicos (cloudflared, ngrok) deixam o endereço aberto na internet e não são recomendados. Se usar um, quem chega por ele é tratado como aparelho externo: não muda configurações do sistema, não troca o banco nem o ícone, não reinicia o servidor.

---

<a id="aparelhos"></a>
## 👤 Preferências de cada aparelho

Cada celular ou computador tem as **suas** preferências. Quando um muda, os outros não são afetados:

| Onde | O quê |
|---|---|
| **Configurações → Nesta tela** | Visualização, desempenho, recarregar ou não ao detectar mudanças, tamanho do texto (salvas no próprio navegador) |
| **Configurações → Minhas preferências** | **Nome deste aparelho** (apelido, ex.: "Celular do Caixa 1" — o nome real não muda), duração dos avisos, termos proibidos (com **Importar do servidor** / **Juntar com os do servidor**) e teclas de atalho |

- Só vai o que foi mexido: o resto continua seguindo o **padrão do servidor**. "Voltar ao padrão do servidor" desfaz (o apelido fica).
- O **computador do servidor** (onde estão o launcher e o `servidor-relatorio.js`) é o único que muda o padrão de todos, as configurações do sistema (nome, intervalo, log, janela de correção, ícone) e o banco. Ele também pode **aplicar o padrão a todos os aparelhos** e editar ou restaurar um aparelho conectado — pelo próprio modal ou pela bandeja (*Dispositivos conectados → Configurações do aparelho...* / *Voltar ao padrão*).
- O apelido aparece no log (`"Celular do Caixa 1" — iphone-xr (100.103.59.92)`), na janela *Dispositivos conectados* e na lista de aparelhos.
- Ficam em `preferencias-aparelhos.json`, na pasta do sistema — **nunca no banco**. Cada aparelho é reconhecido por um cookie com um código aleatório (`fdb_ap`); apagar os dados do navegador faz o aparelho voltar ao padrão.

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
| `vendedor:` `item:` `caixa:` `numero:` `cliente:` `hora:` `pag:` `nat:` `tipo:` | Por campo | `vend:FULANO`, `tipo:nfce` |

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
| `toastDuration` | `5000` | Duração dos avisos na tela (ms) — padrão; cada aparelho pode ter a sua |
| `janelaCorrecaoHoraMin` | `180` | Janela da correção de horário, de 5 a 720 min ([detalhes](#horario)) |
| `maxLogLines` / `logDebug` | `5000` / `false` | Tamanho do `relatorio.log` / detalhes de rotina |
| `favicon` | `""` | Ícone personalizado (arquivo da pasta do sistema) |
| `proibidos` | `[]` | Termos do filtro de proibidos — padrão; cada aparelho pode ter a sua lista |
| `teclasPersonalizadas` | `[]` | Atalhos: `{ "tecla": "F2", "comando": "[-proibidos]>150", "acao": "" }` — padrão; cada aparelho pode ter os seus |
| `programas` | `[]` | Programas que a bandeja e o `api.ps1` podem abrir: `{ "nome": "Small Commerce", "caminho": "C:\\Small\\Small.exe", "args": "" }` (só editável neste arquivo) |

> `hora-fixada-cache.json`, `preferencias-aparelhos.json`, `relatorio.log` e `favicon.png` são criados e mantidos pelo próprio sistema (nenhum deles vai para o banco).

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
- Reinício remoto, leitura do log, lista de dispositivos e abertura de programas **só da rede local** (inclui a rede privada do Tailscale). Programas: pela rede só se escolhe **um nome** da lista do `config.json` — nunca caminho ou comando livre.
- Configurações do sistema, troca do banco e do ícone **só do computador do servidor**; os outros aparelhos mudam só as próprias preferências.
- Pedido que chega por **túnel ou proxy** nesta máquina (`X-Forwarded-For`, `CF-Connecting-IP` etc.) nunca é tratado como o computador do servidor nem como rede local.
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
| `/qr` · `/qr.svg` · `/api/qr` | GET | QR code do endereço desta máquina na rede (página, imagem, texto); `/qr.svg?externo=1` e os campos `externo`/`externoNome`/`externoIP` de `/api/qr` = endereço do Tailscale (com o nome MagicDNS, fixo) |
| `/pronto?k=CHAVE` | GET | Estado de uma geração em andamento |
| `/api/status` | GET | Quantidade e total do dia, por tipo, e avisos de correção |
| `/api/db-status` | GET | Estado da conexão com o banco |
| `/api/events` | GET | Fluxo SSE (tempo real) |
| `/api/config` · `/api/proibidos` | GET/POST | Lê e salva configurações / lista de proibidos. De outro aparelho: só as preferências dele. Do computador do servidor: o padrão (`aplicarTodos`), ou um aparelho com `?aparelho=CHAVE` (`restaurar`, `apelido`) |
| `/api/preferencias` | GET | Preferências efetivas de quem pede (as do aparelho por cima do padrão) |
| `/api/proibidos-servidor` | GET | Lista padrão de proibidos do servidor (para "Importar do servidor") |
| `/api/salvar-fdb` | POST | (Só no computador do servidor) define o banco: `{ "caminho": "C:\\...\\SMALL.FDB" }` ou `"IP:C:\\...\\SMALL.FDB"` |
| `/api/abrir-picker-fdb` | GET | Abre o seletor de arquivos do Windows na máquina servidora |
| `/api/upload-favicon` | POST | (Só no computador do servidor) envia um ícone PNG/ICO/JPEG (até 2 MB) |
| `/api/navigate/hoje` · `/config` · `/selecionar-fdb` · `/periodo/INI/FIM` · `/hash/{config\|periodo}` · `/foco` · `/recarregar` | GET | Comandam as telas abertas via SSE |
| `/api/navigate/tema/ID` · `/api/temas` | GET | Troca o tema das telas abertas / lista os temas |
| `/api/navigate/aviso` | POST | Aviso nas telas abertas: `{ "msg": "texto", "segundos": 12 }` |
| `/api/sse-clients` | GET | Número de telas conectadas |
| `/api/info` | GET | Versões, máquina, banco, memória e tempo ligado |
| `/api/log?linhas=N&filtro=texto` | GET | Últimas linhas do `relatorio.log` (rede local) |
| `/api/dispositivos` | GET | Aparelhos com o relatório aberto: nome, apelido, IP, tipo, rotas; para o computador do servidor, também a chave e as preferências próprias (rede local) |
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
| `[CONFIG]` · `[REDE]` | Configurações, ícone e preferências de cada aparelho · IP da máquina |
| `[TRAY]` · `[INSTALL]` · `[REMOVER]` | Bandeja, instalador e removedor |
| `[DEBUG]` · `[SISTEMA]` | Detalhes (com `"logDebug": true`) · demais mensagens |

```
[07-10-2026] [08:00:01] [SERVIDOR] === Servidor iniciado 07/10/2026 === Servidor v2.23.0 | Gerador v3.27.0
[07-10-2026] [08:00:06] [BANCO] Índices: NFCE.DATA, PAGAMENT.DATA — ok (consultas rápidas).
[07-10-2026] [12:43:31] [VENDAS] FastPoll: Gerencial: vendas 30 → 31 (↑ +1) ... → regerando.
```

---

## 🧰 Tecnologias e bibliotecas

Uma única biblioteca externa — o resto é do próprio Node.js, do Windows ou feito aqui mesmo (por isso funciona sem internet).

| Parte | Tecnologia | Para quê |
|---|---|---|
| Servidor e gerador | **Node.js 18+** (módulos nativos `http`, `child_process`, `fs`, `crypto`, `dns`, `dgram`, `net`, `os`) | Servidor HTTP/SSE, geração em subprocesso, cookie dos aparelhos, nome dos aparelhos (mDNS/NetBIOS/DNS), detecção do banco na rede |
| Banco | **[node-firebird](https://www.npmjs.com/package/node-firebird)** — única dependência externa, instalada sozinha | Leitura do Firebird do Small Commerce, só em transações somente leitura |
| Tela do relatório | **HTML5, CSS e JavaScript** puros (sem framework) | Interface, temas, busca, painel detalhado, atualização sem recarregar |
| Tempo real | **SSE** (Server-Sent Events) + polling HTTP de reserva | Aviso de venda nova em menos de um segundo |
| Gráficos e ícones | **SVG** gerado pelo próprio sistema; ícones no estilo **Lucide** embutidos | Painel detalhado, botões e menu da bandeja |
| QR code | **Gerador próprio** (ISO/IEC 18004, correção M) | QR do endereço na loja e fora dela |
| Bandeja do Windows | **PowerShell 5.1** + **WinForms/.NET** (com trechos em C#) e **VBScript** | Ícone, menu, watchdog, janela *Dispositivos conectados*, inicialização automática |
| Acesso de fora (opcional) | **[Tailscale](https://tailscale.com)** (app externo, grátis) | Rede privada entre a loja e os celulares — nada fica exposto na internet |
| Testes | **`node:test`** (nativo) + Firebird simulado em `test/mock-firebird` | `npm test`, sem precisar de banco real |

---

## 🧪 Testes

Rodam **sem Firebird real** — um banco simulado em `test/mock-firebird` responde às consultas.

```bash
npm test
```

No Windows: duplo clique em **`test\executar-testes.bat`**. Os 28 testes cobrem a garantia de **somente leitura**, a atualização numa rajada de vendas, XSS, o cache de horas, o painel de duplicatas, a correção de horário, os dispositivos conectados, o controle remoto, a validação das rotas, as **preferências por aparelho** (isolamento, apelido, edição pelo servidor, aplicar a todos) e a proteção contra **túnel/proxy**. Alguns testes de horário são pulados de propósito logo depois da meia-noite.

---

## 🗂️ Como é organizado

```
 Windows (logon)
   └─ Tarefa agendada ─▶ bootstrap.vbs ─▶ launcher.vbs ─▶ iniciar-tray.ps1   (bandeja + watchdog)
                                                            └─▶ node servidor-relatorio.js
                                                                  ├─ fast-poll ──────┐
                                                                  ├─ verificação     ├─▶ Firebird (SMALL.FDB) — SOMENTE LEITURA
                                                                  └─ node gerar-relatorio-html.js ─┘
 Navegador (computador ou celular da rede ou via Tailscale) ◀── HTTP :7734 + SSE
```

<details>
<summary><b>Arquivos do projeto</b></summary>

| Arquivo | Função |
|---|---|
| `servidor-relatorio.js` | Servidor HTTP/SSE: detecta o banco, monitora mudanças, cache, gerações, dispositivos, preferências por aparelho, Tailscale e QR code |
| `gerar-relatorio-html.js` | Subprocesso que consulta o Firebird e monta o relatório (dados, interface e scripts, inclusive a atualização sem recarregar) |
| `iniciar-tray.ps1` | Ícone na bandeja, menu, watchdog e janela *Dispositivos conectados* |
| `launcher.vbs` / `bootstrap.vbs` | Iniciam a bandeja de forma oculta (o bootstrap espera a pasta de rede no logon) |
| `instalar-na-inicializacao.bat` · `_criar-tarefa.ps1` | Inicialização automática, firewall e nome do sistema |
| `remover-inicializacao.bat` · `_remover-inicializacao.ps1` | Desfazem a inicialização automática |
| `gerar_relatorio_do_dia.bat` · `_por_data.bat` · `_intervalo.bat` | Abrem o relatório (iniciam o servidor se preciso) |
| `api.ps1` | Cliente de linha de comando da API |
| `_instalar-node.ps1` · `node-firebird.bat` | Instalam o Node.js e o `node-firebird` |
| `config.json` | Configurações (padrão de todos) |
| `preferencias-aparelhos.json` | Preferências e apelido de cada aparelho (criado sozinho, não versionado) |
| `package.json` · `test/` | Testes automáticos (`npm test`, `executar-testes.bat`, Firebird simulado) |
| `CHANGELOG.md` | Histórico completo de versões de cada arquivo (o cabeçalho de cada arquivo traz só a versão atual) |
| `CLAUDE.md` | Regras do projeto para o assistente de código (idioma, somente leitura, changelog, README sempre atualizado) |

</details>

---

<a id="problemas"></a>
## 🩺 Solução de problemas

| Sintoma | O que fazer |
|---|---|
| "Banco de dados não encontrado" | Escolha o `SMALL.FDB` na página ou pela bandeja; confira se o Firebird está rodando (porta 3050) |
| "Falha ao conectar" / senha incorreta | Ajuste `fbUser` e `fbPass` no `config.json` e reinicie pela bandeja |
| Outro computador ou celular não abre | Mesmo Wi-Fi/rede? Porta 7734 no firewall (rode o instalador como administrador); confira o IP em *Ferramentas → Informações* |
| Celular não abre fora da loja | App Tailscale ligado e na mesma conta? No computador, o Tailscale está conectado ("Run unattended")? Use o QR da aba *Fora da loja*. O nome não abre? Tente o IP mostrado logo abaixo e confira se o MagicDNS está ligado no painel |
| Um aparelho mostra avisos/proibidos diferentes dos outros | Ele tem preferências próprias: *Minhas preferências → Voltar ao padrão do servidor*, ou bandeja → *Dispositivos conectados → Voltar ao padrão* |
| Quero que a página não recarregue | *Configurações → Nesta tela → Atualização*: desligue "Recarregar relatório ao detectar mudanças" (as vendas continuam entrando) |
| Relatório de período longo não termina | Aumente `spawnTimeoutMs` (até 600000) |
| Instalação nova: "Node.js não foi instalado corretamente" na 1ª vez | Corrigido no instalador 1.14.1 (espera o Node terminar e relê o PATH). Se ainda acontecer, rode o instalador de novo |
| Servidor não inicia no logon | Rode `instalar-na-inicializacao.bat` de novo e veja as linhas `[INSTALL]` e `[TRAY]` no log |
| Continua iniciando sozinho após remover | Rode `remover-inicializacao.bat` como administrador e veja as linhas `[REMOVER]` |
| Instalador: "falha ao criar o bootstrap" / antivírus acusa o `bootstrap.vbs` | Falso positivo. Em *Segurança do Windows → Proteção contra vírus e ameaças → Histórico de proteção*, escolha *Permitir no dispositivo* e rode o instalador de novo |
| Qualquer outro problema | O `relatorio.log` registra erros, avisos e a versão em uso |

---

<div align="center">

**Desenvolvido por Ruda Gabriel** — concepção, regras de negócio e manutenção.

© 2026 Ruda Gabriel. Todos os direitos reservados.

</div>
