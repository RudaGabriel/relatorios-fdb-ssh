(function() {
    const Firebird = require("node-firebird");
    const fs = require("node:fs");
    const process = require("node:process");
    const args = process.argv.slice(2);
    const pegar = k => {
        const i = args.indexOf(k);
        return i >= 0 && i + 1 < args.length ? String(args[i + 1] || "").trim() : "";
    };
    const fdbRaw = pegar("--fdb");
    const dataSingular = pegar("--data");
    const dataInicioRaw = dataSingular || pegar("--data-inicio");
    const dataFimRaw = dataSingular || pegar("--data-fim");

    const parseISO = (s) => {
        const str = String(s || "").trim();
        let m;
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
        m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (m) return `${m[3]}-${m[2]}-${m[1]}`;
        return str;
    };

    const dataInicioISO = parseISO(dataInicioRaw);
    const dataFimISO = parseISO(dataFimRaw);

    const saida = pegar("--saida");
    const usuario = pegar("--user") || "SYSDBA";
    const senha = pegar("--pass") || "masterkey";

    if (!fdbRaw || !dataInicioISO || !dataFimISO || !saida) {
        console.log("Uso:\nnode gerar-relatorio-html.js --fdb 192.168.1.100:C:\\Banco.fdb --data 2026-03-01 --saida out.html");
        process.exit(1);
    }

    // === LÊ CONFIG (proibidos + appName) ===
    const pathConfig = require("node:path").join(__dirname, "config.json");
    let cfgProibidos    = [];
    let cfgAppName      = "";
    let cfgToastDuracao = 5000;
    try {
        const rawCfg = fs.readFileSync(pathConfig, "utf8").replace(/^\uFEFF/, "");
        const c = JSON.parse(rawCfg);
        if (Array.isArray(c.proibidos))            cfgProibidos    = c.proibidos;
        if (c.appName && String(c.appName).trim()) cfgAppName      = String(c.appName).trim();
        if (c.toastDuration && parseInt(c.toastDuration,10) >= 500) cfgToastDuracao = parseInt(c.toastDuration,10);
    } catch(e) {}

    // === LÓGICA DE IDENTIFICAÇÃO DE REDE DO FIREBIRD ===
    let host = "127.0.0.1";
    let dbPath = fdbRaw;
    const matchIP = fdbRaw.match(/^([0-9\.]+|[a-zA-Z0-9_-]+):([a-zA-Z]:\\.*|\/.*)/);
    if (matchIP) {
        host = matchIP[1];
        dbPath = matchIP[2];
    }

    const escHtml = s => String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    const decoder = new TextDecoder("windows-1252");

    // Converte campo de data do Firebird (pode chegar como Date JS ou string) para ISO YYYY-MM-DD.
    // node-firebird retorna campos DATE como objetos Date cujo .toString() é "Wed Apr 08 2026…",
    // quebrando o teste /^\d{4}-\d{2}-\d{2}$/. Usando getUTC* evitamos shift de fuso horário.
    const toISO = (val) => {
        if (!val) return "";
        if (val instanceof Date) {
            const p = n => String(n).padStart(2, "0");
            return `${val.getUTCFullYear()}-${p(val.getUTCMonth()+1)}-${p(val.getUTCDate())}`;
        }
        const s = String(val).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;                     // já ISO
        if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.substring(0, 10);    // ISO com hora
        const d = new Date(s);                                             // fallback: parsear
        if (!isNaN(d.getTime())) {
            const p = n => String(n).padStart(2, "0");
            return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())}`;
        }
        return s.substring(0, 10);
    };

    // Escalona timeouts conforme o intervalo solicitado — períodos grandes (ex: 1/4–15/4)
    // precisam de muito mais tempo para ALTERACA/PAGAMENT/ITENS001 com centenas de registros.
    // Fórmula: 60s por dia (global) / 45s por dia (query), mínimo 90s/80s, máximo 15min/10min.
    const _diasIntervalo = Math.max(1, Math.round(
        (new Date(dataFimISO).getTime() - new Date(dataInicioISO).getTime()) / 86400000
    ) + 1);
    const _tGlobal = Math.min(Math.max(90000, _diasIntervalo * 60000), 900000);
    const _tQuery  = Math.min(Math.max(80000, _diasIntervalo * 45000), 600000);

    // Timeout global
    const _globalTimeout = setTimeout(() => {
        const minutos = Math.round(_tGlobal / 60000);
        console.log(`\nERRO: Tempo limite excedido (${minutos} min). O banco de dados nao respondeu.`);
        console.log("Verifique se o Firebird esta rodando em " + host + ":3050 e se o arquivo FDB existe:");
        console.log("  " + dbPath);
        process.exit(1);
    }, _tGlobal);
    _globalTimeout.unref(); // nao impede o processo de terminar normalmente se tudo der certo

	// Usa transação explícita com ISOLATION_READ_UNCOMMITTED (rec_version + read + nowait)
	// para garantir que o relatório NUNCA fique esperando transações abertas do PDV,
	// independentemente da versão do node-firebird instalada.
	// db.query() herda o isolation do opts e em algumas versões usa write+wait, travando.
	// Aceita timeoutMs opcional — usado para escalonar por intervalo de datas.
	const query = (db, sql, params, timeoutMs) => new Promise((resolve, reject) => {
		const _qt = setTimeout(() => {
			const seg = Math.round((timeoutMs || _tQuery) / 1000);
			reject(new Error(`Timeout na query apos ${seg}s. Conexao pode estar travada.`));
		}, timeoutMs || _tQuery);
		db.transaction(Firebird.ISOLATION_READ_UNCOMMITTED, (errTx, tx) => {
			if (errTx) {
				clearTimeout(_qt);
				return resolve({ e: errTx, rows: [] });
			}
			tx.query(sql, params || [], (e, rows) => {
				clearTimeout(_qt);
				tx.rollback(() => {}); // leitura pura: rollback libera sem overhead de commit
				if (rows) {
					for (let i = 0; i < rows.length; i++) {
						for (const key in rows[i]) {
							if (Buffer.isBuffer(rows[i][key])) {
								rows[i][key] = decoder.decode(rows[i][key]);
							}
						}
					}
				}
				resolve({ e, rows: rows || [] });
			});
		});
	});
	
	const parseBR = (iso, raw) => {
		let m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
		if (m) return `${m[3]}/${m[2]}/${m[1]}`;
		m = String(raw || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
		if (m) return `${m[1]}/${m[2]}/${m[3]}`;
		return String(raw || iso || "");
	};
	
	const dataInicioBR = parseBR(dataInicioISO, dataInicioRaw);
	const dataFimBR = parseBR(dataFimISO, dataFimRaw);
	const dataBR = dataInicioISO === dataFimISO ? dataInicioBR : `${dataInicioBR} até ${dataFimBR}`;

	const horaGeradaBR = (() => {
		const d = new Date();
		const p = n => String(n).padStart(2, "0");
		return `${p(d.getHours())}:${p(d.getMinutes())}`;
	})();
	// Data de hoje em YYYY-MM-DD (fuso local) — usada para limitar horas futuras do PDV
	const _hojeISO = (() => {
		const d = new Date();
		const p = n => String(n).padStart(2, "0");
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
	})();
	const diaMesGeradaBR = (() => {
		const d = new Date();
		const p = n => String(n).padStart(2, "0");
		return `${p(d.getDate())}/${p(d.getMonth() + 1)}`;
	})();
	const ano2 = String(new Date().getFullYear()).slice(-2);

	// ── CACHE DE HORAS FIXADAS ─────────────────────────────────────────────────
	// Quando uma venda de hoje tem hora futura (relógio do PDV adiantado), capamos
	// à hora atual. O problema: a cada atualização do relatório a hora avança,
	// fazendo a venda flutuar para o topo da lista. Para evitar isso, persistimos
	// a PRIMEIRA hora capada em um arquivo JSON — todas as execuções seguintes
	// reutilizam essa hora fixada, mantendo a venda em posição estável.
	// Entradas de dias anteriores são descartadas automaticamente na gravação.
	const _horaCacheFile = require("node:path").join(__dirname, "hora-fixada-cache.json");
	let _horaCache = {};
	try {
		const _rawHC = fs.readFileSync(_horaCacheFile, "utf8").replace(/^\uFEFF/, "");
		const _parsedHC = JSON.parse(_rawHC);
		// Mantém somente entradas de hoje — purga dias anteriores
		if (_parsedHC && typeof _parsedHC === "object") {
			for (const [k, val] of Object.entries(_parsedHC)) {
				if (typeof k === "string" && k.startsWith(_hojeISO + "|") && typeof val === "string") {
					_horaCache[k] = val;
				}
			}
		}
	} catch(e) { /* arquivo ausente ou corrompido: começa vazio */ }
	let _horaCacheDirty = false;
	// ──────────────────────────────────────────────────────────────────────────

	const rodar = async () => {
		const opts = {
			host: host,
			port: 3050,
			database: dbPath,
			user: usuario,
			password: senha,
			role: null,
			pageSize: 4096,
			charset: "UTF8",
			// READ COMMITTED: lê dados confirmados no momento da query, sem
			// montar snapshot — essencial para não travar ao consultar dados
			// do dia atual enquanto o PDV está gravando ativamente.
			isolation: Firebird.ISOLATION_READ_COMMITTED
		};
		

			// ── runConn: abre conexão Firebird, executa asyncFn, fecha. ─────────────────
			// Nunca rejeita: resolve com { e, rows:[] } em qualquer erro — erros críticos
			// checados após Promise.all. Timeout de 10s no attach previne que uma conexão
			// travada segure o Promise.all indefinidamente (ex: banco reiniciando).
			const runConn = asyncFn => new Promise(resolve => {
				let _settled = false;
				const _settle = r => { if (!_settled) { _settled = true; resolve(r); } };
				const _attachWd = setTimeout(() => {
					_settle({ e: new Error("runConn attach timeout 10s"), rows: [] });
				}, 10000);
				try {
					Firebird.attach(opts, async (e2, db2) => {
						clearTimeout(_attachWd);
						if (e2) { _settle({ e: e2, rows: [] }); return; }
						try {
							const r = await asyncFn(db2);
							try { db2.detach(); } catch (_) {}
							_settle(r);
						} catch (eRun) {
							try { db2.detach(); } catch (_) {}
							_settle({ e: eRun, rows: [] });
						}
					});
				} catch(syncErr) {
					clearTimeout(_attachWd);
					_settle({ e: syncErr, rows: [] });
				}
			});

		console.log(`Conectando em: Host: ${host} | Banco: ${dbPath}`);

		Firebird.attach(opts, async function(err, db) {
			if (err) {
				clearTimeout(_globalTimeout);
				console.log("Falha ao conectar: " + String(err.message || err));
				console.log("Verifique se o Firebird esta rodando em " + host + ":3050");
				process.exit(1);
			}
			console.log("Conectado! Executando consultas...");
			const _t0 = Date.now();
			const tick = label => console.log(`  >> ${label}: ${Date.now() - _t0}ms acumulado`);
			process.on("unhandledRejection", (reason) => {
				clearTimeout(_globalTimeout);
				console.log("\nERRO inesperado: " + String((reason && reason.message) || reason));
				try { db.detach(); } catch(_) {}
				process.exit(1);
			});
			const camposCache = new Map();
			const camposTabela = async nome => {
				const n = String(nome || "").trim().toUpperCase();
				if (camposCache.has(n)) return camposCache.get(n);
				const rr = await query(db, "select trim(rf.rdb$field_name) as C from rdb$relation_fields rf where trim(rf.rdb$relation_name)=?", [n]);
				const set = new Set();
				if (!rr.e && rr.rows)
					for (const r of rr.rows) {
						const c = String(r.C ?? "").trim().toUpperCase();
						if (c) set.add(c);
					}
				camposCache.set(n, set);
				return set;
			};
			const camposNfce = await camposTabela("NFCE");
			const validCols = ["NUMERONF", "CONTROLE", "GERENCIAL", "PEDIDO"].filter(c => camposNfce.has(c));
			const colsSelect = validCols.length > 0 ? ", " + validCols.map(c => `cast(n.${c} as varchar(30)) as VAL_${c}`).join(", ") : "";
			const campoVendedorNfce = camposNfce.has("VENDEDOR") ? "cast(n.VENDEDOR as varchar(60))" : "cast(null as varchar(60))";
			const campoCaixa = camposNfce.has("CAIXA") ? "CAIXA" : (camposNfce.has("NUMCAIXA") ? "NUMCAIXA" : "null");
			const selCaixa = campoCaixa !== "null" ? `cast(n.${campoCaixa} as varchar(20))` : `cast('' as varchar(20))`;

			const campoCancelado = camposNfce.has("CANCELADO") ? "cast(n.CANCELADO as varchar(1))" : "'N'";
			const campoSituacao  = camposNfce.has("SITUACAO")  ? "cast(n.SITUACAO as varchar(1))"  : "''";
			const campoEmissao   = camposNfce.has("EMISSAO")   ? "cast(n.EMISSAO as varchar(1))"   : "''";

			let colHoraReal = Array.from(camposNfce).find(c => c.includes("HORA") || c === "HR");
			const campoHora = colHoraReal
				? `cast(n.${colHoraReal} as varchar(8))`
				: `substring(cast(n.data as varchar(24)) from 12 for 5)`;

			// Campo nome do cliente (NF-e) — tenta nomes comuns
			const _clienteCandidatos = ["NOMECLIENTE","CLIENTE","NOME_CLIENTE","NOMECLI","RAZAOSOCIAL","RAZAO_SOCIAL","NOMEDESTINATARIO"];
			const campoClienteNome = _clienteCandidatos.find(c => camposNfce.has(c)) || null;
			const selClienteNome   = campoClienteNome ? `cast(n.${campoClienteNome} as varchar(80))` : `cast('' as varchar(80))`;

			// Campo natureza da operação (NF-e)
			const _naturezaCandidatos = ["NATUREZA","NATOP","NATUREZA_OP","NAT_OP","NATOPERACAO","NATUREZAOP"];
			const campoNaturezaOp = _naturezaCandidatos.find(c => camposNfce.has(c)) || null;
			const selNaturezaOp   = campoNaturezaOp ? `cast(n.${campoNaturezaOp} as varchar(60))` : `cast('' as varchar(60))`;

			const nfceSql = `
			select
			  n.data as DATA,
			  coalesce(n.modelo, 65) as MODELO,
			  n.total as TOTAL,
			  ${selCaixa} as CAIXA,
			  ${campoVendedorNfce} as VENDEDOR_NFCE,
			  ${campoCancelado} as CANC,
			  ${campoSituacao} as SIT,
			  ${campoEmissao} as EMI,
			  ${campoHora} as HORA,
			  ${selClienteNome} as CLI_NOME,
			  ${selNaturezaOp}  as NAT_OP
			  ${colsSelect}
			from nfce n
			where n.data between cast(? as date) and cast(? as date)
			  and coalesce(n.modelo, 65) in (99, 65, 55)
			`;
			const camposAlt = await camposTabela("ALTERACA");
			const campoVendAlt  = camposAlt.has("VENDEDOR")  ? "cast(VENDEDOR as varchar(60))"  : "cast(null as varchar(60))";
			const campoHoraAlt  = camposAlt.has("HORA")      ? "cast(HORA as varchar(8))"        : "cast('' as varchar(8))";
			// Campo de total por item: preferência TOTAL > PRECO (×QUANTIDADE) > null
			const campoTotalAlt = camposAlt.has("TOTAL")
				? "cast(TOTAL as double precision)"
				: camposAlt.has("PRECO")
					? "cast(PRECO as double precision) * cast(coalesce(QUANTIDADE,1) as double precision)"
					: "cast(null as double precision)";
			// Flag: se não há campo de preço disponível, não tenta somar
			const _temPrecoAlt = camposAlt.has("TOTAL") || camposAlt.has("PRECO");

			const fmtQtd = v => {
				const n = Number(v || 0);
				if (!Number.isFinite(n)) return "0";
				const r = Math.round(n);
				if (Math.abs(n - r) < 1e-9) return String(r);
				let s = String(n);
				if (s.indexOf("e") >= 0 || s.indexOf("E") >= 0) s = n.toFixed(4);
				s = s.replace(/0+$/, "").replace(/\.$/, "");
				return s.replace(".", ",");
			};

			const altSql = `
			select DATA, cast(PEDIDO as varchar(30)) as PED, cast(CAIXA as varchar(10)) as CX,
			       DESCRICAO, QUANTIDADE, ${campoVendAlt} as VENDEDOR_ALT, ${campoHoraAlt} as HORA_ALT,
			       ${campoTotalAlt} as TOTAL_ITEM
			from ALTERACA
			where DATA between cast(? as date) and cast(? as date)
			order by DATA, PEDIDO, ITEM
			`;
			// pagSql UNIFICADO — retorna linhas brutas sem GROUP BY nem list().
			// Uma única varredura da tabela substitui dois queries separados:
			//   (a) forma='00' + valor<0  → _tot00Map (total real do SmallSoft)
			//   (b) demais formas + valor>0 → mapVendas extension (pagamentos reais)
			// Elimina totalSql como conexão paralela separada: menos attach overhead,
			// sem GROUP BY nem list() no Firebird → query mais rápida (~60-75ms vs 112ms).
			// Inclui forma='00' (antes excluída); exclui apenas '13' (Troco).
			const pagSql = `
			select
			  p.data as DATA,
			  cast(p.pedido as varchar(30)) as PEDIDO,
			  p.vendedor as VENDEDOR,
			  cast(p.valor as double precision) as VALOR,
			  substring(trim(p.forma) from 1 for 2) as FORMA_PREF,
			  trim(iif(
			    substring(trim(p.forma) from 1 for 2) between '00' and '99'
			    and substring(trim(p.forma) from 3 for 1) = ' ',
			    trim(substring(trim(p.forma) from 4)),
			    trim(p.forma)
			  )) as FORMA_NOME
			from pagament p
			where p.data between cast(? as date) and cast(? as date)
			  and p.valor is not null
			  and substring(p.forma from 1 for 2) <> '13'
			order by p.data, p.pedido
			`;
			// ── Inicia 2 conexões paralelas ─────────────────────────────────────────────
			// pagSql inclui '00' (tot real) → totalSql removido, de 3 conexões para 2.
			// ALTERACA: schema feito acima (~2ms) → altSql já construído → inicia agora.
			const _pPag = runConn(d2 => query(d2, pagSql, [dataInicioISO, dataFimISO]));
			const _pAlt = runConn(d2 => query(d2, altSql, [dataInicioISO, dataFimISO]));

			tick("inicio queries");
			const rNfce = await query(db, nfceSql, [dataInicioISO, dataFimISO]);
			tick("NFCE pronta");
			if (rNfce.e) {
				db.detach();
				console.log("Erro na consulta NFCE: " + String(rNfce.e.message || rNfce.e));
				process.exit(1);
			}

			const mapVendas = new Map();
			const idIndex   = new Map();

			for (const n of rNfce.rows) {
				if (n.CANC === 'S' || n.CANC === 'T' || n.SIT === 'C' || n.EMI === 'C') continue; 
				const totalNum = Number(n.TOTAL || 0);
				if (totalNum <= 0) continue;

				const ids = [];
				for (const c of validCols) {
					const val = String(n["VAL_" + c] || "").trim().replace(/^0+/, "");
					if (val && !ids.includes(val)) ids.push(val);
				}
				if (ids.length === 0) continue;

				const primaryId = ids[0];
				// toISO() normaliza Date JS e strings para YYYY-MM-DD
				// evita mismatch quando NFCE.data é TIMESTAMP e PAGAMENT.data é DATE
				const dt = toISO(n.DATA);
				const key = dt + "|" + primaryId;

				let caixa = String(n.CAIXA ?? "").trim();
				if (/^\d+$/.test(caixa) && caixa.length > 0 && caixa.length < 3) caixa = caixa.padStart(3, "0");

				mapVendas.set(key, {
					_dtKey: dt,
					vendedor: String(n.VENDEDOR_NFCE || "").trim(),
					modelo: Number(n.MODELO || 65),
					numero: primaryId,
					caixa: caixa,
					hora: String(n.HORA || "").trim(),
					cliente: String(n.CLI_NOME || "").trim(),
					natureza: String(n.NAT_OP || "").trim(),
					total_nfce: totalNum,
					total_pag: 0,
					formas: []
				});

				for (const id of ids) idIndex.set(dt + "|" + id, key);
			}

			// ── VENDAS: NF-e modelo 55 ────────────────────────────────────────
			// Inserido ANTES do PAGAMENT para que idIndex tenha NSU→key
			// quando PAGAMENT tentar linkar (PAGAMENT.PEDIDO = VENDAS.NSU stripped).
			const _vendaNfeKey = new Map();
			try {
				const _camV = await camposTabela("VENDAS");
				if (_camV.size > 0 && _camV.has("NUMERONF") && _camV.has("TOTAL")) {
					const _cVd  = _camV.has("SAIDAD")      ? "cast(v.SAIDAD as date)"           : "cast(v.EMISSAO as date)";
					const _cVv  = _camV.has("VENDEDOR")    ? "cast(v.VENDEDOR as varchar(60))"  : "cast(null as varchar(60))";
					const _cVc  = _camV.has("CLIENTE")     ? "cast(v.CLIENTE as varchar(80))"   : "cast('' as varchar(80))";
					const _cVop = _camV.has("OPERACAO")    ? "cast(v.OPERACAO as varchar(60))"  : "cast('' as varchar(60))";
					const _cVh  = _camV.has("SAIDAH")      ? "cast(v.SAIDAH as varchar(8))"     : "cast('' as varchar(8))";
					const _cVn  = _camV.has("NSU")         ? "cast(v.NSU as varchar(20))"       : "cast(null as varchar(20))";
					const _cVm  = _camV.has("MODELO")      ? "cast(v.MODELO as varchar(5))"     : "'55'";
					const _cVcc = _camV.has("DATA_CANCEL") ? "v.DATA_CANCEL"                    : "cast(null as date)";
					const _rV = await query(db, `
						SELECT ${_cVd}  as DATA_V,
						       cast(v.NUMERONF as varchar(30)) as NF_NUM,
						       v.TOTAL  as TOTAL_V,
						       ${_cVv}  as VEND_V,
						       ${_cVc}  as CLI_V,
						       ${_cVop} as OP_V,
						       ${_cVh}  as HORA_V,
						       ${_cVn}  as NSU_V,
						       ${_cVcc} as CANCEL_V
						FROM VENDAS v
						WHERE ${_cVd} BETWEEN cast(? as date) AND cast(? as date)
						  AND ${_cVm} = '55'
						  AND v.TOTAL > 0
						  AND ${_cVcc} IS NULL
					`, [dataInicioISO, dataFimISO]);
					tick("VENDAS NF-e");
					if (!_rV.e && _rV.rows) {
						for (const vr of _rV.rows) {
							const _vTotal = Number(vr.TOTAL_V || 0);
							if (_vTotal <= 0) continue;
							const _nfRaw = String(vr.NF_NUM || "").trim();
							let _nfExib = _nfRaw;
							if (/^\d{12}$/.test(_nfRaw)) {
								const _n = parseInt(_nfRaw.substring(0, 9), 10);
								_nfExib = isNaN(_n) ? _nfRaw : String(_n).padStart(6, "0");
							} else {
								const _s = _nfRaw.replace(/^0+/, "");
								_nfExib = _s ? _s.padStart(6, "0") : _nfRaw;
							}
							// SAIDAD via cast(…as date) pode retornar objeto Date JS cujo
						// .toString() é "Wed Apr 08 2026…" — usar toISO() garante YYYY-MM-DD.
						const _dtV = toISO(vr.DATA_V);
							if (!_dtV || !/^\d{4}-\d{2}-\d{2}$/.test(_dtV)) continue;
							const _keyV = _dtV + "|" + _nfExib;
							// Chave stripped (sem zeros à esquerda) — usada pelo PAGAMENT e às vezes
							// pela tabela NFCE. Sem este alias PAGAMENT cria linha duplicada de
							// "Recebimento de Título / Conta" para o mesmo cupom NF-e.
							const _nfStripped = _nfRaw.replace(/^0+/, "") || _nfRaw;
							const _keyStripped = _dtV + "|" + _nfStripped;

							// Caso A: NFCE já cadastrou esta NF-e com a chave stripped → mescla
							if (mapVendas.has(_keyStripped)) {
								const _ex = mapVendas.get(_keyStripped);
								if (!_ex.cliente)  _ex.cliente  = String(vr.CLI_V  || "").trim();
								if (!_ex.natureza) _ex.natureza = String(vr.OP_V   || "").trim();
								if ((!_ex.vendedor || _ex.vendedor === "?") && String(vr.VEND_V || "").trim())
									_ex.vendedor = String(vr.VEND_V).trim();
								idIndex.set(_keyV, _keyStripped);
								_vendaNfeKey.set(_nfRaw, _keyStripped);
								continue;
							}
							if (mapVendas.has(_keyV)) continue;
							const _nsuStr = String(vr.NSU_V || "").trim().replace(/^0+/, "");
							mapVendas.set(_keyV, {
								_dtKey: _dtV, vendedor: String(vr.VEND_V || "").trim(),
								modelo: 55, numero: _nfExib, caixa: "",
								hora: String(vr.HORA_V || "").trim().substring(0, 8),
								cliente: String(vr.CLI_V || "").trim(),
								natureza: String(vr.OP_V || "").trim(),
								total_nfce: _vTotal, total_pag: 0, formas: []
							});
							idIndex.set(_keyV, _keyV);
							// Alias stripped → chave principal: PAGAMENT busca com número sem zeros
							if (_keyStripped !== _keyV) idIndex.set(_keyStripped, _keyV);
							if (_nsuStr) idIndex.set(_dtV + "|" + _nsuStr, _keyV);
							_vendaNfeKey.set(_nfRaw, _keyV);
						}
					}
				}
			} catch(eV) { console.log("AVISO VENDAS: " + eV.message); }

			// ── Aguarda as 2 queries paralelas ──────────────────────────────────────────
			// Main conn já terminou NFCE+VENDAS; PAGAMENT é o bottleneck (~70ms sem GROUP BY).
			const [rPag, rrAlt] = await Promise.all([_pPag, _pAlt]);
			tick("queries paralelas prontas");
			if (rPag.e) {
				db.detach();
				console.log("Erro na consulta PAGAMENT: " + String(rPag.e.message || rPag.e));
				process.exit(1);
			}
			// ── Processa linhas brutas de pagament em dois passes ────────────────────────
			// Pass 1: separa forma='00' (tot real) das demais, agrupando por data+pedido.
			// Pass 2: insere grupos no mapVendas.
			// Substitui GROUP BY + list() no SQL pelo JS (mais rápido no total).
			const _tot00Sums  = new Map(); // key → abs(sum(valor)) para forma='00'
			const _pagGroups  = new Map(); // key → {ped, vendedor, total, formas, formasValores}
			for (const p of rPag.rows) {
				const dt        = toISO(p.DATA);
				const ped0      = String(p.PEDIDO  || "").trim().replace(/^0+/, "");
				const valor     = Number(p.VALOR   || 0);
				const formaPref = String(p.FORMA_PREF || "").trim();
				// Para pedido vazio inclui vendedor na chave, replicando o GROUP BY
				// (data, pedido, vendedor) do SQL original — mantém avulsos separados por vendedor.
				const key0      = ped0 ? (dt + "|" + ped0) : (dt + "||v:" + String(p.VENDEDOR || "").trim());

				if (formaPref === "00" && valor < 0) {
					// Entrada de total real (balanceador negativo do SmallSoft)
					_tot00Sums.set(key0, (_tot00Sums.get(key0) || 0) + Math.abs(valor));
					continue;
				}
				if (valor <= 0) continue;

				const formaNomeRaw = String(p.FORMA_NOME || "").trim();
				const formaNome    = formaNomeRaw.replace(/^cartao(?: +|$)/i, "").trim() || formaNomeRaw;
				const vendPag      = String(p.VENDEDOR   || "").trim();

				if (!_pagGroups.has(key0)) {
					_pagGroups.set(key0, { ped: ped0, vendedor: vendPag, total: 0,
					                       formas: [], formasValores: new Map() });
				}
				const grp = _pagGroups.get(key0);
				grp.total += valor;
				grp.formas.push(formaNome);
				grp.formasValores.set(formaNome, (grp.formasValores.get(formaNome) || 0) + valor);
				if (!grp.vendedor && vendPag) grp.vendedor = vendPag;
			}

			// Mapa: "YYYY-MM-DD|pedStripped" → total real (abs do '00')
			const _tot00Map = new Map();
			for (const [k, v] of _tot00Sums) { if (v > 0) _tot00Map.set(k, v); }

			// ── Pass 2: insere grupos no mapVendas ───────────────────────────────────────
			let contadorAvulso = 0;
			for (const [key0, grp] of _pagGroups) {
				const dt    = key0.split("|")[0];
				let   ped   = grp.ped;
				const valor = grp.total;
				if (valor <= 0) continue;

				if (!ped) { contadorAvulso++; ped = "REC-" + contadorAvulso; }
				const searchKey  = dt + "|" + ped;
				const primaryKey = idIndex.get(key0) || idIndex.get(searchKey);

				if (primaryKey && mapVendas.has(primaryKey)) {
					const v = mapVendas.get(primaryKey);
					v.total_pag += valor;
					v.formas.push(...grp.formas);
					if (!v.formasValores) v.formasValores = new Map();
					for (const [f, fv] of grp.formasValores)
						v.formasValores.set(f, (v.formasValores.get(f) || 0) + fv);
					if (v.modelo !== 55 && grp.vendedor && grp.vendedor !== "?") v.vendedor = grp.vendedor;
				} else {
					mapVendas.set(searchKey, {
						_dtKey: dt, vendedor: grp.vendedor, modelo: 99, numero: ped, caixa: "",
						total_nfce: 0, total_pag: valor, formas: grp.formas,
						formasValores: grp.formasValores, is_recebimento: true
					});
					idIndex.set(searchKey, searchKey);
				}
			}


			const altMap      = new Map();
			const vendAltMap  = new Map();
			const horaAltMap  = new Map();
			const altTotalMap = new Map(); // soma itens não-cancelados (total real)
			const altItensMap = new Map(); // detalhes completos: {desc,qtd,total,cancelado}

			if (!rrAlt.e && rrAlt.rows && rrAlt.rows.length) {
				for (const row of rrAlt.rows) {
					const ped = String(row.PED ?? "").trim().replace(/^0+/, "");
					if (!ped) continue;

					const searchKey  = toISO(row.DATA) + "|" + ped;
					const primaryKey = idIndex.get(searchKey) || searchKey;

					const vAlt = String(row.VENDEDOR_ALT || "").trim();
					if (vAlt && vAlt !== "?" && !vendAltMap.has(primaryKey)) vendAltMap.set(primaryKey, vAlt);

					const hAlt = String(row.HORA_ALT || "").trim();
					if (hAlt && !horaAltMap.has(primaryKey)) horaAltMap.set(primaryKey, hAlt);

					const desc        = String(row.DESCRICAO || "").trim();
					const isCancelado = /cancelad/i.test(desc) || desc === "<CANCELADO>";
					const qtd         = fmtQtd(row.QUANTIDADE);
					const itemTotal   = (_temPrecoAlt && row.TOTAL_ITEM !== null && row.TOTAL_ITEM !== undefined)
						? Number(row.TOTAL_ITEM) : null;

					// Acumula total real (excluindo cancelados)
					if (!isCancelado && itemTotal !== null && Number.isFinite(itemTotal)) {
						altTotalMap.set(primaryKey, (altTotalMap.get(primaryKey) || 0) + itemTotal);
					}

					if (!desc) continue;

					// altItensMap — apenas itens não-cancelados (cancelados ignorados globalmente)
					if (!isCancelado) {
						if (!altItensMap.has(primaryKey)) altItensMap.set(primaryKey, []);
						altItensMap.get(primaryKey).push({
							desc,
							qtd,
							total: (itemTotal !== null && Number.isFinite(itemTotal)) ? itemTotal : null,
							cancelado: false
						});
					}

					// altMap (string) — chips e busca: também exclui cancelados
					if (!isCancelado) {
						if (!altMap.has(primaryKey)) altMap.set(primaryKey, []);
						altMap.get(primaryKey).push(qtd + "x " + desc);
					}
				}
			}

			// ── ITENS001: itens das NF-e ────────────────────────────────────
			try {
				if (_vendaNfeKey && _vendaNfeKey.size > 0) {
					const _camI = await camposTabela("ITENS001");
					if (_camI.has("NUMERONF") && _camI.has("DESCRICAO")) {
						const _cIq  = _camI.has("QUANTIDADE") ? "cast(i.QUANTIDADE as double precision)" : "1";
						// Campo de preço: TOTAL > PRECO*QTD > UNITARIO*QTD > null
						const _cIp  = _camI.has("TOTAL")     ? "cast(i.TOTAL as double precision)"
						            : _camI.has("PRECO")     ? "cast(i.PRECO as double precision) * " + (_camI.has("QUANTIDADE") ? "cast(i.QUANTIDADE as double precision)" : "1")
						            : _camI.has("UNITARIO") ? "cast(i.UNITARIO as double precision) * " + (_camI.has("QUANTIDADE") ? "cast(i.QUANTIDADE as double precision)" : "1")
						            : "cast(null as double precision)";
						const _rI = await query(db, `
							SELECT cast(i.NUMERONF as varchar(30)) as NF_I,
							       cast(i.DESCRICAO as varchar(120)) as DESC_I,
							       ${_cIq} as QTD_I,
							       ${_cIp} as PRECO_I
							FROM ITENS001 i
							INNER JOIN VENDAS v ON v.NUMERONF = i.NUMERONF
							WHERE cast(v.SAIDAD as date) BETWEEN cast(? as date) AND cast(? as date)
							  AND cast(v.MODELO as varchar(5)) = '55'
							  AND v.TOTAL > 0
						`, [dataInicioISO, dataFimISO]);
						tick("ITENS001");
						if (!_rI.e && _rI.rows) {
							for (const it of _rI.rows) {
								const _nfI   = String(it.NF_I   || "").trim();
								const _descI = String(it.DESC_I || "").trim();
								if (!_descI) continue;
								const _keyI  = _vendaNfeKey.get(_nfI);
								if (!_keyI) continue;
								const _qtdI  = fmtQtd(it.QTD_I || 1);
								const _precoI = (it.PRECO_I !== null && it.PRECO_I !== undefined)
								? Number(it.PRECO_I) : null;
								// altMap (string) — chips e busca
								if (!altMap.has(_keyI)) altMap.set(_keyI, []);
								altMap.get(_keyI).push(_qtdI + "x " + _descI);
								// altItensMap — detalhes com preço para o modal
								if (!altItensMap.has(_keyI)) altItensMap.set(_keyI, []);
								altItensMap.get(_keyI).push({
									desc: _descI, qtd: _qtdI,
									total: (_precoI !== null && Number.isFinite(_precoI)) ? _precoI : null,
									cancelado: false
								});
							}
						}
					}
				}
			} catch(eI) { console.log("AVISO ITENS001: " + eI.message); }

			// ── DEDUPLICAÇÃO NF-e ──────────────────────────────────────────────
			// Problema: NFCE e VENDAS podem gerar duas entradas para a mesma NF-e
			// quando os números não batem exatamente após normalização de zeros.
			// Estratégia: agrupar entradas modelo=55 por (data + total arredondado),
			// e quando há par com mesmo total, mesclar a menos completa na mais
			// completa (mais campos preenchidos = ganha), removendo a duplicada.
			// Entradas is_recebimento nunca participam da deduplicação.
			{
				const _nfe55 = [];
				for (const [k, v] of mapVendas.entries()) {
					if (v.modelo === 55 && !v.is_recebimento) _nfe55.push([k, v]);
				}
				// Agrupa por data + total arredondado (centavos)
				const _grpNfe = new Map();
				for (const [k, v] of _nfe55) {
					const _gk = (v._dtKey||"") + "|" + Math.round((v.total_nfce||v.total_pag||0)*100);
					if (!_grpNfe.has(_gk)) _grpNfe.set(_gk, []);
					_grpNfe.get(_gk).push([k, v]);
				}
				for (const [, pares] of _grpNfe.entries()) {
					if (pares.length < 2) continue;
					// Pontua cada entrada: +1 por campo preenchido relevante
					const pontos = pares.map(([k, v]) =>
						(v.cliente  ? 2 : 0) +
						(v.natureza ? 2 : 0) +
						(v.hora     ? 1 : 0) +
						(v.vendedor && v.vendedor !== "?" ? 1 : 0) +
						(v.formas && v.formas.length > 0 ? 1 : 0)
					);
					// Ordena: mais completo primeiro
					const ordenados = pares.map((p, i) => ({p, pt: pontos[i]}))
						.sort((a, b) => b.pt - a.pt);
					const [principal] = ordenados[0].p;
					const pvPrincipal = mapVendas.get(principal);
					// Mescla dados dos duplicados para o principal e remove os extras
					for (let di = 1; di < ordenados.length; di++) {
						const [kDup, vDup] = ordenados[di].p;
						if (!pvPrincipal.cliente  && vDup.cliente)  pvPrincipal.cliente  = vDup.cliente;
						if (!pvPrincipal.natureza && vDup.natureza) pvPrincipal.natureza = vDup.natureza;
						if (!pvPrincipal.hora     && vDup.hora)     pvPrincipal.hora     = vDup.hora;
						if ((!pvPrincipal.vendedor || pvPrincipal.vendedor === "?") && vDup.vendedor && vDup.vendedor !== "?")
							pvPrincipal.vendedor = vDup.vendedor;
						if (vDup.formas && vDup.formas.length > 0)
							pvPrincipal.formas.push(...vDup.formas);
						// Propaga valores por forma do duplicado
						if (vDup.formasValores) {
							if (!pvPrincipal.formasValores) pvPrincipal.formasValores = new Map();
							for (const [f, fv] of vDup.formasValores)
								pvPrincipal.formasValores.set(f, (pvPrincipal.formasValores.get(f) || 0) + fv);
						}
						// Transfere itens do altMap se o principal não tem
						if (!altMap.has(principal) && altMap.has(kDup))
							altMap.set(principal, altMap.get(kDup));
						console.log("DEDUP NF-e: mesclado " + kDup + " → " + principal);
						mapVendas.delete(kDup);
					}
				}
			}

			const linhas = [];


			for (const [key, v] of mapVendas.entries()) {
				// Para Gerencial (modelo 99): o total SEMPRE vem da soma real dos itens
				// do ALTERACA (exclui cancelados) quando disponível — é o valor cobrado
				// após todas as alterações/cancelamentos de itens. total_nfce pode refletir
				// o valor original da abertura do cupom, ANTES de alterações.
				// Fallback 1: abs('00 Total') do PAGAMENT, se maior que o atual.
				// Fallback 2: total_nfce (campo da tabela NFCE), como último recurso.
				// NFC-e (65) e NF-e (55) têm total_nfce confiável — não corrigidos aqui.
				if (v.modelo === 99) {
					const _tAlt = altTotalMap.get(key);
					const _t00  = _tot00Map.get(key);
					if (_tAlt && _tAlt > 0) {
						// Soma de itens ALTERACA é sempre preferida — é o valor real cobrado
						v.total_nfce = 0;
						v.total_pag  = _tAlt;
					} else {
						// Sem itens com preço no ALTERACA — tenta abs('00') do PAGAMENT
						const _base = v.total_nfce > 0 ? v.total_nfce : v.total_pag;
						if (_t00 && _t00 > _base) {
							v.total_nfce = 0;
							v.total_pag  = _t00;
						}
						// Caso contrário, mantém total_nfce (campo da tabela)
					}
				}
				let finalTotal = v.total_nfce > 0 ? v.total_nfce : v.total_pag;
				if (finalTotal <= 0) continue;

				let finalVendedor = v.vendedor;
				if (!finalVendedor || finalVendedor === "?") finalVendedor = vendAltMap.get(key) || "";
				if (!finalVendedor || finalVendedor === "?") finalVendedor = "(sem vendedor)";

				let finalPags = v.formas.length > 0 ? [...new Set(v.formas)].join(" | ") : "não identificado";

				let numeroDisplay = v.numero;
				if (/^\d+$/.test(numeroDisplay) && numeroDisplay.length < 6) numeroDisplay = numeroDisplay.padStart(6, "0");

				let tItens = "";
				if (v.is_recebimento) {
					tItens = "⤷ Recebimento de Título / Conta";
				} else {
					const arrItens = altMap.get(key);
					if (arrItens && arrItens.length) {
						tItens = arrItens.map(i => "⤷ " + i).join("\n");
					}
				}

				let finalHora = v.hora || horaAltMap.get(key) || "";

				// Guarda de relógio do PDV: se a hora gravada no banco difere da hora atual
				// do computador em mais de 1.5 minutos (adiantado OU atrasado), substitui
				// pela hora atual na primeira detecção e persiste no cache — execuções
				// seguintes reutilizam a hora fixada para manter a venda em posição estável.
				if (finalHora && v._dtKey === _hojeISO) {
					const _hh5 = String(finalHora).substring(0, 5); // HH:MM
					if (_hh5.length === 5) {
						const _toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
						// Positivo = banco adiantado (futuro), negativo = banco atrasado (passado)
						const _diffMin = _toMin(_hh5) - _toMin(horaGeradaBR);
						// Só corrige vendas recentes: lançadas nos últimos 2 min ou com hora futura.
						// Vendas com hora > 2 min no passado já foram lançadas antes — hora não é alterada.
						const _isRecente = _diffMin >= -2;
						if (_isRecente && Math.abs(_diffMin) > 1.5) {
							// key já é "YYYY-MM-DD|stripped_number" — identificador único e estável
							if (_horaCache[key]) {
								// Reutiliza hora fixada em execução anterior (estabilidade de posição)
								finalHora = _horaCache[key];
							} else {
								// Primeira detecção recente com diferença > 1.5 min: fixa na hora atual
								finalHora = horaGeradaBR;
								_horaCache[key] = horaGeradaBR;
								_horaCacheDirty = true;
							}
						}
					}
				}

				const tipoStr = v.modelo === 65 ? "nfc-e" : v.modelo === 99 ? "gerencial" : "nf-e";
				// NF-e usa a natureza da operação no campo de formas
				// Para Gerencial/NFC-e: remove prefixo "Cartao " de cada forma (ex: "Cartao DEBITO" → "DEBITO")
				const _normForma = s => String(s || "").replace(/^cartao(?: +|$)/i, "").trim();
				const finalPagsDisplay = v.modelo === 55
					? (v.natureza || (v.formas.length > 0 ? [...new Set(v.formas)].map(_normForma).filter(Boolean).join(" | ") : "não identificado"))
					: (v.formas.length > 0 ? [...new Set(v.formas)].map(_normForma).filter(Boolean).join(" | ") : "não identificado");

				linhas.push({
					_dtKey: v._dtKey,
					vendedor: finalVendedor,
					modelo: v.modelo,
					tipo: tipoStr,
					numero: numeroDisplay,
					caixa: v.caixa,
					hora: finalHora,
					cliente: v.cliente || "",
					natureza: v.natureza || "",
					total: finalTotal,
					pagamentos: finalPagsDisplay,
					itens: tItens,
					// Detalhes por item com preço — exibido no modal
					itensDetalhe: altItensMap.get(key) || [],
					// Valores por forma de pagamento { PIX: 100.50, Dinheiro: 39.50 }
					// Keys normalizadas: "Cartao DEBITO" → "DEBITO"
					formasValores: v.formasValores
						? Object.fromEntries(
							[...v.formasValores.entries()].reduce((acc, [f, fv]) => {
								const fn = String(f).replace(/^cartao(?: +|$)/i, "").trim() || f;
								acc.set(fn, (acc.get(fn) || 0) + fv);
								return acc;
							}, new Map())
						  )
						: {},
					// Preservado para impedir reclassificação indevida como NF-e
					is_recebimento: !!v.is_recebimento
				});
			}
			
			linhas.sort((a, b) => {
				const hA = String(a.hora || "");
				const hB = String(b.hora || "");
				if (hA > hB) return -1; if (hA < hB) return 1;
				const vA = a.vendedor.toLowerCase(), vB = b.vendedor.toLowerCase();
				if (vA < vB) return -1; if (vA > vB) return 1;
				if (a.modelo < b.modelo) return -1; if (a.modelo > b.modelo) return 1;
				if (a.numero > b.numero) return -1; if (a.numero < b.numero) return 1;
				return 0;
			});

			// Reclassifica como NF-e (55) entradas com modelo incorreto no banco.
			//
			// Casos cobertos:
			//   A) MODELO=55 no banco → já correto, pula.
			//   B) MODELO=NULL→coalesce→65 (NFC-e) OU MODELO=99 (Gerencial)
			//      com campo natureza preenchido → NF-e sem MODELO correto.
			//   C) Qualquer modelo com forma de pagamento contendo variante de "NF-e"
			//      (NF-E, NFE, NF/E, NF.E, NF E) → NF-e declarada na forma.
			//
			// Não restringe por x.modelo===99 — MODELO=NULL chega como 65 via coalesce.
			const _reNfe = /\bNF[\-\.\s]?E\b/i;
			for (const x of linhas) {
				if (x.modelo === 55) continue; // já correto — pula
				// Recebimentos de PAGAMENT sem vínculo não são NF-e — forma "Dinheiro NF-e"
				// é apenas o nome da forma de pagamento, não indica que é uma NF-e nova.
				if (x.is_recebimento) continue;

				// Caso B: natureza preenchida (campo exclusivo de NF-e)
				if (x.natureza && String(x.natureza).trim()) {
					x.modelo = 55;
					x.tipo   = "nf-e";
					if (!x.pagamentos || x.pagamentos === "NÃO DECLARADO") {
						x.pagamentos = String(x.natureza).trim();
					}
					continue;
				}

				// Caso C: forma menciona NF-e em qualquer variante
				// Normaliza tokens (remove hifens/pontos) para cobrir: NF-E, NFE, NF.E, NF/E
				const _formaBruta = String(x.pagamentos || "");
				const _tokensNorm = _formaBruta
					.split(/[\s|,\/]+/)
					.map(s => s.trim().toUpperCase().replace(/[\-\.]/g, ""))
					.filter(Boolean);
				if (_reNfe.test(_formaBruta) || _tokensNorm.includes("NFE")) {
					x.modelo = 55;
					x.tipo   = "nf-e";
				}
			}

			const totaisDia = { ok: true, gerencial: 0, nfce: 0, nfe: 0, geral: 0, selecionado: 0, qtd_gerencial: 0, qtd_nfce: 0, qtd_nfe: 0, modelos: [] };
			const mpVend = new Map();

			for (const x of linhas) {
				if (!mpVend.has(x.vendedor)) {
					mpVend.set(x.vendedor, { vendedor: x.vendedor, gerencial: 0, nfce: 0, nfe: 0, geral: 0, qtd: 0 });
				}
				const v = mpVend.get(x.vendedor);
				v.qtd++;
				v.geral += x.total;
				if (x.modelo === 99)      v.gerencial += x.total;
				else if (x.modelo === 65) v.nfce      += x.total;
				else if (x.modelo === 55) v.nfe       += x.total;

				totaisDia.geral += x.total;
				if (x.modelo === 99)      { totaisDia.gerencial += x.total; totaisDia.qtd_gerencial++; }
				else if (x.modelo === 65) { totaisDia.nfce      += x.total; totaisDia.qtd_nfce++; }
				else if (x.modelo === 55) { totaisDia.nfe       += x.total; totaisDia.qtd_nfe++; }
			}

			totaisDia.selecionado = totaisDia.geral;
			if (totaisDia.gerencial > 0) totaisDia.modelos.push({modelo: 99, total: totaisDia.gerencial});
			if (totaisDia.nfce      > 0) totaisDia.modelos.push({modelo: 65, total: totaisDia.nfce});
			if (totaisDia.nfe       > 0) totaisDia.modelos.push({modelo: 55, total: totaisDia.nfe});

			const vendTotaisDia = [...mpVend.values()].sort((a, b) => a.vendedor.localeCompare(b.vendedor, "pt-BR", { sensitivity: "base" }));
			const vendedores = [...mpVend.values()].map(v => ({ vendedor: v.vendedor, qtd: v.qtd, total: v.geral })).sort((a, b) => a.vendedor.localeCompare(b.vendedor, "pt-BR", { sensitivity: "base" }));

			const totalGeral = totaisDia.geral;
			const qtdGeral = linhas.length;

			const dados = {
				data: dataInicioISO === dataFimISO ? dataInicioISO : `${dataInicioISO} a ${dataFimISO}`,
				gerado_ts: Date.now(),
				totais: { qtd: qtdGeral, total: totalGeral },
				vendedores,
				vendTotaisDia,
				vendas: linhas,
				totaisDia
			};
			const dadosJSON = JSON.stringify(dados).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
			tick("JSON montado — gerando HTML...");
			const html = String.raw`<!doctype html><html lang="pt-br"><head><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="icon" href="/favicon.png"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Relatório ${escHtml(cfgAppName)} ${escHtml(dataBR)}</title>
<script>
      (function(){
        try {
          var t = localStorage.getItem("fdb_theme") || (document.cookie.match(/fdb_theme=([^;]+)/)||[])[1] || "ultra-dark";
          document.documentElement.setAttribute("data-theme", t);
        } catch(e){}
      })();
    </script>
<style>
:root, [data-theme="dark"] {
  --bg-app: #09090b; --bg-panel: #18181b; --bg-hover: #27272a;
  --border: rgba(255, 255, 255, 0.08); --border-focus: rgba(255, 255, 255, 0.15);
  --text-main: #f4f4f5; --text-muted: #a1a1aa;
  --accent: #3b82f6; --accent-hover: #2563eb; --accent-bg: rgba(59, 130, 246, 0.1);
  --danger: #ef4444; --success: #10b981;
  --top-bg: rgba(24, 24, 27, 0.75); --top-blur: blur(16px);
  --th-bg: rgba(24, 24, 27, 0.95); --mhead-bg: rgba(24, 24, 27, 0.95); --ov-bg: rgba(0, 0, 0, 0.7);
  --chip-bg: transparent; --chip-bg-hover: rgba(255,255,255,0.05);
  --scroll-thumb: rgba(255, 255, 255, 0.15); --scroll-thumb-hover: rgba(255, 255, 255, 0.25);
  --radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px;
  --shadow-sm: 0 1px 2px 0 rgba(0,0,0,0.05); --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.1);
  --shadow-lg: 0 10px 25px -5px rgba(0,0,0,0.5), 0 8px 10px -6px rgba(0,0,0,0.3);
  --easing: cubic-bezier(0.4, 0, 0.2, 1);
  --transition: all 0.3s var(--easing); --transition-fast: all 0.15s var(--easing);
  color-scheme: dark;
}
[data-theme="ultra-dark"] {
  --bg-app: #000000; --bg-panel: #0a0a0a; --bg-hover: #171717;
  --border: rgba(255, 255, 255, 0.08); --border-focus: rgba(255, 255, 255, 0.15);
  --text-main: #ededed; --text-muted: #a1a1aa;
  --accent: #0ea5e9; --accent-hover: #0284c7; --accent-bg: rgba(14, 165, 233, 0.12);
  --top-bg: rgba(10, 10, 10, 0.65); --top-blur: blur(20px);
  --th-bg: rgba(10, 10, 10, 0.85); --mhead-bg: rgba(10, 10, 10, 0.8); --ov-bg: rgba(0, 0, 0, 0.8);
  --chip-bg: rgba(255,255,255,0.03); --chip-bg-hover: rgba(255,255,255,0.06);
  --scroll-thumb: rgba(255, 255, 255, 0.1); --scroll-thumb-hover: rgba(255, 255, 255, 0.2);
  --radius-sm: 6px; --radius-md: 10px; --radius-lg: 16px;
  --shadow-sm: 0 1px 2px 0 rgba(0,0,0,0.05); --shadow-md: 0 4px 12px rgba(0,0,0,0.3);
  --shadow-lg: 0 20px 40px -10px rgba(0,0,0,0.8), 0 10px 15px -5px rgba(0,0,0,0.4);
  --easing: cubic-bezier(0.16, 1, 0.3, 1);
  color-scheme: dark;
}
[data-theme="light"] {
  --bg-app: #f8fafc; --bg-panel: #ffffff; --bg-hover: #f1f5f9;
  --border: rgba(0, 0, 0, 0.1); --border-focus: rgba(0, 0, 0, 0.2);
  --text-main: #0f172a; --text-muted: #64748b;
  --accent: #2563eb; --accent-hover: #1d4ed8; --accent-bg: rgba(37, 99, 235, 0.1);
  --top-bg: rgba(255, 255, 255, 0.75); --top-blur: blur(20px);
  --th-bg: rgba(255, 255, 255, 0.9); --mhead-bg: rgba(255, 255, 255, 0.9); --ov-bg: rgba(0, 0, 0, 0.4);
  --chip-bg: rgba(0,0,0,0.03); --chip-bg-hover: rgba(0,0,0,0.06);
  --scroll-thumb: rgba(0, 0, 0, 0.15); --scroll-thumb-hover: rgba(0, 0, 0, 0.25);
  --shadow-sm: 0 1px 2px 0 rgba(0,0,0,0.05); --shadow-md: 0 4px 12px rgba(0,0,0,0.08);
  --shadow-lg: 0 20px 40px -10px rgba(0,0,0,0.12), 0 10px 15px -5px rgba(0,0,0,0.05);
  --easing: cubic-bezier(0.16, 1, 0.3, 1);
  color-scheme: light;
}
@keyframes fadeSlideUp { 0% { opacity: 0; transform: translateY(20px); } 100% { opacity: 1; transform: translateY(0); } }
@keyframes fadeIn { 0% { opacity: 0; } 100% { opacity: 1; } }
@keyframes scaleIn { 0% { opacity: 0; transform: scale(0.96); } 100% { opacity: 1; transform: scale(1); } }
@keyframes reveal { 0% { opacity: 0; transform: translateY(-6px) scale(0.88); } 60% { opacity: 1; transform: translateY(2px) scale(1.04); } 80% { transform: translateY(-1px) scale(0.98); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
.reveal { animation: reveal 1s cubic-bezier(0.34,1.56,0.64,1) both; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; margin: 0; background: var(--bg-app); color: var(--text-main); font-family: 'Inter', sans-serif; overflow: hidden; -webkit-font-smoothing: antialiased; }
.mono { font-family: 'JetBrains Mono', Consolas, monospace; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--scroll-thumb); border-radius: 10px; border: 2px solid var(--bg-app); }
::-webkit-scrollbar-thumb:hover { background: var(--scroll-thumb-hover); }
.app { height: 100%; max-height: 100vh; display: grid; grid-template-rows: auto 1fr; overflow: hidden; animation: fadeIn 0.5s var(--easing); }
.top { display: grid; grid-template-columns: 1fr; gap: 16px; padding: 16px 28px; background: var(--top-bg); backdrop-filter: var(--top-blur); border-bottom: 1px solid var(--border); z-index: 50; box-shadow: var(--shadow-sm); }
.top .left { display: flex; flex-wrap: nowrap; gap: 14px; align-items: center; justify-content: space-between; }
.badges { display: flex; gap: 10px; align-items: center; flex-wrap: nowrap; min-width: 0; }
.badge { display: inline-flex; align-items: center; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); background: var(--bg-panel); border: 1px solid var(--border); padding: 6px 12px; border-radius: 99px; white-space: nowrap; transition: var(--transition); box-shadow: var(--shadow-sm); }
.badge:hover { border-color: var(--accent); color: var(--accent); transform: translateY(-1px); }
.badgeHora { background: transparent; border-color: transparent; box-shadow: none; }
.top .right { display: flex; gap: 10px; align-items: center; }
/* vendBtn trunca o nome do vendedor — nunca força a topbar a crescer */
.vendBtn { display: none; max-width: 260px; min-width: 0; }
.vendIcon { flex-shrink: 0; display: flex; align-items: center; }
.vendTxt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.input { flex: 1 1 auto; background: var(--bg-panel); border: 1px solid var(--border); color: var(--text-main); padding: 10px 16px; font-size: 13px; border-radius: var(--radius-md); outline: none; transition: var(--transition-fast); width: 100%; }
.input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg); }
/* Wrapper do campo de busca com X interno */
.inputWrap { position: relative; flex: 1 1 auto; display: flex; align-items: center; min-width: 0; }
.inputWrap .input { padding-right: 36px; }
.inputWrap #limpar {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  width: 24px; height: 24px; padding: 0; border: none; border-radius: 50%;
  background: transparent; box-shadow: none; font-size: 13px; font-weight: 700;
  color: var(--text-muted); opacity: 0; pointer-events: none;
  transition: opacity 0.15s, color 0.15s, background 0.15s;
  display: flex; align-items: center; justify-content: center;
}
.inputWrap #limpar:hover { background: var(--bg-hover); color: var(--text-main); transform: translateY(-50%); box-shadow: none; }
.inputWrap #limpar.visivel { opacity: 1; pointer-events: auto; }
.radioBusca { display: flex; align-items: center; gap: 6px; background: var(--bg-panel); padding: 4px; border-radius: 99px; border: 1px solid var(--border); }
.radioBusca .radio { user-select: none; display: inline-flex; align-items: center; padding: 6px 16px; border-radius: 99px; background: transparent; cursor: pointer; transition: var(--transition-fast); margin: 0; }
.radioBusca .radio input { display: none; }
.radioBusca .radio span { font-size: 12px; font-weight: 600; color: var(--text-muted); transition: var(--transition-fast); }
.radioBusca .radio:hover:not(:has(input:checked)) { background: var(--bg-hover); }
.radioBusca .radio:has(input:checked) { background: var(--bg-hover); box-shadow: var(--shadow-sm); }
.radioBusca .radio:has(input:checked) span { color: var(--text-main); }
.btn { cursor: pointer; background: var(--bg-panel); border: 1px solid var(--border); color: var(--text-main); font-weight: 500; font-size: 13px; padding: 0 18px; border-radius: var(--radius-md); height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; transition: var(--transition-fast); white-space: nowrap; box-shadow: var(--shadow-sm); }
.btn:hover { background: var(--bg-hover); border-color: var(--text-muted); transform: translateY(-2px); box-shadow: var(--shadow-md); }
.btn:active { transform: translateY(0); }
.btnIcon { padding: 0; width: 38px; font-size: 16px; flex-shrink: 0; }
/* Botões com ícone SVG + texto */
.btnLabel { gap: 7px; padding: 0 14px; font-size: 12px; font-weight: 600; }
.btnLabel svg { flex-shrink: 0; }
.btnProibidos { display: none; } .badgeGeradoMobile { display: none; }
.main { min-height: 0; display: grid; grid-template-columns: 280px 1fr; animation: fadeSlideUp 0.6s var(--easing) forwards; }
.sidebar { min-height: 0; border-right: 1px solid var(--border); padding: 24px 20px; display: flex; flex-direction: column; background: var(--bg-app); }
.sb-head { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; margin-bottom: 12px; }
.sb-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); font-weight: 700; }
.list { min-height: 0; overflow-y: auto; flex: 1 1 50%; padding-right: 4px; margin-bottom: 20px; }
.item { display: flex; align-items: center; justify-content: space-between; padding: 5px; background: transparent; border-radius: var(--radius-md); margin-bottom: 5px; cursor: pointer; border: 1px solid transparent; transition: var(--transition); }
.item:hover { background: var(--bg-panel); border-color: var(--border); }
.item.sel { background: var(--bg-panel); border-color: var(--border-focus); box-shadow: var(--shadow-md); }
.item .nome { font-weight: 500; font-size: 13px; color: var(--text-muted); transition: var(--transition-fast); }
.item.sel .nome, .item:hover .nome { color: var(--text-main); font-weight: 600; }
.item .meta { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
.item .qtd { font-size: 11px; color: var(--text-muted); }
.item .tot { font-size: 13px; font-weight: 600; color: var(--text-main); font-family: 'JetBrains Mono', monospace; }
.sbResumo { display: flex; flex-direction: column; flex: 0 100 50%; min-height: 0; border-top: 1px solid var(--border); padding-top: 20px; }
.sbResumoBody { overflow-y: auto; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; margin-left: -12px; }
.rv { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: transparent; border-radius: var(--radius-md); transition: var(--transition-fast); }
.rv:hover { background: var(--bg-panel); box-shadow: var(--shadow-sm); }
.rv .n { font-size: 13px; font-weight: 500; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 65%; }
.rv .v { font-size: 13px; font-weight: 600; color: var(--text-main); font-family: 'JetBrains Mono', Consolas, monospace; }
.content { min-height: 0; padding: 20px; background: var(--bg-app); }
.tableWrap { height: 100%; display: flex; flex-direction: column; background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); overflow: hidden; }
.tableTop { display: flex; flex-direction: column; gap: 6px; padding: 19px 23px; border-bottom: 1px solid var(--border); background: var(--bg-panel); }
.tableTitle { font-size: 20px; font-weight: 700; color: var(--text-main); letter-spacing: -0.02em; }
.count { font-size: 13px; color: var(--text-muted); font-weight: 500; margin: 7px 4px; }
.btns { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px; padding-top: 6px; }
.itensMiniHead { display: flex; flex-direction: row; justify-content: space-between; align-items: center; gap: 10px; margin: 0 0 10px 0; padding-bottom: 8px; border-bottom: 1px dashed var(--border-focus); font-size: 11px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em; color: var(--text-muted); }
.itensMiniHead .sub { font-size: 10px; color: var(--text-main); background: var(--bg-panel); padding: 3px 8px; border-radius: 99px; border: 1px solid var(--border-focus); font-weight: 600; letter-spacing: 1px; text-transform: none; }
.itensChips { display: flex; flex-wrap: wrap; gap: 6px; flex-direction: column; }
.itensChip { display: inline-flex; align-items: center; background: var(--chip-bg); border: 1px solid var(--border-focus); padding: 4px 10px 4px 4px; border-radius: 99px; font-size: 12px; font-weight: 500; color: var(--text-muted); transition: var(--transition-fast); max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cardRow:hover .itensChip, .kv:hover .itensChip { border-color: var(--text-muted); color: var(--text-main); background: var(--chip-bg-hover); }
.itensQtd { color: var(--text-main); background: var(--accent); margin-right: 6px; padding: 2px 6px; border-radius: 99px; font-size: 12px; font-weight: 700; font-family: 'JetBrains Mono', Consolas, monospace; box-shadow: var(--shadow-sm); letter-spacing: 1px; }
span#vendTopTxt {
	margin-top: 2.5px;
    /*max-width: 52px;
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;*/
}
span#tDiaSel { margin-right: 3px; }
.badge[data-tip="Data dos dados desse relatório"],.badge[data-tip="Dia, hora e mês em que esse relatório foi gerado"] { letter-spacing: 1px; }
span#tQtdGer, span#tQtdNfce { margin: 0 5px; } div#vendSel { margin-right: 5px; }
table { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; display: block; flex: 1 1 auto; overflow: auto; --sbw: 0px; }
thead { position: sticky; top: 0; z-index: 10; display: table; width: 100%; table-layout: fixed; }
tbody { display: table; width: 100%; table-layout: fixed; }
thead th { background: var(--th-bg); backdrop-filter: blur(12px); color: var(--text-muted); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; padding: 12px 8px; border-bottom: 1px solid var(--border); text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
tbody tr { background: transparent; transition: var(--transition); cursor: pointer; }
tbody td { padding: 12px 8px; border-bottom: 1px solid var(--border); font-size: 13px; color: var(--text-muted); vertical-align: middle; transition: var(--transition-fast); overflow: hidden; }
tbody tr:hover { background: var(--bg-hover); transform: translateY(-1px); box-shadow: var(--shadow-md); position: relative; z-index: 5; }
tbody tr:hover td { border-bottom-color: transparent; color: var(--text-main); }
tbody tr:hover td:first-child { border-top-left-radius: var(--radius-md); border-bottom-left-radius: var(--radius-md); }
tbody tr:hover td:last-child { border-top-right-radius: var(--radius-md); border-bottom-right-radius: var(--radius-md); }
/* Colunas com larguras fixas — thead e tbody usam table-layout:fixed, então as larguras do col/thead definem tudo */
thead th:nth-child(1), tbody td:nth-child(1) { width: 15%; text-align: center; padding-left: 14px; font-weight: 600; }
thead th:nth-child(2), tbody td:nth-child(2) { width: 68px; text-align: center; }
thead th:nth-child(3), tbody td:nth-child(3) { width: 80px; text-align: center; }
thead th:nth-child(4), tbody td:nth-child(4) { width: 11%; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
thead th:nth-child(5), tbody td:nth-child(5) { width: 108px; text-align: center; font-weight: 700; color: var(--text-main); white-space: nowrap; }
thead th:nth-child(6), tbody td:nth-child(6) { width: 15%; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
thead th:nth-child(7), tbody td:nth-child(7) { width: auto; text-align: center; padding-left: 8px; }
thead tr { user-select: none; }
.tdItemsWrap { display: flex; flex-wrap: wrap; gap: 6px; max-height: 138px; overflow: hidden; }
.tdItemChip { display: block; align-items: center; background: var(--chip-bg); border: 1px solid var(--border-focus); padding: 6px 12px; border-radius: 99px; font-size: 12px; font-weight: 500; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; transition: var(--transition-fast); width: 100%; text-align: center; }
.tdItemMais { color: var(--accent); border-color: var(--accent-bg); font-weight: 700; background: var(--accent-bg); }
tbody tr:hover .tdItemChip { border-color: var(--text-muted); color: var(--text-main); background: var(--chip-bg-hover); }
tbody tr:hover .tdItemMais { border-color: var(--accent); color: var(--accent); background: var(--accent-bg); }
.tdItemQtd { color: var(--accent); font-weight: 700; margin-right: 6px; font-family: 'JetBrains Mono', monospace; }
.itensMini .itensChips { max-height: 220px; overflow-y: auto; padding-right: 4px; scroll-behavior: smooth; }
.itensMini.big { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.itensMini.big .itensChips { flex: 1 1 auto; overflow-y: auto; min-height: 60px; max-height: none; padding-right: 6px; scroll-behavior: smooth; }
.ov { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; background: var(--ov-bg); backdrop-filter: blur(10px); z-index: 9998; padding: 20px; opacity: 0; transition: opacity 0.3s var(--easing); }
.ov.on { display: flex; opacity: 1; } .ov.on .modal { animation: scaleIn 0.3s var(--easing) forwards; }
.modal { width: min(720px, 100%); max-height: 90vh; display: flex; flex-direction: column; background: var(--bg-panel); border: 1px solid var(--border-focus); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); overflow: hidden; }
.mhead { display: flex; padding: 24px; background: var(--mhead-bg); backdrop-filter: blur(12px); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 10; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: space-between; }
.mtitle { font-size: 22px; font-weight: 700; color: var(--text-main); letter-spacing: -0.02em; }
.msub { font-size: 13px; color: var(--text-muted); margin-top: 4px; }
.mbody { display: flex; flex-direction: column; gap: 5px; padding: 12px; overflow: auto; flex: 1 1 auto; min-height: 0; }
.mbody .kv { flex-shrink: 0; }
/* ── Tabela de itens do modal de detalhes ────────────────────────────────────
   Reseta as propriedades globais "table { display:block; overflow:auto; flex:1 1 auto }"
   que se aplicam a TODAS as tables — aqui precisamos de comportamento de table normal,
   pois o scroll é gerenciado pelo wrapper .itensDetalheScroll                         */
.itensDetalheList { display:table; overflow:visible; flex:none; width:100%; border-collapse:collapse; font-size:12px; }
/* Cada linha vira flex — space-between distribui qtd | desc | preço pelo width total */
.itensDetalheList tr { display:flex; align-items:center; justify-content:space-between; width:100%; border-bottom:1px solid var(--border); cursor:default; gap:0; }
.itensDetalheList tr.cancelado { opacity:0.45; text-decoration:line-through; }
.itensDetalheList td { padding:5px 6px; vertical-align:middle; }
/* Qtd: largura fixa à esquerda — mono, negrito */
.itensDetalheList td.iqtd { flex-shrink:0; color:var(--text-main); font-weight:700; font-family:'JetBrains Mono',Consolas,monospace; white-space:nowrap; width:50px; text-align:right; padding-right:8px; }
/* Desc: ocupa TODO o espaço restante — trunca se ultrapassar */
.itensDetalheList td.idesc { flex:1 1 0; min-width:0; color:var(--text-main); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding-left:78px; }
.itensDetalheList td.idesc .icancelLabel { font-size:10px; color:var(--danger,#e55); margin-left:6px; font-weight:600; letter-spacing:0.04em; }
/* Preço: largura fixa à direita — mono, negrito */
.itensDetalheList td.ipreco { flex-shrink:0; text-align:right; white-space:nowrap; font-family:'JetBrains Mono',Consolas,monospace; font-weight:600; color:var(--text-main); width:120px; }
.itensDetalheList td.ipreco.desc { color:var(--danger,#e55); }
/* Scroll estilizado para o corpo dos itens (scroll Y fino, 6px) */
.itensDetalheScroll { overflow-y:auto; flex:1 1 auto; min-height:0; }
.itensDetalheScroll::-webkit-scrollbar { width:6px; }
.itensDetalheScroll::-webkit-scrollbar-track { background:transparent; }
.itensDetalheScroll::-webkit-scrollbar-thumb { background:var(--scroll-thumb); border-radius:10px; }
.itensDetalheScroll::-webkit-scrollbar-thumb:hover { background:var(--scroll-thumb-hover); }
/* Footer fixo do total — sem border-top (últimos itens já têm borda), só padding/margem */
.itensDetalheFoot { flex-shrink:0; display:flex; justify-content:space-between; align-items:center; padding:6px 6px 2px 6px; margin-top:4px; }
.itensDetalheFoot .ilabel { color:var(--text-muted); font-size:11px; font-weight:700; letter-spacing:0.04em; text-transform:uppercase; }
.itensDetalheFoot .itotal { font-family:'JetBrains Mono',Consolas,monospace; font-weight:700; color:var(--accent); font-size:13px; }
/* ── Grid 2 colunas para os kv de detalhes da venda (exceto Itens) ──────────
   Cada kv ocupa uma célula do grid — alinhados uniformemente lado a lado       */
.kvCompactGrid { display:grid; grid-template-columns:1fr 1fr; gap:5px; flex-shrink:0; }
/* kv compacto: chave com largura fixa para alinhamento uniforme no grid */
.kv.kvCompact { grid-template-columns:68px 1fr; padding:8px 12px; gap:8px; align-items:center; }
.kv.kvCompact .k { font-size:10.5px; margin-top:0; }
.kv.kvCompact .v { font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* kvItens ocupa o espaço restante com scroll interno + footer fixo */
.mbody .kvItens { overflow:hidden; display:flex; flex-direction:column; }
.kvItens .v { overflow:hidden; min-height:0; display:flex; flex-direction:column; }
.kv { display: grid; grid-template-columns: 140px 1fr; gap: 16px; align-items: flex-start; background: var(--bg-app); border: 1px solid var(--border); padding: 16px 20px; border-radius: var(--radius-md); transition: var(--transition-fast); }
.kv:hover { border-color: var(--border-focus); background: var(--bg-hover); }
.k { font-size: 12px; color: var(--text-muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 2px; }
.v { font-size: 14px; font-weight: 500; color: var(--text-main); }
.cards { display: none; padding: 16px; overflow-y: auto; }
.cardRow { background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 24px; margin-bottom: 16px; cursor: pointer; transition: var(--transition); box-shadow: var(--shadow-sm); }
.cardRow:hover { border-color: var(--border-focus); transform: translateY(-4px) scale(1.01); box-shadow: var(--shadow-lg); background: var(--bg-hover); }
.cardHead { display: flex; justify-content: space-between; margin-bottom: 12px; align-items: center;}
.cardNum { font-family: 'JetBrains Mono', monospace; color: var(--text-muted); font-size: 14px; font-weight: 600; }
.cardTotal { font-weight: 700; color: var(--accent); font-size: 20px; }
.cardMeta, .cardPay { font-size: 13px; color: var(--text-main); margin-bottom: 6px; font-weight: 500; }
.cardPay { color: var(--text-muted); }

@media (max-width: 1024px) { .top { grid-template-columns: 1fr; padding: 16px 20px; } .top .right { justify-content: flex-start; flex-wrap: wrap; } .content { padding: 20px; } }
@media (max-width: 920px) { .main { grid-template-columns: 1fr; } .sidebar { display: none; } .vendBtn { display: flex; } #acoes { display: inline-flex; } .radioBusca { flex: 1 1 100%; justify-content: space-between; } }
@media (max-width: 680px) {
  .content { padding: 12px; } .tableTop { padding: 20px; } table { display: none; } .cards { display: block; padding-bottom: 100px; }
  .mobileBar { display: flex; position: fixed; bottom: 0; left: 0; right: 0; background: var(--top-bg); backdrop-filter: blur(20px); padding: 16px 20px 24px 20px; gap: 12px; border-top: 1px solid var(--border); z-index: 50; box-shadow: 0 -10px 40px rgba(0,0,0,0.5); }
  .mobileBar .btn { flex: 1; height: 48px; font-weight: 600; border-radius: var(--radius-lg); }
  .ov.sheet { align-items: flex-end; padding: 12px; } .ov.sheet .modal { border-radius: 24px 24px 12px 12px; padding: 24px; animation: fadeSlideUp 0.4s var(--easing) forwards;} .badges .badgeHora { display: none; }
}
/* ── Tooltip customizado ─────────────────────────────────────── */
#__tip {
  position: fixed; z-index: 2147483646; pointer-events: none;
  background: var(--bg-panel); color: var(--text-main);
  border: 1px solid var(--border-focus); border-radius: var(--radius-md);
  padding: 6px 12px; font-size: 12px; font-weight: 500; line-height: 1.45;
  max-width: 280px; white-space: pre-wrap; word-break: break-word;
  box-shadow: 0 8px 24px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.3);
  opacity: 0; transform: translateY(4px) scale(0.97);
  transition: opacity 0.14s ease, transform 0.14s ease;
  backdrop-filter: blur(12px);
}
#__tip.on { opacity: 1; transform: translateY(0) scale(1); }
</style>
</head>
<body>
<div class="app">
<div class="top">
<div class="left">
<button id="btnVend" class="btn vendBtn" type="button" data-tip="Filtrar vendas por vendedor"><span class="vendIcon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span><span id="vendTopTxt" class="vendTxt">Todos</span></button>
<div class="badge badgeHora badgeGeradoMobile">Gerado em: ${escHtml(diaMesGeradaBR)}/${ano2} às ${escHtml(horaGeradaBR)}</div>
<div class="badges">
<div class="badge" data-tip="Data dos dados desse relatório">Data: ${escHtml(dataBR)}</div>
<div class="badge badgeHora" data-tip="Dia, hora e mês em que esse relatório foi gerado">Gerado em: ${escHtml(diaMesGeradaBR)}/${ano2} às ${escHtml(horaGeradaBR)}</div>
<div class="badge" data-tip="Quantidade de vendas por tipo">Gerencial: <span id="tQtdGer"></span><span id="badgeQtdNfce" style="display:none"> ― NFC-e: <span id="tQtdNfce"></span></span><span id="badgeNfe" style="display:none"> ― NF-e: <span id="tQtdNfe"></span></span></div>
<div class="badge" id="bDiaBrk" data-tip="Soma total ― Gerencial ― NFC-e ― NF-e">Total: <span id="tDiaSel"></span><span id="tDiaBrkMini" style="display:none"> ― Gerencial: <span id="tDiaGer"></span><span id="tDiaNfceMini" style="display:none"> ― NFC-e: <span id="tDiaNfce"></span></span><span id="tDiaNfeMini" style="display:none"> ― NF-e: <span id="tDiaNfe"></span></span></span></div>
</div>
</div>
<div class="right">
<div class="inputWrap">
<input id="q" class="input" data-tip="Buscar... Excluir: -termo (1) ou [termo,~contém,=igual,proibidos,-proibidos] (múltiplos)  |  Valor: >100, 10-20, 12*3, 12/3, 12?  |  Múltiplos: +  |  Soma: =151 ou =151*2" placeholder="Buscar... Excluir: -termo (1) ou [termo,~contém,=igual,proibidos,-proibidos] (múltiplos)  |  Valor: >100, 10-20, 12*3, 12/3, 12?  |  Múltiplos: +  |  Soma: =151 ou =151*2" autocomplete="off">
<button id="limpar" class="btn btnIcon" type="button" data-tip="Limpar todos os filtros e exibir todas as vendas" aria-label="Limpar filtros"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
</div>
<div class="radioBusca" id="radioBusca" role="radiogroup" aria-label="Filtrar por tipo de documento"><label class="radio" id="radioLblTodos"><input type="radio" name="tipoBusca" value="todos" checked><span>Todos</span></label><label class="radio" id="radioLblGer" style="display:none"><input type="radio" name="tipoBusca" value="gerencial"><span>Gerencial</span></label><label class="radio" id="radioLblNfce" style="display:none"><input type="radio" name="tipoBusca" value="nfce"><span>NFC-e</span></label><label class="radio" id="radioLblNfe" style="display:none"><input type="radio" name="tipoBusca" value="nfe"><span>NF-e</span></label></div>
<button id="ajuda" class="btn btnLabel" type="button" data-tip="Coringas de busca disponíveis" aria-label="Ajuda com coringas"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".5" fill="currentColor" stroke="none"/></svg>Ajuda</button>
<button id="proibidos" class="btn btnLabel btnProibidos" type="button" data-tip="Aplicar filtro [proibidos] — ocultar vendas com itens proibidos" aria-label="Filtrar proibidos"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>Proibidos</button>
<button id="atualizar" class="btn btnLabel" type="button" data-tip="Recarregar relatório do dia atual" aria-label="Atualizar"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>Atualizar</button>
<button id="btnTema" class="btn btnLabel" type="button" data-tip="Alternar tema de cores (Ultra Dark / Dark / Claro)" aria-label="Alternar tema"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>Tema</button>
<button id="btnModalPeriodo" class="btn btnLabel" type="button" data-tip="Gerar relatório para um intervalo de datas" aria-label="Gerar por período"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg>Por período</button>
<button id="acoes" class="btn btnLabel" type="button" data-tip="Editar configurações do sistema" aria-label="Editar configurações"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>Configurações</button>
</div>
</div>
<div class="main">
<div class="sidebar">
<div class="sb-head">
<div class="sb-title">Vendedores</div>
<div class="pill mono" id="vendSel">Todos</div>
</div>
<div class="list" id="lista"></div>
<div class="sbResumo" id="vendResumo"><div class="sb-head"><div class="sb-title">Total por vendedor</div></div><div class="sbResumoBody"></div></div>
</div>
<div class="content">
<div class="tableWrap">
<div class="tableTop">
<div class="tableTitle" id="sub">Todos os vendedores</div>
<div class="actions">
<div class="count" id="count"></div>
<div class="btns">
<div class="btn" id="limparTabela"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>Limpar filtros</div>
<div class="btn" id="copiarTudo"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copiar tudo</div>
<div class="btn" id="copiarTudoItens"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/><line x1="13" y1="14" x2="17" y2="14"/><line x1="13" y1="17" x2="17" y2="17"/></svg>Copiar + itens</div>
<div class="btn" id="copiarSemDinheiro"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>Sem dinheiro</div>
<div class="btn" id="copiarGerencial"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>Só gerencial</div>
<div class="btn" id="editarProibidos"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>Proibidos</div>
</div>
</div>
</div>
<div class="cards" id="cards"></div>
<table>
<thead>
<tr>
	<th>vendedor</th>
	<th>tipo</th>
	<th>número</th>
	<th data-tip="Hora ou Cliente (se NF-e)">hora / cliente</th>
	<th>total</th>
	<th data-tip="Forma ou Natureza (se NF-e)">forma / natureza</th>
	<th>itens</th>
</tr>
</thead>
<tbody id="tb"></tbody>
</table>
</div>
</div>
</div>
</div>
</div>
<div class="ov" id="ov" aria-hidden="true">
<div class="modal" role="dialog" aria-modal="true">
<div class="mhead">
<div>
<div class="mtitle" id="mTitulo"></div>
<div class="msub" id="mSub"></div>
</div>
<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;font-size: 12px;">
<div class="btn" id="copiarModalGer" style="display:none"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>Só gerencial</div><div class="btn" id="copiarModalSemItens" style="display:none"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Sem itens</div><div class="btn" id="copiarModal" style="display:none"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/><line x1="13" y1="14" x2="17" y2="14"/><line x1="13" y1="17" x2="17" y2="17"/></svg>Com itens</div>
<div class="btn" id="fechar"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Fechar</div>
</div>
</div>
<div class="mbody" id="mBody"></div>
</div>
</div>
<div class="ov sheet" id="ovVend" aria-hidden="true">
<div class="modal vendModal" role="dialog" aria-modal="true">
<div class="mhead">
<div>
<div class="mtitle">Filtrar por vendedor</div>
<div class="msub">Selecione um vendedor para filtrar as vendas exibidas.</div>
</div>
<div class="btn" id="vendFechar"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Fechar</div>
</div>
<div class="mbody">
<input id="vendQ" class="input vendQ" placeholder="Buscar vendedor..." autocomplete="off">
<div class="list" id="listaVend"></div>
</div>
</div>
</div>

<div class="ov sheet" id="ovAcoes" aria-hidden="true">
<div class="modal acoesModal" role="dialog" aria-modal="true">
<div class="mhead">
<div>
<div class="mtitle">Ferramentas de cópia</div>
<div class="msub">Copie dados das vendas filtradas para a área de transferência.</div>
</div>
<div class="btn" id="acoesFechar"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Fechar</div>
</div>
<div class="mbody acoesBody">
<button class="btn btnAcao" id="aCopiarTudo" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copiar tudo</button>
<button class="btn btnAcao" id="aCopiarTudoItens" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/><line x1="13" y1="14" x2="17" y2="14"/><line x1="13" y1="17" x2="17" y2="17"/></svg>Copiar tudo + itens</button>
<button class="btn btnAcao" id="aCopiarSemDinheiro" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>Copiar sem dinheiro</button>
<button class="btn btnAcao" id="aCopiarGerencial" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>Copiar só gerencial</button>
<button class="btn btnAcao" id="aProibidos" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>Editar lista de proibidos</button>
<button class="btn btnAcao" id="aVendedores" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>Filtrar por vendedor</button>
<button class="btn btnAcao" id="aAjuda" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".5" fill="currentColor" stroke="none"/></svg>Ajuda — coringas de busca</button>
<button class="btn btnAcao" id="aLimpar" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>Limpar filtros</button>
</div>
</div>
</div>
<div class="mobileBar" id="mobileBar">
<button class="btn mbBtn" id="mbCopiar" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copiar</button>
<button class="btn mbBtn" id="mbItens" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>+ Itens</button>
<button class="btn mbBtn mbMais" id="mbMais" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>Mais</button>
</div>
<script id="dados" type="application/json">${dadosJSON}</script>
<script>
const qs = s => document.querySelector(s);
// Duração do toast (ms) — lida do config.json no momento da geração
const __TOAST_DURACAO__ = ${cfgToastDuracao};
// Envia erros JS ao servidor para registro em relatorio.log
// ── Tooltip customizado ─────────────────────────────────────────────────────
// Substitui o tooltip nativo do browser (feio, sem estilo) por um flutuante
// moderno. Usa [data-tip] como atributo de dados — não polui o title nativo.
// Funciona com delegação no document: sem listeners por elemento.
(function(){
    var _tip = null, _tid = 0, _cur = null;

    function _create(){
        if (_tip) return;
        _tip = document.createElement("div");
        _tip.id = "__tip";
        document.body.appendChild(_tip);
    }

    function _show(el, txt){
        _create();
        _tip.textContent = txt;
        _tip.style.display = "block";
        _tip.classList.remove("on");

        // Posiciona abaixo/acima do elemento sem sair da viewport
        var r   = el.getBoundingClientRect();
        var vw  = window.innerWidth;
        var vh  = window.innerHeight;
        var tw  = Math.min(280, vw - 24);
        _tip.style.maxWidth = tw + "px";

        // Calcula posição X (centralizado no elemento, dentro da viewport)
        var left = r.left + r.width / 2 - _tip.offsetWidth / 2;
        left = Math.max(12, Math.min(left, vw - _tip.offsetWidth - 12));

        // Prefere abaixo; se não cabe, vai acima
        var top;
        var below = r.bottom + 8;
        if (below + _tip.offsetHeight < vh - 12) {
            top = below;
        } else {
            top = r.top - _tip.offsetHeight - 8;
        }
        top = Math.max(8, top);

        _tip.style.left = left + "px";
        _tip.style.top  = top  + "px";

        // Anima entrada
        requestAnimationFrame(function(){ _tip.classList.add("on"); });
    }

    function _hide(){
        if (!_tip) return;
        _tip.classList.remove("on");
    }

    // Encontra o ancestral mais próximo com [data-tip]
    function _find(target){
        var el = target;
        while (el && el !== document.body){
            if (el.hasAttribute && el.hasAttribute("data-tip")) return el;
            el = el.parentElement;
        }
        return null;
    }

    document.addEventListener("mouseover", function(e){
        var el = _find(e.target);
        if (!el || el === _cur) return;
        var tipTxt = el.getAttribute("data-tip");
        if (!tipTxt) return; // data-tip vazio ou ausente — não exibe tooltip
        _cur = el;
        clearTimeout(_tid);
        _tid = setTimeout(function(){ _show(el, tipTxt); }, 400);
    }, true);

    document.addEventListener("mouseout", function(e){
        var el = _find(e.target);
        if (!el) return;
        // Só oculta se o mouse saiu de fato (não foi para filho)
        if (el.contains(e.relatedTarget)) return;
        _cur = null;
        clearTimeout(_tid);
        _hide();
    }, true);

    // Teclado e scroll ocultam o tooltip
    document.addEventListener("keydown",  function(){ clearTimeout(_tid); _hide(); _cur = null; }, true);
    document.addEventListener("scroll",   function(){ clearTimeout(_tid); _hide(); _cur = null; }, true);
    document.addEventListener("mousedown",function(){ clearTimeout(_tid); _hide(); _cur = null; }, true);
})();
// ────────────────────────────────────────────────────────────────────────────

window.onerror=function(msg,src,line,col,err){
  try{fetch('/api/log-error',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({msg:String(msg),src:String(src||''),line:line,col:col,stack:err&&err.stack?String(err.stack):''})});}catch(_){}
};
window.onunhandledrejection=function(ev){
  try{var r=ev&&ev.reason;fetch('/api/log-error',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({msg:'UnhandledRejection: '+String(r&&r.message||r),stack:r&&r.stack?String(r.stack):''})});}catch(_){}
};
const dadosEl = qs("#dados");
let DADOS;
if (dadosEl) {
  try {
    DADOS = JSON.parse(dadosEl.textContent || "{}");
  } catch(e) {
    // LOGA os primeiros caracteres para inspecionar o que veio!
    console.error("Erro no parse do bloco <script id='dados'>:", (dadosEl.textContent||"").slice(0,80));
    throw e;
  }
} else {
  DADOS = {};
}
if(!Array.isArray(DADOS.vendas))DADOS.vendas=[];
if(!Array.isArray(DADOS.vendedores))DADOS.vendedores=[];
if(!Array.isArray(DADOS.vendTotaisDia))DADOS.vendTotaisDia=[];

// ── Dedup cliente: pares modelo=99 ("Dinheiro NF-e") + modelo=55 mesmo número ──
// O Node.js agrupa por chave exata — se o número vem zerado de um lado e sem zeros
// do outro, os dois chegam ao cliente separados. Corrige aqui antes de renderizar.
{
  const _nfeMap = new Map(); // numero normalizado → índice da entrada modelo=55
  DADOS.vendas.forEach((v, i) => {
    if (Number(v?.modelo) === 55 && !v.is_recebimento) {
      const _n = String(v.numero || "").replace(/^0+/, "") || "0";
      _nfeMap.set(_n, i);
    }
  });
  const _remover = new Set();
  DADOS.vendas.forEach((v, i) => {
    if (Number(v?.modelo) !== 99) return;
    const _pag = String(v.pagamentos || "").toLowerCase();
    if (!_pag.includes("nf-e") && !_pag.includes("nfe")) return;
    const _n = String(v.numero || "").replace(/^0+/, "") || "0";
    const iReal = _nfeMap.get(_n);
    if (iReal !== undefined && iReal !== i) {
      // Mescla dados úteis do stub (99) na entrada real (55)
      const real = DADOS.vendas[iReal];
      if (!real.vendedor || real.vendedor === "(sem vendedor)" || real.vendedor === "?") {
        if (v.vendedor && v.vendedor !== "(sem vendedor)" && v.vendedor !== "?") real.vendedor = v.vendedor;
      }
      _remover.add(i);
    }
  });
  if (_remover.size > 0) {
    DADOS.vendas = DADOS.vendas.filter((_, i) => !_remover.has(i));
  }
}

if(!DADOS.totais||typeof DADOS.totais!=="object")DADOS.totais={qtd:DADOS.vendas.length,total:DADOS.vendas.reduce((a,b)=>a+Number(b?.total||0),0)};
if(typeof DADOS.totais.qtd!=="number")DADOS.totais.qtd=DADOS.vendas.length;
if(typeof DADOS.totais.total!=="number")DADOS.totais.total=DADOS.vendas.reduce((a,b)=>a+Number(b?.total||0),0);

const fmt=v=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(v||0));
// Valor sem símbolo de moeda — usado na exibição de formas no modal
const fmtN=v=>new Intl.NumberFormat("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v||0));
const fmtCopia=v=>new Intl.NumberFormat("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:false}).format(Number(v||0));
const esc=s=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

const temasOpcoes = ["ultra-dark", "dark", "light"];
const _salvarTema = (t) => {
    try { localStorage.setItem("fdb_theme", t); } catch(e) {}
    try { document.cookie = "fdb_theme=" + t + ";path=/;max-age=31536000;SameSite=Strict"; } catch(e) {}
    document.documentElement.setAttribute("data-theme", t);
};
const btnTema = qs("#btnTema");
if(btnTema) {
    btnTema.addEventListener("click", () => {
        let temaAtual = localStorage.getItem("fdb_theme") || (document.cookie.match(/fdb_theme=([^;]+)/)||[])[1] || "ultra-dark";
        let proximoTema = temasOpcoes[(temasOpcoes.indexOf(temaAtual) + 1) % temasOpcoes.length];
        _salvarTema(proximoTema);
        toast("Tema Alterado", proximoTema === "light" ? "Modo Claro" : (proximoTema === "dark" ? "Modo Dark Original" : "Modo Ultra Dark"));
    });
}

const rmAcento=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"");
const normP=v=>rmAcento(v).trim().toUpperCase().replace(/\s+/g," ");

for(let i=0; i<DADOS.vendas.length; i++){
    const x = DADOS.vendas[i];
    x._idx = i;
    // _busca inclui cliente e natureza para pesquisa full-text
    x._busca = rmAcento((x.vendedor||"")+" "+(x.tipo||"")+" "+(x.pagamentos||"")+" "+(x.itens||"")+" "+(x.caixa||"")+" "+(x.numero||"")+" "+(x.cliente||"")+" "+(x.natureza||"")).toLowerCase();
}

const LS_KEY="__cupons_proibidos__";
const proibidosPadrao=["FARO","BIOFRESH","OPTIMUM","CIBAU","ATACAMA","GOLDEN","PIPICAT","SYNTEC","MITZI","ND CAES","ND GATOS","GRANPLUS","PEDIGREE","WHISKAS","PREMIER","GUABI","NATURAL CAES","NATURAL GATOS","PUTZ","GRANEL","ELANCO","VET LIFE","VETLIFE","KONIG","SAN REMO","SANREMO","FN CAE","FN CAO","FN GATO","FN VET","ORIGENS","FUNNY BUNNY","FUNNY BIRDY","SANOL","KELDOG","KDOG","MAGNUS","MAGNO","GENIAL","CANISTER","NATURAL SACHE, FN COOKIES, KITEKAT"];
const PROIB_FIXOS=["DESCONTO","<CANCELADO>","CANCELADO", "ACRÉSCIMO", "ACR�SCIMO" ];
const PROIB_FIXOS_N=new Set(PROIB_FIXOS.map(normP));
const uniq=a=>[...new Set(a)];
const escRe=s=>String(s||"").replace(/[-\/\\^$*+?.()|[\]{}]/g,"\\$&");

// Detecta se uma entrada proibida é um filtro de valor (ex: >100, <50, >=200, =7000>150)
const _reValorProib = /^(>=|<=|>|<)[0-9]/;
const _isValorProib = v => {
    const s = String(v||"").trim();
    return _reValorProib.test(s) || /^\d[\d\.,]*$/.test(s);
};

// Verifica se um valor numérico bate com um filtro de valor de proibido
const _valorBateProib=(expr,total)=>{
    const s=String(expr||"").trim();
    // Suporte a combinações: ex "=7000>150" (soma alvo E valor mínimo)
    // ou ">100=6578,96" (maior que 100 E próximo de 6578,96)
    const partes=s.split(/(?=[>=<])/g).filter(Boolean);
    for(const p of partes){
        const r=valorOk(p,total);
        if(r!==true)return false;
    }
    return true;
};

const lerProibidos=()=>{
    const raw=String(localStorage.getItem(LS_KEY)||"").trim();
    if(!raw)return proibidosPadrao.slice();
    let arr=[];
    if(raw.startsWith("[")){
        const ms=raw.match(/"([^"\\]*(?:\\.[^"\\]*)*)"/g);
        if(ms&&ms.length)arr=ms.map(s=>s.slice(1,-1).replace(/\\\"/g,'"'));
        else arr=raw.replace(/[\[\]"]/g,"").split(",");
    }else{
        arr=raw.split(/\n|,/g);
    }
    const limpo=uniq(arr.map(s=>s.trim()).filter(Boolean));
    return limpo.length?limpo:proibidosPadrao.slice();
};

let valoresProibidos=lerProibidos();
// Separa proibidos textuais dos filtros de valor
let _proibTextos=[];
let _proibValores=[];
let reProibidos=null;
const _recompileProibidos=()=>{
    _proibTextos=valoresProibidos.filter(v=>!_isValorProib(v)).map(normP).filter(Boolean);
    _proibValores=valoresProibidos.filter(_isValorProib);
    reProibidos=_proibTextos.length?new RegExp(_proibTextos.map(escRe).join("|"),"i"):null;
};
_recompileProibidos();

const setProibidosUser=(lista)=>{
    const limpo=uniq((lista||[]).map(s=>s.trim()).filter(Boolean));
    localStorage.setItem(LS_KEY,limpo.join('\n'));
    valoresProibidos=limpo.length?limpo:proibidosPadrao.slice();
    _recompileProibidos();
};

// Sincroniza proibidos com o servidor (GET /api/proibidos → sobrescreve localStorage)
(function _syncProibidos(){
    try{
        fetch('/api/proibidos',{cache:'no-store'})
        .then(r=>r.json())
        .then(d=>{
            if(Array.isArray(d.proibidos)&&d.proibidos.length){
                setProibidosUser(d.proibidos);
            }
        }).catch(()=>{});
    }catch(e){}
})();

const __ncToastMsgs=new Set();
// Inicializa __TOAST_MS com o valor embutido na geração do HTML (config.json → toastDuracao).
// Pode ser sobrescrito pelo modal de configurações sem recarregar a página.
window.__TOAST_MS = (typeof __TOAST_DURACAO__==="number" && __TOAST_DURACAO__>=500) ? __TOAST_DURACAO__ : 5000;
const showToast=msg=>{
    if(!msg||__ncToastMsgs.has(msg))return;
    __ncToastMsgs.add(msg);
    if(!document.getElementById("__nc_toast_css")){
        const st=document.createElement("style");
        st.id="__nc_toast_css";
        st.textContent=".__nc_toast_box{position:fixed;top:16px;left:16px;z-index:2147483647!important;display:flex;flex-direction:column;gap:10px;pointer-events:none} .__nc_toast{pointer-events:auto;background:var(--bg-panel);border:1px solid var(--border-focus);box-shadow:var(--shadow-lg);color:var(--text-main);border-radius:var(--radius-md);padding:12px 34px 12px 14px;font-family:'Inter',sans-serif;font-weight:600;font-size:13px;opacity:0;transform:translateY(-10px);transition:all .3s ease;overflow:hidden;position:relative} .__nc_toast.__on{opacity:1;transform:translateY(0)} .__nc_toast_x{position:absolute;top:10px;right:10px;width:20px;height:20px;border-radius:10px;background:transparent;border:none;color:var(--text-muted);cursor:pointer;font-weight:bold} .__nc_toast_x:hover{color:var(--text-main);background:var(--border)} .__nc_toast_bar{position:absolute;left:0;bottom:0;height:3px;width:100%;background:linear-gradient(90deg,var(--accent),#0ea5e9);transform-origin:left} @keyframes __nc_toast_bar_anim{to{transform:scaleX(0)}}";
        document.head.appendChild(st);
    }
    let box=qs(".__nc_toast_box");
    if(!box){box=document.createElement("div");box.className="__nc_toast_box";document.body.appendChild(box);}
    const el=document.createElement("div");
    el.className="__nc_toast";
    const durMs=Math.max(500,Number(window.__TOAST_MS)||5000);
    const barStyle="animation:__nc_toast_bar_anim "+durMs+"ms linear forwards";
    const _escT=s=>String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    el.innerHTML='<div>'+_escT(msg)+'</div><button class="__nc_toast_x"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button><div class="__nc_toast_bar" style="'+barStyle+'"></div>';
    const rm=()=>{if(el.isConnected){el.remove();__ncToastMsgs.delete(msg);}};
    el.querySelector("button").addEventListener("click",rm);
    box.appendChild(el);
    requestAnimationFrame(()=>el.classList.add("__on"));
    setTimeout(rm,durMs);
};
const toast=(titulo,desc)=>{ showToast(titulo&&desc?(titulo+" — "+desc):(titulo||desc)); };

const limparItensVisuais=it=>{
    const s=String(it||"");
    if(!s)return"";
    const linhas=s.split(/\n+/g).map(p=>String(p||"").trim()).filter(Boolean);
    const lim=[];
    for(let p of linhas){
        p=p.replace(/^⤷\s*/,"").replace(/^╰┈/,"").trim();
        let linha=p.replace(/^\s+/,"");
        const mm=linha.match(/^(\d+[\d,]*x)\s*(.*)$/i);
        if(mm)linha=(mm[1]+" "+(mm[2]||"")).trim();
        const base=normP(linha.replace(/^\d+[\d,]*x\s*/i,"").trim());
        if(PROIB_FIXOS_N.has(base))continue;
        lim.push("⤷ "+linha);
    }
    return lim.join("\n");
};

const numQtd=s=>{
    s=String(s||"").trim().replace(/\s+/g,"").replace(/\./g,"").replace(",",".");
    const n=Number(s);
    return Number.isFinite(n)?n:0;
};
const fmtQtdUI=n=>{
    const v=Number(n||0);
    if(!Number.isFinite(v)||v<=0)return"1";
    const r=Math.round(v);
    if(Math.abs(v-r)<1e-9)return String(r);
    let s=v.toFixed(3).replace(/0+$/,"").replace(/\.$/,"");
    return s.replace(".",",");
};

const agruparItensUI=it=>{
    const t=String(limparItensVisuais(it)||"").trim();
    if(!t)return{total:0,unicos:0,itens:[]};
    const linhas=t.split(/\n+/g).map(s=>String(s||"").replace(/^⤷\s*/,"").trim()).filter(Boolean);
    let total=0;
    const mp=new Map();
    for(let l of linhas){
        if(!l||l==="…"||l==="...")continue;
        let nome=l;
        let qtd=1;
        const mm=l.match(/^(\d+(?:[\.,]\d+)?)x\s*(.*)$/i);
        if(mm){
            qtd=numQtd(mm[1]);
            nome=String(mm[2]||"").trim()||nome;
            if(!qtd)qtd=1;
        }
        // GRANEL é vendido por peso/medida — conta como 1 unidade no total
        // independentemente da quantidade decimal (ex: 1,045x GRANEL conta como 1)
        const isGranel=/granel/i.test(nome);
        total += isGranel ? 1 : qtd;
        const k=normP(nome);
        if(!k)continue;
        if(!mp.has(k))mp.set(k,{nome:nome,qtd:0});
        mp.get(k).qtd+=qtd;
    }
    const itens=[...mp.values()].sort((a,b)=>a.nome.localeCompare(b.nome,"pt-BR",{sensitivity:"base"})).map(o=>({nome:o.nome,qtd:fmtQtdUI(o.qtd)+"x"}));
    return{total:fmtQtdUI(total),unicos:itens.length,itens:itens};
};

const itensMiniHTML=(it,grande)=>{
    const g=agruparItensUI(it);
    if(!g.itens.length)return"";
    let chips="";
    for(const x of g.itens)chips+='<span class="itensChip"><span class="itensQtd mono">'+esc(x.qtd)+'</span>'+esc(x.nome)+'</span>';
    return '<div class="itensMini'+(grande?' big':'')+'"><div class="itensMiniHead mono"><span class="sub">'+esc(g.total+" total • "+g.unicos+" únicos")+'</span></div><div class="itensChips">'+chips+'</div></div>';
};
const MAX_ITENS_TD = 3; // Máximo de chips visíveis na célula da tabela

const itensTdHTML=itensRaw=>{
    const t=String(limparItensVisuais(itensRaw)||"").trim();
    if(!t)return{html:"",title:""};
    const linhas=t.split(/\n+/g).map(s=>String(s||"").replace(/^⤷\s*/,"").trim()).filter(Boolean);
    const tituloPartes=[];
    // Monta chips — limita a MAX_ITENS_TD visíveis, resto mostrado no modal ao clicar
    let html='<div class="tdItemsWrap">';
    const visiveis = linhas.slice(0, MAX_ITENS_TD);
    const extras   = linhas.length - visiveis.length;
    for(const l of visiveis){
        const mm=l.match(/^(\d+(?:[,\.]\d+)?)x\s+(.+)$/i);
        if(mm){
            const qtd=mm[1].replace(".",",");
            const nome=String(mm[2]||"").trim();
            html+='<span class="tdItemChip"'+(nome?' data-tip="'+esc(nome)+'"':'')+'>'+
                  '<span class="tdItemQtd mono">'+esc(qtd+"x")+'</span>'+esc(nome)+'</span>';
            tituloPartes.push(qtd+"x "+nome);
        }else{
            html+='<span class="tdItemChip">'+esc(l)+'</span>';
            tituloPartes.push(l);
        }
    }
    if(extras>0){
        // Chip de ellipsis — informa que há mais itens visíveis no modal
        html+='<span class="tdItemChip tdItemMais" data-tip="'+extras+' itens adicionais — clique para ver todos">+'+extras+' mais…</span>';
    }
    html+='</div>';
    return{html,title:tituloPartes.join(" • ")};
};

const semWS=s=>{
    let o="";
    for(const ch of String(s||"")){
        const c=ch.charCodeAt(0);
        if((c>32&&c!==160)||ch===","||ch==="."||ch==="-"||ch==="+"||ch==="*"||ch==="/"||ch==="?"||ch==="="||((ch>="0"&&ch<="9")))o+=ch;
    }
    return o;
};
const soNumeroBr=raw=>{
    let t=semWS(raw||"").toUpperCase();
    if(t.startsWith("R$"))t=t.slice(2);
    let x="";
    for(const ch of t)if((ch>="0"&&ch<="9")||ch===","||ch==="."||ch==="-")x+=ch;
    if(!x)return null;
    if(x.indexOf(",")>=0){ x=x.split(".").join("").replace(",","."); }
    else{ const p=x.split("."); if(p.length>1){ const l=p[p.length-1]||""; if(p.length>2||l.length===3)x=p.join(""); } }
    const n=Number(x); return Number.isFinite(n)?n:null;
};
const limparPadraoValor=p=>{ let o=""; for(const ch of semWS(p)){ if((ch>="0"&&ch<="9")||ch==="*"||ch==="/"||ch==="?"||ch===","||ch===".")o+=ch; } return o.split(".").join(""); };
const temDigito=s=>{ for(const ch of s)if(ch>="0"&&ch<="9")return true; return false; };
const consultaPareceValor=raw=>{
    const s=String(raw||"").trim();
    if(!s||s.startsWith("="))return false;
    const sx=semWS(s).toUpperCase();
    if(!sx)return false;
    if(sx.startsWith(">=")||sx.startsWith("<=")||sx.startsWith(">")||sx.startsWith("<"))return true;
    if(sx.startsWith("R$")||sx.indexOf(",")>=0)return true;
    if((sx.indexOf("*")>=0||sx.indexOf("/")>=0||sx.indexOf("?")>=0)&&temDigito(sx))return true;
    const dash=sx.indexOf("-");
    if(dash>0&&dash<sx.length-1&&temDigito(sx))return true;
    if(/^\d+$/.test(sx)&&sx[0]!=="0"&&sx.length<=4)return true;
    return false;
};

const parseBusca=raw=>{
    const s=String(raw||"").trim().replace(/\[1p\]/gi,"[proibidos]").replace(/\[-p\]/gi,"[-proibidos]");
    if(!s)return{inc:"",ign:[],proibidos:false,proibidosModo:0};
    let inc=s,ign=[],proibidos=false,proibidosModo=0,temColchetes=false,mm;
    const rx=/\[([^\]]*)\]/g;
    const pushTerm=t=>{
        t=String(t||"").trim().replace(/^"+|"+$/g,""); if(!t)return;
        const n=normP(t);
        if(n==="PROIBIDOS"){proibidos=true;proibidosModo=1;return;}
        if(n==="-PROIBIDOS"){proibidos=false;proibidosModo=2;return;}
        let modo="inc"; if(t[0]==="~"){modo="cont";t=t.slice(1).trim();}else if(t[0]==="="){modo="eq";t=t.slice(1).trim();}
        t=normP(t); if(t)ign.push({modo,t});
    };
    while((mm=rx.exec(s))){ temColchetes=true; for(const p of String(mm[1]||"").split(","))pushTerm(p); }
    const sl=s.toLowerCase(); if(sl.indexOf("[-proibidos]")>=0){proibidos=false;proibidosModo=2;}else if(sl.indexOf("[proibidos]")>=0){proibidos=true;proibidosModo=1;}
    if(temColchetes||proibidosModo)inc=inc.replace(/\[[^\]]*\]/g," ").trim();
    const m=inc.match(/^(.*)\((.*)\)\s*$/);
    if(m){ inc=String(m[1]||"").trim(); for(const p of String(m[2]||"").split(","))pushTerm(p); }
    return{inc:inc.trim(),ign,proibidos,proibidosModo};
};

const isDig=ch=>ch>="0"&&ch<="9";
const matchInicioFull=(pat,full)=>{
    const p=limparPadraoValor(pat); if(!p||!temDigito(p))return false;
    const s=String(full||""), comma=s.indexOf(",");
    const memo=new Map();
    const rec=(pi,si)=>{
        const key=pi+"|"+si; if(memo.has(key))return memo.get(key);
        if(pi>=p.length)return true; if(si>=s.length)return false;
        const ch=p[pi]; let ok=false;
        if(ch==="*"){
            let k=si; if(k<s.length&&(isDig(s[k])||s[k]===",")){ for(;k<s.length&&(isDig(s[k])||s[k]===",");k++)if(rec(pi+1,k+1)){ok=true;break;} }
        }else if(ch==="/"){
            if(!(comma>=0&&si>=comma)){ if(si<s.length&&isDig(s[si])){ let end=si; for(;end<s.length&&isDig(s[end])&&(comma<0||end<comma);end++){} for(let e=si+1;e<=end;e++)if(rec(pi+1,e)){ok=true;break;} } }
        }else if(ch==="?"){
            if(isDig(s[si])&&(comma<0||si<comma))ok=rec(pi+1,si+1);
        }else if(isDig(ch)||ch===","){
            if(s[si]===ch)ok=rec(pi+1,si+1);
        }else ok=rec(pi+1,si);
        memo.set(key,ok); return ok;
    };
    return rec(0,0);
};
const matchDentroInteiro=(pat,inteiro)=>{
    const p=limparPadraoValor(pat); if(!p||!temDigito(p))return false;
    let toks=""; for(const ch of p)if(isDig(ch)||ch==="/"||ch==="?")toks+=ch; if(!toks)return false;
    const s=String(inteiro||""); const memo=new Map();
    const rec=(pi,si)=>{
        const key=pi+"|"+si; if(memo.has(key))return memo.get(key);
        if(pi>=toks.length)return true; if(si>=s.length)return false;
        const ch=toks[pi]; let ok=false;
        if(ch==="/"){ let end=si; for(;end<s.length&&isDig(s[end]);end++){} for(let e=si+1;e<=end;e++)if(rec(pi+1,e)){ok=true;break;} }
        else if(ch==="?"){ ok=isDig(s[si])?rec(pi+1,si+1):false; }
        else{ ok=s[si]===ch?rec(pi+1,si+1):false; }
        memo.set(key,ok); return ok;
    };
    for(let start=0;start<s.length;start++)if(rec(0,start))return true;
    return false;
};

const valorOk=(q,total)=>{
    if(!Number.isFinite(total))return null;
    const raw=String(q||"").trim(); if(!raw)return null;
    const sx=semWS(raw).toUpperCase(); if(!sx||sx.startsWith("="))return null;
    const temCoringa=(sx.indexOf("*")>=0||sx.indexOf("/")>=0||sx.indexOf("?")>=0)&&temDigito(sx);
    const tStr=fmtCopia(total); const full=tStr, inteiro=full.split(",")[0]||full;
    if(temCoringa){
        const partes=sx.split("+").map(p=>p.trim()).filter(Boolean);
        for(const p of partes){
            if(p.indexOf("*")>=0){ if(matchInicioFull(p,full))return true; }
            else{ if(matchDentroInteiro(p,inteiro))return true; }
        }
        return false;
    }
    if(!temDigito(sx))return null;
    const ops=[">=","<=",">","<"];
    for(const op of ops)if(sx.startsWith(op)){
        const n=soNumeroBr(sx.slice(op.length)); if(n===null)return null;
        if(op===">")return total>n; if(op==="<")return total<n;
        if(op===">=")return total>=n; return total<=n;
    }
    const dash=sx.indexOf("-");
    if(dash>0&&dash<sx.length-1){
        const a=soNumeroBr(sx.slice(0,dash)), b=soNumeroBr(sx.slice(dash+1));
        if(a===null||b===null)return null;
        return total>=Math.min(a,b)&&total<=Math.max(a,b);
    }
    let qv=sx.startsWith("R$")?sx.slice(2):sx;
    qv=qv.replace(/[\.,]/g,""); const tv=tStr.replace(/[\.,]/g,"");
    if(!qv)return null; return tv.indexOf(qv)>=0;
};

const parseSomaQuery=raw=>{
    const s=semWS(String(raw||""));
    if(!s.startsWith("=")&&!s.match(/^(>=?)\d/))return null;
    // Suporta =ALVO>MIN ou =ALVO>=MIN: soma exata alvo com filtro mínimo por venda
    const mComMin=s.match(/^=([0-9,\.]+)(>=?)([0-9,\.]+)$/);
    if(mComMin){
        const alvo=soNumeroBr(mComMin[1]); if(alvo===null)return null;
        const minVal=soNumeroBr(mComMin[3]); if(minVal===null)return null;
        return{alvo, tol:0, minPorVenda:minVal, minOp:mComMin[2]};
    }
    // Suporta >MIN=ALVO ou >=MIN=ALVO (ordem invertida — equivalente ao anterior)
    // Ex: ">50=1200" → minPorVenda=50, alvo=1200
    const mMinFirst=s.match(/^(>=?)(\d[0-9,\.]*)=(\d[0-9,\.]*)$/);
    if(mMinFirst){
        const minVal=soNumeroBr(mMinFirst[2]); if(minVal===null)return null;
        const alvo=soNumeroBr(mMinFirst[3]);   if(alvo===null)return null;
        return{alvo, tol:0, minPorVenda:minVal, minOp:mMinFirst[1]};
    }
    if(!s.startsWith("="))return null;
    const body=s.slice(1); if(!body||body==="*")return null;
    const parts=body.split("*");
    const alvo=soNumeroBr(parts[0]); if(alvo===null)return null;
    const tol=parts.length>1?(soNumeroBr(parts[1])??0):0;
    return{alvo,tol,minPorVenda:null,minOp:null};
};

let vendAtual="",vendFiltro="",qAtual="",qInc="",qIgn=[],qValor=false,tipoBusca="todos",linhaAtual=null,somaSel=null,somaKey="";
const tipoLinhaOk=x=>{
    if(tipoBusca==="todos")return true;
    const m=Number(x&&x.modelo||0);
    if(tipoBusca==="gerencial")return m===99;
    if(tipoBusca==="nfce")    return m===65;
    if(tipoBusca==="nfe")     return m===55;
    return true;
};
const vendaTemProibido=x=>{
    // NF-e (modelo 55) não participa do filtro de proibidos — é documento fiscal diferente
    if(Number(x&&x.modelo||0)===55) return false;
    const total=Number(x&&x.total||0);
    if(reProibidos&&reProibidos.test(String(x?.itens||"")))return true;
    if(_proibValores.length){
        for(const expr of _proibValores){if(_valorBateProib(expr,total))return true;}
    }
    return false;
};

const calcSomaSel=()=>{
    const p=parseSomaQuery(qInc||qAtual);
    if(!p){somaSel=null;somaKey="";return;}
    const key=(vendAtual||"")+"|"+p.alvo+"|"+p.tol+"|"+(p.minPorVenda||"");
    if(key===somaKey&&somaSel)return;
    somaKey=key;
    const itens=[];
    for(let i=0;i<DADOS.vendas.length;i++){
        const x=DADOS.vendas[i];
        if(!tipoLinhaOk(x)||(vendAtual&&x.vendedor!==vendAtual))continue;
        const v=Number(x.total||0); if(!Number.isFinite(v)||v<=0)continue;
        // Filtra por valor mínimo por venda quando especificado (ex: =2200>150)
        if(p.minPorVenda!==null){
            const op=p.minOp||">";
            if(op===">="&&v<p.minPorVenda)continue;
            if(op===">"&&v<=p.minPorVenda)continue;
        }
        itens.push({i,v});
    }
    itens.sort((a,b)=>b.v-a.v);
    const sel=new Set(); let soma=0;
    const ex=itens.find(it=>Math.abs(it.v-p.alvo)<0.005);
    if(ex){sel.add(ex.i);soma=ex.v;}
    else{ const lim=p.alvo+p.tol+0.005; for(const it of itens)if(soma+it.v<=lim){soma+=it.v;sel.add(it.i);} }
    somaSel={alvo:p.alvo,tol:p.tol,soma,sel};
};

const passaFiltroFast = (x, i, ctx) => {
    if (!ctx.tipoOk(x)) return false;
    if (ctx.vend && x.vendedor !== ctx.vend) return false;
    const pm = ctx.pm;
    if (pm !== 0 && Number(x && x.modelo || 0) === 55) return false;
    if (pm === 1 && vendaTemProibido(x)) return false;
    if (pm === 2 && !vendaTemProibido(x)) return false;

    const ign = ctx.ign;
    let hayN = "", toks = null;
    if (ign.length) {
        hayN = normP(x._busca + " " + String(x.total || ""));
        toks = hayN.split(" ").filter(Boolean);
        for (const o of ign) {
            const term = normP(o?.t || ""); if (!term) continue;
            if (o.modo === "eq") { if (hayN === term || toks.includes(term) || normP(x.vendedor||"") === term || normP(x.pagamentos||"") === term || normP(x.caixa||"") === term || normP(x.numero||"") === term || normP(String(x.total||"")) === term || normP(String(x.itens||"")) === term) return false; }
            else if (o.modo === "cont") { if (hayN.indexOf(term) >= 0) return false; }
            else { if (toks.includes(term)) return false; }
        }
    }
    const q = ctx.q;
    if (!q) return true;
    const _qs = semWS(q);
    const _ehSoma = _qs.startsWith("=") || (/^>=?\d/.test(_qs) && _qs.indexOf("=") > 0) || /^>=?[\d,\.]+=[\d]/.test(_qs);
    if (_ehSoma) return !!(somaSel && somaSel.sel && somaSel.sel.has(i));

    const parts = q.split("+").map(v => String(v || "").trim()).filter(Boolean);
    const incParts = [], excParts = [];
    for (const part of parts) {
        if (part[0] === "-" && part.length > 1) { excParts.push(part.slice(1).trim()); }
        else {
            let splitIdx = -1;
            for (let ci = 1; ci < part.length; ci++) { if (part[ci] === "-" && !/\d/.test(part[ci+1] || "")) { splitIdx = ci; break; } }
            if (splitIdx > 0) { const base = part.slice(0, splitIdx).trim(); const rest = part.slice(splitIdx+1); if (base) incParts.push(base); for (const ex of rest.split("-").map(s => s.trim()).filter(Boolean)) excParts.push(ex); }
            else incParts.push(part);
        }
    }
    const totalNum = Number(x.total || 0);
    if (excParts.length) {
        if (!toks) { hayN = normP(x._busca + " " + String(x.total || "")); toks = hayN.split(" ").filter(Boolean); }
        for (const ex of excParts) {
            let et = String(ex || "").trim(); if (!et) continue;
            let modo = "tok"; if (et[0] === "~") { modo = "cont"; et = et.slice(1).trim(); } else if (et[0] === "=") { modo = "eq"; et = et.slice(1).trim(); }
            if (!et) continue;
            if (consultaPareceValor(et)) { if (valorOk(et, totalNum) === true) return false; }
            else { const term = normP(et); if (!term) continue; if (modo === "eq") { if (!toks) { hayN = normP(x._busca+" "+String(x.total||"")); toks = hayN.split(" ").filter(Boolean); } if (hayN === term || toks.includes(term)) return false; } else if (modo === "cont") { if (!hayN) hayN = normP(x._busca+" "+String(x.total||"")); if (hayN.indexOf(term) >= 0) return false; } else { if (!toks) { hayN = normP(x._busca+" "+String(x.total||"")); toks = hayN.split(" ").filter(Boolean); } if (toks.includes(term)) return false; } }
        }
    }
    if (!incParts.length) return true;

    // Busca por "caixa64", "caixa064", "caixa 64" etc. (portado da versão anterior)
    if (incParts.length === 1) {
        const q1 = String(incParts[0] || "").trim();
        if (/^caixa\s*\d{1,3}$/i.test(q1)) {
            const cx = q1.match(/^caixa\s*(\d{1,3})$/i);
            return cx ? String(x.caixa||"").padStart(3,"0") === String(cx[1]).padStart(3,"0") : false;
        }
        // Fast path: _busca já contém os campos normalizados concatenados
        const camposTxt = x._busca;
        const ql = rmAcento(q1).toLowerCase();
        if (camposTxt.indexOf(ql) >= 0) {
            // Se a query parece valor, exige que seja em campos textuais (não só no total)
            if (consultaPareceValor(q1)) {
                return rmAcento(x.vendedor||"").toLowerCase().indexOf(ql) >= 0
                    || rmAcento(x.pagamentos||"").toLowerCase().indexOf(ql) >= 0
                    || rmAcento(x.itens||"").toLowerCase().indexOf(ql) >= 0
                    || rmAcento(x.caixa||"").toLowerCase().indexOf(ql) >= 0
                    || valorOk(q1, totalNum) === true;
            }
            return true;
        }
        return valorOk(q1, totalNum) === true;
    }

    if (!hayN) { hayN = normP(x._busca + " " + String(x.total || "")); toks = hayN.split(" ").filter(Boolean); }
    for (const inc of incParts) {
        let it = String(inc || "").trim(); if (!it) continue;
        let modo = "tok"; if (it[0] === "~") { modo = "cont"; it = it.slice(1).trim(); } else if (it[0] === "=") { modo = "eq"; it = it.slice(1).trim(); }
        if (!it) continue;
        if (consultaPareceValor(it)) { if (valorOk(it, totalNum) !== true) return false; }
        else { const term = normP(it); if (!term) continue; if (modo === "eq") { if (hayN !== term && !toks.includes(term) && normP(x.vendedor||"") !== term && normP(x.pagamentos||"") !== term && normP(x.caixa||"") !== term && normP(x.numero||"") !== term && normP(String(x.total||"")) !== term && normP(String(x.itens||"")) !== term) return false; } else if (modo === "cont") { if (hayN.indexOf(term) < 0) return false; } else { if (!toks.includes(term)) return false; } }
    }
    return true;
};

// passaFiltro: wrapper com contexto montado a partir do estado global.
// Usado por calcSomaSel, montarTextoCopia e filtros de copiar.
const passaFiltro = (x, i) => {
    const raw = String(qAtual || "").trim();
    const p = parseBusca(raw);
    return passaFiltroFast(x, i, {
        tipoOk: tipoLinhaOk, vend: vendAtual,
        pm: p.proibidosModo || 0, ign: p.ign || [],
        q: String(p.inc || "").trim()
    });
};

const limparPagamentoCopia=p=>String(p||"").split("|").map(s=>s.trim().replace(/^cartao(?: +|$)/i,"").trim()).filter(Boolean).join(" | ");
const formasDe=x=>limparPagamentoCopia(x.pagamentos||"").split("|").map(s=>normP(s)).filter(Boolean);
const temDinheiro=x=>formasDe(x).includes("DINHEIRO");

const montarTextoCopia=(ignorarDinheiro,ignorarProibidos)=>{
    const filtradas=DADOS.vendas.filter((x,i)=>passaFiltro(x,i)).filter(x=>(!ignorarDinheiro||!temDinheiro(x))&&(!ignorarProibidos||!vendaTemProibido(x)));
    const montarBloco=(nome,arr)=>{
        let out=nome+":\n";
        for(const x of arr)out+=String(x.numero||"")+"\t"+fmtCopia(x.total||0)+"\t"+limparPagamentoCopia(x.pagamentos||"")+"\n";
        return out.trim();
    };
    if(vendAtual)return montarBloco(vendAtual,filtradas);
    const map=new Map();
    for(const x of filtradas){ const v=x.vendedor||"(sem vendedor)"; if(!map.has(v))map.set(v,[]); map.get(v).push(x); }
    const vendes=[...map.keys()].sort((a,b)=>a.localeCompare(b,"pt-BR",{sensitivity:"base"}));
    let out=""; for(const v of vendes)out+=montarBloco(v,map.get(v))+"\n\n";
    return out.trim();
};

const linhaCopiaItens=x=>{
    const t=String(limparItensVisuais(x?.itens)||"").trim();
    let itens="";
    if(t){
        const linhas=t.split(/\n+/g).map(s=>String(s||"").replace(/^⤷\s*/,"").trim()).filter(Boolean);
        const seen=new Set(), out=[];
        for(let l of linhas){ l=l.replace(/^\d+[\d,]*x\s*/i,"").trim(); if(!l||l==="…"||l==="...")continue; const k=normP(l); if(!k||seen.has(k))continue; seen.add(k); out.push(l); }
        itens=out.join("╰─╮");
    }
    const forma=limparPagamentoCopia(x?.pagamentos||""), parts=forma.split("|").map(s=>normP(s)).filter(Boolean);
    const extraTab=(parts.includes("DEBITO")||parts.includes("PIX")||parts.includes("DINHEIRO"))?"\t":"";
    return String(x?.numero||"")+"\t"+fmtCopia(x?.total||0)+"\t"+forma+"\t"+extraTab+(itens||"");
};

// Linha de cópia sem itens — igual a linhaCopiaItens mas omite a coluna de itens
const linhaCopiaSemItens=x=>{
    const forma=limparPagamentoCopia(x?.pagamentos||"");
    const parts=forma.split("|").map(s=>normP(s)).filter(Boolean);
    const extraTab=(parts.includes("DEBITO")||parts.includes("PIX")||parts.includes("DINHEIRO"))?"\t":"";
    return String(x?.numero||"")+"\t"+fmtCopia(x?.total||0)+"\t"+forma+"\t"+extraTab;
};

const montarTextoCopiaItens=(ignorarDinheiro,ignorarProibidos)=>{
    const filtradas=DADOS.vendas.filter((x,i)=>passaFiltro(x,i)).filter(x=>(!ignorarDinheiro||!temDinheiro(x))&&(!ignorarProibidos||!vendaTemProibido(x)));
    const montarBloco=(nome,arr)=>{ let out=nome+":\n"; for(const x of arr)out+=linhaCopiaItens(x)+"\n"; return out.trim(); };
    if(vendAtual)return montarBloco(vendAtual,filtradas);
    const map=new Map();
    for(const x of filtradas){ const v=x.vendedor||"(sem vendedor)"; if(!map.has(v))map.set(v,[]); map.get(v).push(x); }
    const vendes=[...map.keys()].sort((a,b)=>a.localeCompare(b,"pt-BR",{sensitivity:"base"}));
    let out=""; for(const v of vendes)out+=montarBloco(v,map.get(v))+"\n\n";
    return out.trim();
};

const copiarTexto=txt=>{
    const fallback=()=>{
        const ta=document.createElement("textarea"); ta.value=txt; ta.setAttribute("readonly","");
        ta.style.cssText="position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
        document.body.appendChild(ta); if(ta.focus)ta.focus({preventScroll:true}); ta.select(); ta.setSelectionRange(0,ta.value.length);
        document.execCommand("copy"); ta.remove();
    };
    if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(txt).catch(fallback); else fallback();
};

// Cache imutável de HTML de itens por _idx (os dados nunca mudam após o load)
const _tdHtmlCache  = new Map();
const _miniHtmlCache= new Map();
const _tipoLabel = m => m===65?"NFC-e":m===55?"NF-e":"Gerencial";
const _buildRowTb = x => {
    if(!x) return "";
    if(!_tdHtmlCache.has(x._idx)){
        const itensInfo = itensTdHTML(x.itens);
        _tdHtmlCache.set(x._idx, itensInfo.html);
    }
    const iHtml = _tdHtmlCache.get(x._idx);
    const clienteTxt = x.cliente || (x.hora ? String(x.hora).substring(0,5) : "");
    const clienteTitle = x.cliente || "";
    return '<tr data-idx="'+x._idx+'">'
        +'<td>'+esc(x.vendedor||"")+'</td>'
        +'<td>'+esc(_tipoLabel(x.modelo))+'</td>'
        +'<td class="mono">'+esc(x.numero||"")+'</td>'
        +'<td class="mono"'+(clienteTitle?' data-tip="'+esc(clienteTitle)+'"':'')+' style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:130px">'+esc(clienteTxt)+'</td>'
        +'<td class="mono">'+esc(fmt(x.total||0))+'</td>'
        +'<td class="mono">'+esc(x.pagamentos||"")+'</td>'
        +'<td>'+iHtml+'</td>'
        +'</tr>';
};
const _buildRowCard = x => {
    if(!x) return "";
    if(!_miniHtmlCache.has(x._idx)){
        _miniHtmlCache.set(x._idx, itensMiniHTML(x.itens, false));
    }
    const iMini = _miniHtmlCache.get(x._idx);
    let meta = ""; if(!vendAtual) meta = String(x.vendedor||"");
    meta += (meta?" | ":"")+_tipoLabel(x.modelo);
    if(x.cliente) meta += (meta?" | ":"")+"Cliente: "+String(x.cliente).substring(0,30)+(x.cliente.length>30?"…":"");
    else if(x.hora) meta += (meta?" | ":"")+"Hora: "+String(x.hora||"").substring(0,5);
    if(x.caixa)  meta += (meta?" | ":"")+"Caixa: "+String(x.caixa||"");
    return '<div class="cardRow" data-idx="'+x._idx+'">'
        +'<div class="cardHead"><div class="cardNum mono">#'+esc(x.numero||"")+'</div>'
        +'<div class="cardTotal mono">'+esc(fmt(x.total||0))+'</div></div>'
        +(meta?('<div class="cardMeta mono">'+esc(meta)+'</div>'):"")
        +'<div class="cardPay mono">'+esc(x.pagamentos||"")+'</div>'
        +iMini+'</div>';
};

// ── Motor de renderização assíncrona ────────────────────────────────────────
// Filtro pré-calculado por render (não por item), chunks via setTimeout(0)
// para liberar o event loop entre fatias — elimina travamento em datasets grandes.
// ────────────────────────────────────────────────────────────────────────────
let _renderGen = 0;
const CHUNK_FIRST = 80;  // primeira fatia — renderizada de forma síncrona para resposta imediata
const CHUNK_REST  = 120; // fatias seguintes — agendadas via _sched

// Scheduler: setTimeout(0) libera o event loop entre fatias (melhor que RAF para datasets grandes).
// Em Chrome 94+ usa scheduler.postTask com prioridade "background" para ainda mais eficiência.
const _sched = typeof scheduler !== "undefined" && scheduler.postTask
    ? (fn) => scheduler.postTask(fn, { priority: "background" })
    : (fn) => setTimeout(fn, 0);

const renderTabela = () => {
    const tb    = qs("#tb");
    const cards = qs("#cards");

    // ── Contexto de filtro calculado UMA vez — não por item ──────────────────
    const raw = String(qAtual || "").trim();
    const p   = parseBusca(raw);
    const ctx = {
        tipoOk: tipoLinhaOk,
        vend:   vendAtual,
        pm:     p.proibidosModo || 0,
        ign:    p.ign || [],
        q:      String(p.inc || "").trim()
    };

    // ── Atualiza UI de estado (vendedor, contador etc.) ──────────────────────
    const tipoTxt = tipoBusca === "gerencial" ? "Gerencial" : tipoBusca === "nfce" ? "NFC-e" : tipoBusca === "nfe" ? "NF-e" : "Todos";
    qs("#sub").textContent = (vendAtual ? ("Vendedor: " + vendAtual) : "Todos os vendedores") + " • Tipo: " + tipoTxt;
    const vtxt = vendAtual || "Todos";
    qs("#vendSel").textContent = vtxt;
    const vt = qs("#vendTopTxt"); if (vt) vt.textContent = vtxt;
    const bv = qs("#btnVend");
    if (bv) bv.setAttribute("data-tip", vendAtual ? "Filtrado: " + vendAtual : "Filtrar por vendedor");

    const gen = ++_renderGen; // cancela renders anteriores pendentes

    // ── Filtra de forma não-bloqueante: fatias de CHUNK_FIRST ────────────────
    // Para datasets pequenos (<= 2×CHUNK_FIRST) faz tudo de uma vez (síncrono).
    // Para datasets grandes, faz a primeira fatia síncrona (para o usuário ver
    // resultado imediato) e agenda o restante com setTimeout(0).
    const dados = DADOS.vendas;
    const total_itens = dados.length;

    // Limpa tabela antes de começar a popular
    const _limparTabelas = () => {
        if (tb)    tb.innerHTML    = "";
        if (cards) cards.innerHTML = "";
    };

    const filtradas = [];
    let soma = 0, idx = 0;
    let hTb = "", hCards = "";
    const limit1 = Math.min(total_itens, CHUNK_FIRST * 3);

    // Fase 1 síncrona: primeiros CHUNK_FIRST matches (varre até 3× para preencher a tela)
    while (idx < total_itens && filtradas.length < CHUNK_FIRST) {
        const x = dados[idx];
        if (passaFiltroFast(x, idx, ctx)) {
            filtradas.push({ x, i: idx });
            hTb    += _buildRowTb(x);
            hCards += _buildRowCard(x);
            soma   += Number(x.total || 0);
        }
        idx++;
        if (idx >= limit1) break; // evita varrer tudo na fase síncrona
    }

    _limparTabelas();
    if (tb)    tb.innerHTML    = hTb;
    if (cards) cards.innerHTML = hCards;

    // Atualiza o contador com progresso (mostrado durante carregamento parcial)
    const _updateCount = (total_filtradas, soma_total, completo) => {
        const q2 = String(qAtual || "").trim();
        const _countEl = qs("#count");
        if (!_countEl) return;
        let txt;
        if (somaSel && q2.startsWith("=")) {
            txt = total_filtradas + " vendas ― soma " + fmt(soma_total) + " ― alvo " + fmt(somaSel.alvo) + (somaSel.tol ? (" ± " + fmt(somaSel.tol)) : "");
        } else {
            txt = total_filtradas + " vendas ― " + fmt(soma_total);
        }
        if (!completo && total_filtradas < DADOS.vendas.length) {
            // Mostra quantas já foram processadas e quantas ainda restam
            const restante = DADOS.vendas.length - total_filtradas;
            txt += "  <span style='font-size:11px;opacity:.55;font-weight:400'>(" + total_filtradas + " carregadas, " + restante + " restantes…)</span>";
            _countEl.innerHTML = txt;
        } else {
            _countEl.innerHTML = txt;
        }
    };
    _updateCount(filtradas.length, soma, idx >= total_itens);

    // Se já varreu tudo na fase 1, finaliza
    if (idx >= total_itens) return;

    // Fase 2 — continua filtrando e appendando em fatias assíncronas
    const appendFatia = (fromIdx) => {
        if (gen !== _renderGen) return;

        let hTb2 = "", hCards2 = "", added = 0;
        let i2 = fromIdx;
        while (i2 < total_itens && added < CHUNK_REST) {
            const x = dados[i2];
            if (passaFiltroFast(x, i2, ctx)) {
                filtradas.push({ x, i: i2 });
                hTb2    += _buildRowTb(x);
                hCards2 += _buildRowCard(x);
                soma    += Number(x.total || 0);
                added++;
            }
            i2++;
        }

        if (added > 0) {
            if (tb)    tb.insertAdjacentHTML("beforeend", hTb2);
            if (cards) cards.insertAdjacentHTML("beforeend", hCards2);
        }

        _updateCount(filtradas.length, soma, i2 >= total_itens);

        if (i2 < total_itens) _sched(() => appendFatia(i2));
    };

    _sched(() => appendFatia(idx));
};

const atualizarSelecaoVendedores=()=>{
    document.querySelectorAll('.item').forEach(el => {
        const nome = el.querySelector('.nome')?.textContent;
        if((!vendAtual && nome === "Todos") || (vendAtual && nome === vendAtual)) el.classList.add('sel');
        else el.classList.remove('sel');
    });
};

const renderLista=()=>{
    const base=DADOS.vendas.filter(tipoLinhaOk);
    const porVend=new Map();
    let qtdBase=0,totalBase=0;
    for(const x of base){
        const nome=String(x&&x.vendedor||"").trim()||"(sem vendedor)";
        if(!porVend.has(nome))porVend.set(nome,{vendedor:nome,qtd:0,total:0});
        const it=porVend.get(nome);
        it.qtd++; it.total+=Number(x&&x.total||0);
        qtdBase++; totalBase+=Number(x&&x.total||0);
    }
    const vendedores=[...porVend.values()].sort((a,b)=>a.vendedor.localeCompare(b.vendedor,"pt-BR",{sensitivity:"base"}));
    const mk=(root,apos,filtro)=>{
        if(!root)return;
        root.innerHTML="";
        const f=String(filtro||"").trim().toLowerCase();
        const add=(nome,qtd,total,sel,click)=>{
            const div=document.createElement("div");
            div.className="item"+(sel?" sel":"");
            div.addEventListener("click",()=>{click();if(apos)apos(); atualizarSelecaoVendedores();});
            div.innerHTML='<div class="nome">'+esc(nome)+'</div><div class="meta"><div class="qtd">Vendas: '+qtd+'</div><div class="tot">'+esc(fmt(total))+'</div></div>';
            root.appendChild(div);
        };
        add("Todos",qtdBase,totalBase,!vendAtual,()=>{vendAtual="";calcSomaSel();renderTabela();});
        for(const v of vendedores){
            if(f&&rmAcento(String(v.vendedor||"")).toLowerCase().indexOf(rmAcento(f))<0)continue;
            add(v.vendedor,v.qtd,v.total,vendAtual===v.vendedor,()=>{vendAtual=v.vendedor;calcSomaSel();renderTabela();});
        }
    };
    mk(qs("#lista"),null,"");
    mk(qs("#listaVend"),fecharVendedores,vendFiltro);
};

const renderResumoVend=()=>{
    const el=qs("#vendResumo"); if(!el)return;
    let head=el.querySelector(".sb-head");
    if(!head){ head=document.createElement("div"); head.className="sb-head"; head.innerHTML='<div class="sb-title">Total por vendedor</div>'; el.prepend(head); }
    let body=el.querySelector(".sbResumoBody");
    if(!body){ body=document.createElement("div"); body.className="sbResumoBody"; el.appendChild(body); }
    const arr=Array.isArray(DADOS.vendTotaisDia)?DADOS.vendTotaisDia:[];
    if(!arr.length){body.innerHTML='<div style="opacity:.75;padding:6px 2px">Sem dados hoje</div>';return;}
    let h="";
    for(const x of arr){
        const nome=String(x&&x.vendedor||"").trim()||"(sem vendedor)";
        const g=Number(x&&x.gerencial||0)||0, n=Number(x&&x.nfce||0)||0, t=(Number(x&&x.geral||0)||0)|| (g+n);
        h+='<div class="rv" data-tip="Gerencial: '+esc(fmt(g))+' · NFC-e: '+esc(fmt(n))+'"><div class="n">'+esc(nome)+':</div><div class="v">'+esc(fmt(t))+'</div></div>';
    }
    body.innerHTML=h;
};
const renderTudo=()=>{
    renderTabela();
    // Sidebar e resumo são menos urgentes — adiados para não disputar o thread
    // com a renderização da tabela principal
    _sched(()=>{ renderLista(); renderResumoVend(); });
};

const abrirModal=x=>{
    linhaAtual=x;
    const tipoLabel=_tipoLabel(x.modelo);
    qs("#mTitulo").textContent=tipoLabel+" "+(x.numero||"");
    qs("#mSub").textContent="Vendedor: "+(x.vendedor||"")+(x.caixa?(" | Caixa: "+x.caixa):"")+(x.cliente?(" | Cliente: "+x.cliente):"");
    const body=qs("#mBody"); body.innerHTML="";

    // mk — cria um kv compacto; data-tip é aplicado depois via JS (só se truncar)
    const mk=(k,v,extra)=>{
        const d=document.createElement("div"); d.className="kv kvCompact";
        const _vs=String(v??"");
        d.innerHTML='<div class="k">'+k+'</div><div class="v mono'+(extra?" "+extra:"")+'" data-fullval="'+esc(_vs)+'">'+esc(_vs)+'</div>';
        return d;
    };

    // Grid 2 colunas para os campos de info da venda (Tipo, Número, Hora, Total, etc.)
    const kvGrid=document.createElement("div"); kvGrid.className="kvCompactGrid";
    kvGrid.appendChild(mk("Tipo", tipoLabel));
    kvGrid.appendChild(mk("Número", String(x.numero||"")));
    if(x.modelo===55&&x.cliente) kvGrid.appendChild(mk("Cliente", x.cliente));
    if(x.modelo===55&&x.natureza) kvGrid.appendChild(mk("Natureza", x.natureza));
    if(x.caixa) kvGrid.appendChild(mk("Caixa", String(x.caixa||"")));
    if(x.hora)  kvGrid.appendChild(mk("Hora",  String(x.hora||"").substring(0,5)));
    kvGrid.appendChild(mk("Total", fmt(x.total||0)));
    // Formas: se tiver valores por forma, exibe "PIX: R$ X | Dinheiro: R$ Y"
    const _fv = x.formasValores || {};
    const _fvEntries = Object.entries(_fv).filter(([,v]) => Number(v) > 0);
    const _formasStr = (_fvEntries.length > 1 && x.modelo !== 55)
        ? _fvEntries.map(([f, v]) => f + ": " + fmtN(v)).join("  |  ")
        : String(x.pagamentos || "");
    kvGrid.appendChild(mk("Formas", _formasStr));
    body.appendChild(kvGrid);

    // kv de itens: ocupa o espaço restante com scroll interno + footer fixo (full width)
    const kv=document.createElement("div"); kv.className="kv kvItens kvCompact";
    kv.innerHTML='<div class="k">Itens</div><div class="v" style="overflow:hidden;min-height:0;display:flex;flex-direction:column;gap:0;"></div>';

    const _det = (x.itensDetalhe || []).filter(i => !i.cancelado);
    if (_det.length > 0) {
        let rows = "";
        let somaFinal = 0;
        let temPreco   = false;
        // Soma apenas os itens com valor positivo — base para calcular o % de cada desconto
        const somaPositiva = _det.reduce((acc, it) =>
            (it.total !== null && Number.isFinite(it.total) && it.total > 0)
                ? acc + it.total : acc, 0);
        for (const it of _det) {
            const _isDesc = it.total !== null && it.total < 0;
            if (it.total !== null && Number.isFinite(it.total)) { somaFinal += it.total; temPreco = true; }
            // Percentual de desconto relativo ao total dos itens positivos
            const _pctStr = (_isDesc && somaPositiva > 0)
                ? ' (' + Math.round(Math.abs(it.total) / somaPositiva * 100) + '%)'
                : '';
            const _precoCell = it.total !== null
                ? '<td class="ipreco'+(_isDesc?' desc':'')+'">'+(_isDesc?'−':'')+fmt(Math.abs(it.total))+_pctStr+'</td>'
                : '<td class="ipreco" style="color:var(--text-muted)">—</td>';
            // data-tip NÃO é definido aqui — só será adicionado via JS se o texto realmente truncar
            rows += '<tr>'
                + '<td class="iqtd">'+esc(it.qtd)+'×</td>'
                + '<td class="idesc" data-fulldesc="'+esc(it.desc)+'">'+esc(it.desc)+'</td>'
                + _precoCell
                + '</tr>';
        }

        // Scroll container para as linhas dos itens
        const scrollDiv = document.createElement("div");
        scrollDiv.className = "itensDetalheScroll";
        const tbl = document.createElement("table");
        tbl.className = "itensDetalheList";
        tbl.innerHTML = '<tbody>'+rows+'</tbody>';
        scrollDiv.appendChild(tbl);
        kv.lastChild.appendChild(scrollDiv);

        // Footer sempre visível com o total — fora do scroll
        if (temPreco) {
            const footDiv = document.createElement("div");
            footDiv.className = "itensDetalheFoot";
            footDiv.innerHTML = '<span class="ilabel">Total dos itens</span><span class="itotal mono">'+fmt(somaFinal)+'</span>';
            kv.lastChild.appendChild(footDiv);
        }
    } else {
        const fb = document.createElement("div");
        fb.style.cssText = "color:var(--text-muted);font-size:12px;padding:8px 0";
        fb.textContent = x.is_recebimento ? "Recebimento de Título / Conta" : "Sem itens registrados";
        kv.lastChild.appendChild(fb);
    }
    body.appendChild(kv);

    // Oculta botão gerencial em NF-e
    const bGer=qs("#copiarModalGer");
    if(bGer) bGer.style.display=(x.modelo===99)?"flex":"none";
    const b=qs("#copiarModal"); if(b)b.style.display="flex";
    const b2=qs("#copiarModalSemItens"); if(b2)b2.style.display="flex";
    qs("#ov").classList.add("on"); qs("#ov").setAttribute("aria-hidden","false");

    // Após o layout ser calculado: aplica data-tip SOMENTE onde o texto realmente trunca.
    // Para .idesc (nome do item) e para .v (valores do kv compacto).
    requestAnimationFrame(()=>{
        // Nomes de itens da tabela — truncados quando a célula é estreita demais
        body.querySelectorAll('td.idesc[data-fulldesc]').forEach(td=>{
            const full=td.getAttribute('data-fulldesc');
            td.removeAttribute('data-fulldesc');
            if(td.scrollWidth > td.clientWidth + 1){
                td.setAttribute('data-tip', full);
            }
        });
        // Valores dos kv compactos — truncados quando o texto não cabe na célula
        body.querySelectorAll('.kv.kvCompact .v[data-fullval]').forEach(el=>{
            const full=el.getAttribute('data-fullval');
            el.removeAttribute('data-fullval');
            if(el.scrollWidth > el.clientWidth + 1){
                el.setAttribute('data-tip', full);
            }
        });
    });
};

const handleModalClick = e => {
    const el = e.target.closest('[data-idx]');
    if(!el) return;
    const idx = Number(el.getAttribute('data-idx'));
    if(DADOS.vendas[idx]) abrirModal(DADOS.vendas[idx]);
};
const tbEl = qs("#tb"); if(tbEl) tbEl.addEventListener("click", handleModalClick);
const cardsEl = qs("#cards"); if(cardsEl) cardsEl.addEventListener("click", handleModalClick);

const fecharModal=()=>{
    qs("#ov").classList.remove("on"); qs("#ov").setAttribute("aria-hidden","true");
    const b=qs("#copiarModal");if(b)b.style.display="none";const b1=qs("#copiarModalGer");if(b1)b1.style.display="none";const b2=qs("#copiarModalSemItens");if(b2)b2.style.display="none";
    linhaAtual=null;
};

const abrirAjuda=()=>{
    linhaAtual=null;
    const b=qs("#copiarModal");if(b)b.style.display="none";const b1=qs("#copiarModalGer");if(b1)b1.style.display="none";const b2=qs("#copiarModalSemItens");if(b2)b2.style.display="none";
    qs("#mTitulo").textContent="Coringas disponíveis";
    qs("#mSub").textContent="Use no campo de busca para filtrar por valor e/ou excluir termos.";
    const body=qs("#mBody"); body.innerHTML="";
    const _escM=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const add=(k,v)=>{const d=document.createElement('div');d.className='kv';d.innerHTML='<div class="k">'+_escM(k)+'</div><div class="v">'+_escM(v)+'</div>';body.appendChild(d);};
    add("[proibidos] ou [1p]","Use a tecla Insert ou Capslock + P para adicionar [proibidos] ao buscar e aplicar o filtro para ocultar vendas com itens proibidos");
    add("[-proibidos] ou [-p]","Use a tecla Delete para adicionar [-proibidos] ao buscar e aplicar o filtro para mostrar vendas com itens proibidos");
    add("[a,~b,=c]","exclusão: a=inclui (token), ~b=contém (substring), =c=igual 100%. Use [proibidos] para ocultar vendas com itens proibidos. Use [-proibidos] para mostrar vendas com itens proibidos, multiplas exclusões separadas por vírgula.");
    add("> ou >=","> valores maiores que, >= valores maiores que ou igual, exclusao use - (menos) (ex: >100-pix-credito-debito)");
    add("< ou <=","< valores menores que, <= valores menores que ou igual, exclusao use - (menos) (ex: <150-granel-gerencia-cartao)");
    add("*","1+ dígitos e/ou vírgula (pode atravessar a vírgula) — casa do começo do valor");
    add("/","1+ dígitos (somente antes da vírgula) — procura dentro da parte inteira");
    add("?","exatamente 1 dígito (parte inteira) — procura dentro da parte inteira");
    add("=151 ou =151*num","combinação aproximada para somar até 151, combinação aproximada para somar até 151 ± adicional opcional");
    add("+ (opcional)","múltiplos filtros (ex: >50+carto+-vendedor) o uso do + é opcional para multiplas pesquisas (ex: [-proibidos,dinheiro]>150-entregas) também é válido");
    add("Rádio ao lado da busca","Escolha Todos, Gerencial, NFC-e ou NF-e (quando disponível) para aplicar a pesquisa somente no tipo selecionado");
    qs("#ov").classList.add("on"); qs("#ov").setAttribute("aria-hidden","false");
};

const abrirVendedores=()=>{
    const ov=qs("#ovVend"); if(!ov)return;
    ov.classList.add("on"); ov.setAttribute("aria-hidden","false"); vendFiltro="";
    const q=qs("#vendQ"); if(q){q.value="";if(!window.matchMedia("(max-width:680px)").matches)q.focus();}
};
const fecharVendedores=()=>{ const ov=qs("#ovVend"); if(ov){ov.classList.remove("on"); ov.setAttribute("aria-hidden","true");} vendFiltro=""; const q=qs("#vendQ"); if(q)q.value=""; };
const abrirAcoes=()=>{ const ov=qs("#ovAcoes"); if(ov){ov.classList.add("on"); ov.setAttribute("aria-hidden","false");} };
const fecharAcoes=()=>{ const ov=qs("#ovAcoes"); if(ov){ov.classList.remove("on"); ov.setAttribute("aria-hidden","true");} };

const abrirEditorProibidos=()=>{
    qs("#ovProib")?.remove();
    const bg=document.createElement("div"); bg.className="ov on"; bg.id="ovProib"; bg.setAttribute("aria-hidden","false");
    bg.innerHTML='<div class="modal" role="dialog" aria-modal="true"><div class="mhead"><div><div class="mtitle">Proibidos</div><div class="msub">Um por linha — nome do produto a ocultar. Salvo no servidor (config.json).</div></div><div class="btn" id="prFechar"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Fechar</div></div><div class="mbody"><textarea id="prTa" spellcheck="false" style="width:100%;height:260px;resize:vertical;border-radius:14px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.03);/*color:#e6eaf2;*/padding:12px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,&quot;Liberation Mono&quot;,&quot;Courier New&quot;,monospace;font-size:12px;outline:none"></textarea><div id="prMsg" style="font-size:12px;color:var(--text-muted);min-height:18px;padding:4px 0"></div><div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap"><div class="btn" id="prCancelar"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.42"/></svg>Restaurar padrão</div><div class="btn" id="prSalvar"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>Salvar</div></div></div></div>';
    document.body.appendChild(bg);
    const ta=qs("#prTa",bg);
    // Mostra entradas originais (não normalizadas) para preservar capitalização e filtros de valor
    ta.value=valoresProibidos.join("\n");
    const msg=qs("#prMsg",bg);
    const fechar=()=>bg.remove();
    qs("#prFechar",bg).addEventListener("click",fechar);
    qs("#prCancelar",bg).addEventListener("click",()=>{
        setProibidosUser(proibidosPadrao);
        _salvarProibidosServidor(proibidosPadrao);
        ta.value=proibidosPadrao.join("\n");
        renderTabela();
        toast("Proibidos","Restaurado padrão.");
    });
    qs("#prSalvar",bg).addEventListener("click",()=>{
        const lista=String(ta.value||"").split(/\n/g).map(s=>s.trim()).filter(Boolean);
        setProibidosUser(lista);
        if(msg)msg.textContent="Salvando...";
        _salvarProibidosServidor(lista, ()=>{
            if(msg)msg.textContent="Salvo!";
            setTimeout(()=>{if(msg)msg.textContent="";},2000);
        });
        fechar();
        renderTabela();
        toast("Proibidos","Lista atualizada.");
    });
    bg.addEventListener("click",e=>{if(e.target===bg)fechar();});
    document.addEventListener("keydown",function escKey(e){if(e.key==="Escape"){document.removeEventListener("keydown",escKey);fechar();}});
};

const _salvarProibidosServidor=(lista, cb)=>{
    fetch('/api/proibidos',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(lista)
    }).then(r=>r.json()).then(d=>{if(cb)cb(d);}).catch(e=>{console.error("Erro ao salvar proibidos no servidor:",e);if(cb)cb(null);});
};

// Exibe elemento com animação reveal (1 segundo)
// displayVal: valor CSS de display a aplicar (default "inline")
// Reutilizável para qualquer elemento — remove a classe após a animação para não bloquear re-trigger
const _mostrar=(el,displayVal)=>{
    if(!el)return;
    const dv=displayVal||"inline";
    if(el.style.display===dv)return; // já visível — não re-anima
    el.classList.remove("reveal");
    el.style.display=dv;
    // Força reflow para garantir que a classe seja reaplicada mesmo se o display não mudou
    void el.offsetWidth;
    el.classList.add("reveal");
    const limpar=()=>{ el.classList.remove("reveal"); el.removeEventListener("animationend",limpar); };
    el.addEventListener("animationend",limpar,{once:true});
};
const _ocultar=(el)=>{ if(!el)return; el.style.display="none"; el.classList.remove("reveal"); };

// Contagens reais por modelo — fonte primária e confiável para visibilidade dos badges
const _cntGer  = DADOS.vendas.filter(x=>Number(x&&x.modelo||0)===99).length;
const _cntNfce = DADOS.vendas.filter(x=>Number(x&&x.modelo||0)===65).length;
const _cntNfe  = DADOS.vendas.filter(x=>Number(x&&x.modelo||0)===55).length;
const elQG=qs("#tQtdGer");    if(elQG)   elQG.textContent  = _cntGer;
const elQN=qs("#tQtdNfce");   if(elQN)   elQN.textContent  = _cntNfce;
const elQNfe=qs("#tQtdNfe");  if(elQNfe) elQNfe.textContent= _cntNfe;
const td=DADOS.totaisDia;{
    const b        = qs("#bDiaBrk");
    const mini     = qs("#tDiaBrkMini");
    // Badges de quantidade: exibe somente se houver vendas daquele tipo nos dados
    const badgeNfce= qs("#badgeQtdNfce");
    const badgeNfe = qs("#badgeNfe");
    const nfceMini = qs("#tDiaNfceMini");
    const nfeMini  = qs("#tDiaNfeMini");
    // Visibilidade baseada em contagem real (independente de totaisDia.ok)
    if(badgeNfce) { _cntNfce>0 ? _mostrar(badgeNfce,"inline") : _ocultar(badgeNfce); }
    if(badgeNfe)  { _cntNfe>0  ? _mostrar(badgeNfe,"inline")  : _ocultar(badgeNfe);  }
    if(nfceMini)  { _cntNfce>0 ? _mostrar(nfceMini,"inline")  : _ocultar(nfceMini);  }
    if(nfeMini)   { _cntNfe>0  ? _mostrar(nfeMini,"inline")   : _ocultar(nfeMini);   }
    if(td&&td.ok){
        qs("#tDiaSel").textContent  = fmt(td.selecionado||0);
        qs("#tDiaGer").textContent  = fmt(td.gerencial||0);
        if(qs("#tDiaNfce")) qs("#tDiaNfce").textContent = fmt(td.nfce||0);
        if(qs("#tDiaNfe"))  qs("#tDiaNfe").textContent  = fmt(td.nfe||0);
        // Só mostra o breakdown (mini) quando há mais de um tipo de documento com valor
        const _tiposComValor = [(td.gerencial||0)>0,(td.nfce||0)>0,(td.nfe||0)>0].filter(Boolean).length;
        if(mini) { _tiposComValor > 1 ? _mostrar(mini,"inline") : _ocultar(mini); }
        if(!Number(td.selecionado||0)){ _ocultar(b); } else { _mostrar(b,"inline-flex"); }
    }else{
        qs("#tDiaSel").textContent = fmt(DADOS.totais.total||0);
        if(mini) _ocultar(mini);
        if(b) _mostrar(b,"inline-flex");
    }
}
// Mostra/oculta radios conforme tipos presentes nos dados.
// Se houver apenas um tipo, oculta o container inteiro (não faz sentido filtrar).
// Se houver mais de um, exibe apenas os radios dos tipos presentes + "Todos".
{
    const temGer  = DADOS.vendas.some(x=>Number(x&&x.modelo||0)===99);
    const temNfce = DADOS.vendas.some(x=>Number(x&&x.modelo||0)===65);
    const temNfe  = DADOS.vendas.some(x=>Number(x&&x.modelo||0)===55);
    const tiposPresentes = [temGer, temNfce, temNfe].filter(Boolean).length;
    const radioBox = qs("#radioBusca");
    const rGer   = qs("#radioLblGer");
    const rNfce  = qs("#radioLblNfce");
    const rNfe   = qs("#radioLblNfe");
    if (tiposPresentes <= 1) {
        // Apenas um tipo — esconde o seletor inteiro
        if (radioBox) _ocultar(radioBox);
    } else {
        // Múltiplos tipos — exibe o container e apenas os radios presentes
        if (radioBox) { radioBox.style.display = ""; }
        if (rGer)  temGer  ? _mostrar(rGer,"")  : _ocultar(rGer);
        if (rNfce) temNfce ? _mostrar(rNfce,"") : _ocultar(rNfce);
        if (rNfe)  temNfe  ? _mostrar(rNfe,"")  : _ocultar(rNfe);
    }
}

let debounceBusca;
qs("#q").addEventListener("input",e=>{
    clearTimeout(debounceBusca);
    const n = DADOS.vendas.length;
    // Delay cresce com o volume: <200 dados=100ms, <500=200ms, <2000=300ms, ≥2000=450ms
    const delay = n > 2000 ? 450 : n > 500 ? 300 : n > 200 ? 200 : 100;
    debounceBusca = setTimeout(() => {
        qAtual=String(e.target.value||"").trim();
        const p=parseBusca(qAtual); qInc=p.inc; qIgn=p.ign; qValor=consultaPareceValor(qInc);
        calcSomaSel();
        renderTabela();
    }, delay);
});

document.querySelectorAll('input[name="tipoBusca"]').forEach(el=>el.addEventListener("change",e=>{
    tipoBusca=String(e.target&&e.target.value||"todos");
    // Se o vendedor selecionado não existe no novo tipo, limpa a seleção
    if(tipoBusca!=="todos"&&vendAtual&&!DADOS.vendas.some(x=>tipoLinhaOk(x)&&x.vendedor===vendAtual)){
        vendAtual=""; atualizarSelecaoVendedores();
    }
    calcSomaSel(); renderTabela();
}));
const _fnLimpar=()=>{vendAtual="";qAtual="";qInc="";qIgn=[];qValor=false;tipoBusca="todos";qs("#q").value="";const rb=qs('input[name="tipoBusca"][value="todos"]');if(rb)rb.checked=true;calcSomaSel();renderTabela();atualizarSelecaoVendedores();_atualizarXLimpar();toast("Filtro limpo","Mostrando todos.");};
qs("#limpar").addEventListener("click",_fnLimpar);
const _btnLimTab=qs("#limparTabela");if(_btnLimTab)_btnLimTab.addEventListener("click",_fnLimpar);

// Visibilidade do ✕ dentro do input — aparece só quando há conteúdo no campo (variável string, não emoji)
const _atualizarXLimpar = () => {
    const btnX = qs("#limpar");
    const qEl  = qs("#q");
    if (!btnX || !qEl) return;
    const temConteudo = String(qEl.value || "").length > 0;
    if (temConteudo) btnX.classList.add("visivel");
    else             btnX.classList.remove("visivel");
};
qs("#q").addEventListener("input", _atualizarXLimpar);
// Estado inicial (pode haver valor pré-preenchido)
_atualizarXLimpar();
qs("#ajuda").addEventListener("click",abrirAjuda);
const btnPro=qs("#proibidos");if(btnPro)btnPro.addEventListener("click",()=>{const inp=qs("#q");if(!inp)return;let v=String(inp.value||"");if(v.toLowerCase().indexOf("[proibidos]")<0)v=(v+" [proibidos]").trim();inp.value=v;qAtual=v.trim();const p=parseBusca(qAtual);qInc=p.inc;qIgn=p.ign;qValor=consultaPareceValor(qInc);calcSomaSel();renderTabela();_atualizarXLimpar();toast("Filtro","Aplicado [proibidos].");});

qs("#copiarTudo").addEventListener("click",()=>{copiarTexto(montarTextoCopia(false,false));toast("Copiado","Conteúdo completo (com dinheiro).");});
qs("#copiarTudoItens").addEventListener("click",()=>{copiarTexto(montarTextoCopiaItens(false,false));toast("Copiado","Conteúdo completo + itens.");});
qs("#copiarSemDinheiro").addEventListener("click",()=>{copiarTexto(montarTextoCopia(true,false));toast("Copiado","Ignorando vendas com Dinheiro.");});
qs("#copiarGerencial").addEventListener("click",()=>{
    // Gerencial real: modelo 99 + número começa com 0 (padStart de gerencial) + NÃO é recebimento avulso
    const filtradas=DADOS.vendas.map((x,i)=>({x,i}))
    .filter(o=>Number(o.x&&o.x.modelo||0)===99 && !o.x.is_recebimento && String(o.x&&o.x.numero||"").startsWith("0") && passaFiltro(o.x,o.i))
    .map(o=>o.x);
    let out="";
    if(vendAtual){ out+=vendAtual+":\n"; for(const x of filtradas)out+=String(x.numero||"")+"\n"; }
    else{
        const map=new Map();
        for(const x of filtradas){ const v=x.vendedor||"(sem vendedor)"; if(!map.has(v))map.set(v,[]); map.get(v).push(x); }
        const vendes=[...map.keys()].sort((a,b)=>a.localeCompare(b,"pt-BR",{sensitivity:"base"}));
        for(const v of vendes){ out+=v+":\n"; for(const x of map.get(v))out+=String(x.numero||"")+"\n"; out+="\n"; }
    }
    copiarTexto(out.trim()); toast("Copiado","Somente números de gerencial.");
});

qs("#editarProibidos").addEventListener("click",abrirEditorProibidos);
const PH_DESK="Buscar... Excluir: -termo (1) ou [termo,~contém,=igual,proibidos,-proibidos] (múltiplos)  |  Valor: >100, 10-20, 12*3, 12/3, 12?  |  Múltiplos: +  |  Soma: =151 ou =151*2";
const PH_MOB="Buscar... (ex: >50+CARTAO+-VENDEDOR+[-proibidos])";
const ajustarPlaceholder=()=>{const q=qs("#q");if(!q)return;q.placeholder=window.matchMedia("(max-width:680px)").matches?PH_MOB:PH_DESK;};
ajustarPlaceholder(); window.addEventListener("resize",ajustarPlaceholder);

const clicar=sel=>{const el=qs(sel);if(el)el.dispatchEvent(new MouseEvent("click",{bubbles:true}));};
const acoes=qs("#acoes");if(acoes)acoes.addEventListener("click",function(){ __abrirModalConfig(); });
const acoesFechar=qs("#acoesFechar");if(acoesFechar)acoesFechar.addEventListener("click",fecharAcoes);
const ovA=qs("#ovAcoes");if(ovA)ovA.addEventListener("click",e=>{if(e.target===ovA)fecharAcoes();});
const a1=qs("#aCopiarTudo");if(a1)a1.addEventListener("click",()=>{clicar("#copiarTudo");fecharAcoes();});
const a2=qs("#aCopiarTudoItens");if(a2)a2.addEventListener("click",()=>{clicar("#copiarTudoItens");fecharAcoes();});
const a3=qs("#aCopiarSemDinheiro");if(a3)a3.addEventListener("click",()=>{clicar("#copiarSemDinheiro");fecharAcoes();});
const a4=qs("#aCopiarGerencial");if(a4)a4.addEventListener("click",()=>{clicar("#copiarGerencial");fecharAcoes();});
const a5=qs("#aProibidos");if(a5)a5.addEventListener("click",()=>{clicar("#editarProibidos");fecharAcoes();});
const a6=qs("#aVendedores");if(a6)a6.addEventListener("click",()=>{fecharAcoes();renderLista();abrirVendedores();});
const a7=qs("#aAjuda");if(a7)a7.addEventListener("click",()=>{fecharAcoes();abrirAjuda();});
const a8=qs("#aLimpar");if(a8)a8.addEventListener("click",()=>{_fnLimpar();fecharAcoes();});
const mb1=qs("#mbCopiar");if(mb1)mb1.addEventListener("click",()=>{clicar("#copiarTudo");});
const mb2=qs("#mbItens");if(mb2)mb2.addEventListener("click",()=>{clicar("#copiarTudoItens");});
const mb3=qs("#mbMais");if(mb3)mb3.addEventListener("click",abrirAcoes);
const vendQ=qs("#vendQ");if(vendQ)vendQ.addEventListener("input",e=>{vendFiltro=String(e.target.value||"");renderLista();});
const btnVend=qs("#btnVend");if(btnVend)btnVend.addEventListener("click",()=>{renderLista();abrirVendedores();});
const vendFechar=qs("#vendFechar");if(vendFechar)vendFechar.addEventListener("click",fecharVendedores);
const ovVend=qs("#ovVend");if(ovVend)ovVend.addEventListener("click",e=>{if(e.target===ovVend)fecharVendedores();});

qs("#copiarModal").addEventListener("click",()=>{if(!linhaAtual)return;copiarTexto((linhaAtual.vendedor||"(sem vendedor)")+":\n"+linhaCopiaItens(linhaAtual));toast("Copiado","Linha (com itens).");});
qs("#copiarModalGer").addEventListener("click",()=>{if(!linhaAtual)return;copiarTexto(String(linhaAtual.numero||""));toast("Copiado","Somente gerencial.");});
qs("#copiarModalSemItens").addEventListener("click",()=>{if(!linhaAtual)return;copiarTexto((linhaAtual.vendedor||"(sem vendedor)")+":\n"+linhaCopiaSemItens(linhaAtual));toast("Copiado","Linha (sem itens).");});
qs("#fechar").addEventListener("click",fecharModal);
qs("#ov").addEventListener("click",e=>{if(e.target===qs("#ov"))fecharModal();});

document.addEventListener("keydown",e=>{
    if(e.key==="Escape"){
        const ova=qs("#ovAcoes");if(ova&&ova.classList.contains("on")){fecharAcoes();return;}
        const ovv=qs("#ovVend");if(ovv&&ovv.classList.contains("on")){fecharVendedores();return;}
        fecharModal();
    }
});

document.addEventListener("keydown",e=>{
    const k=String(e.key||""); const isInsert=k==="Insert"; const isCapsP=(k.toLowerCase()==="p"&&e.getModifierState&&e.getModifierState("CapsLock")); const isDelete=k==="Delete";
    if(!isInsert&&!isCapsP&&!isDelete)return;
    e.preventDefault(); const inp=qs("#q"); if(!inp)return;
    let v=String(inp.value||"");
    if(isDelete){
        if(v.toLowerCase().indexOf("[-proibidos]")<0)v=(v+" [-proibidos]").trim();
        inp.value=v; qAtual=v.trim(); const p=parseBusca(qAtual); qInc=p.inc; qIgn=p.ign; qValor=consultaPareceValor(qInc); calcSomaSel(); renderTabela(); _atualizarXLimpar(); toast("Filtro","Aplicado [-proibidos].");
		document.querySelector(".radio#radioLblGer").click();
		document.evaluate("//div[@id='lista']//div[contains(@class, 'item')]//div[contains(@class, 'nome') and normalize-space()='Todos']",
		document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue.click();
		
	}else{
		if(k=="Insert"){
			document.querySelector(".radio#radioLblGer").click();
			document.evaluate("//div[@id='lista']//div[contains(@class, 'item')]//div[contains(@class, 'nome') and normalize-space()='Todos']",
			document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue.click();
		}
        if(v.toLowerCase().indexOf("[proibidos]")<0)v=(v+" [proibidos]").trim();
        inp.value=v; qAtual=v.trim(); const p=parseBusca(qAtual); qInc=p.inc; qIgn=p.ign; qValor=consultaPareceValor(qInc); calcSomaSel(); renderTabela(); _atualizarXLimpar(); toast("Filtro","Aplicado [proibidos].");
    }
});

qs("#atualizar")?.addEventListener("click", () => {
    window.location.href = "/atualizar";
});

qs("#btnModalPeriodo")?.addEventListener("click", () => {
    __abrirModalPeriodo();
});

var __abrirModalPeriodo = function() {
    if (document.getElementById("ovPeriodo")) return;
    var _hoje = new Date();
    var _p = function(n) { return String(n).padStart(2, "0"); };
    var _hojeISO = _hoje.getFullYear() + "-" + _p(_hoje.getMonth()+1) + "-" + _p(_hoje.getDate());
    var _bg = document.createElement("div");
    _bg.className = "ov on sheet";
    _bg.id = "ovPeriodo";
    _bg.setAttribute("aria-hidden", "false");
    _bg.innerHTML =
        '<div class="modal" role="dialog" aria-modal="true" style="max-width:420px">' +
          '<div class="mhead">' +
            '<div>' +
              '<div class="mtitle">Gerar por periodo</div>' +
              '<div class="msub">Informe o intervalo de datas desejado</div>' +
            '</div>' +
            '<button class="btn" id="perFechar" type="button"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Fechar</button>' +
          '</div>' +
          '<div class="mbody" style="gap:16px;padding-bottom:24px">' +
            '<div class="kv">' +
              '<div class="k">Data inicial</div>' +
              '<input type="date" id="perInicio" value="' + _hojeISO + '" class="input" style="flex:1;color-scheme:dark">' +
            '</div>' +
            '<div class="kv">' +
              '<div class="k">Data final</div>' +
              '<input type="date" id="perFim" value="' + _hojeISO + '" class="input" style="flex:1;color-scheme:dark">' +
            '</div>' +
            '<div id="perStatus" style="display:none;text-align:center;padding:8px 0;font-size:13px;color:var(--text-muted)">Gerando relatorio, aguarde...</div>' +
            '<button class="btn" id="perGerar" type="button" style="width:100%;min-height:48px;height:auto;padding:12px 18px;font-size:15px;font-weight:700;white-space:normal;line-height:1.3;gap:10px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>Gerar relatório</button>' +
          '</div>' +
        '</div>';
    document.body.appendChild(_bg);
    var _fechar = function() { _bg.remove(); };
    document.getElementById("perFechar").addEventListener("click", _fechar);
    _bg.addEventListener("click", function(e) { if (e.target === _bg) _fechar(); });
    document.addEventListener("keydown", function _escPer(e) {
        if (e.key === "Escape") { document.removeEventListener("keydown", _escPer); _fechar(); }
    });
    document.getElementById("perGerar").addEventListener("click", function() {
        var inicio = document.getElementById("perInicio").value;
        var fim    = document.getElementById("perFim").value;
        if (!inicio || !fim) { toast("Erro", "Informe as duas datas."); return; }
        if (inicio > fim) { toast("Erro", "A data inicial deve ser anterior ou igual a final."); return; }
        var _st  = document.getElementById("perStatus");
        var _btn = document.getElementById("perGerar");
        if (_st)  _st.style.display = "block";
        if (_btn) { _btn.disabled = true; _btn.textContent = "Gerando..."; }
        window.location.href = "/periodo?i=" + encodeURIComponent(inicio) + "&f=" + encodeURIComponent(fim);
    });
};

// ── Modal de configurações (acionado via botão Editar configurações ou tray → SSE navigate-hash:config) ───
var __abrirModalConfig = function() {
    if (document.getElementById("ovConfig")) return;
    var _bg = document.createElement("div");
    _bg.className = "ov on sheet";
    _bg.id = "ovConfig";
    _bg.setAttribute("aria-hidden", "false");

    var _fechar = function() {
        var el = document.getElementById("ovConfig");
        if (el) el.remove();
    };

    // Carrega valores atuais do servidor antes de montar o HTML
    fetch("/api/config", {cache: "no-store"})
    .then(function(r){ return r.json(); })
    .catch(function(){ return {}; })
    .then(function(cfg) {
        var _pn  = String(cfg.appName      || "").replace(/"/g, "&quot;");
        var _pi  = parseInt(cfg.pollInterval || 800, 10);
        var _ml  = parseInt(cfg.maxLogLines  || 1000, 10);
        var _fv  = String(cfg.favicon        || "");
        var _td  = parseInt(cfg.toastDuration || 5000, 10);
        var _prArr = Array.isArray(cfg.proibidos) ? cfg.proibidos : [];

        // Aplica a duração de toast imediatamente ao abrir o modal
        window.__TOAST_MS = Math.max(500, _td);

        _bg.innerHTML =
          '<div class="modal" role="dialog" aria-modal="true" style="max-width:480px">' +
            '<div class="mhead">' +
              '<div>' +
                '<div class="mtitle">Editar configurações</div>' +
                '<div class="msub">Alterações aplicadas em tempo real — campos avançados: edite config.json diretamente.</div>' +
              '</div>' +
              '<button class="btn" id="cfgFechar" type="button"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Fechar</button>' +
            '</div>' +
            '<div class="mbody" style="gap:14px;padding-bottom:24px">' +
              '<div class="kv">' +
                '<div class="k">Nome do sistema</div>' +
                '<input type="text" id="cfgAppName" value="' + _pn + '" class="input" placeholder="ex: Pet World" style="flex:1">' +
              '</div>' +
              '<div class="kv">' +
                '<div class="k">Intervalo de atualização automática (ms)</div>' +
                '<input type="number" id="cfgPollInterval" value="' + _pi + '" min="200" step="100" class="input" style="flex:1">' +
              '</div>' +
              '<div class="kv">' +
                '<div class="k">Máx. linhas de log interno</div>' +
                '<input type="number" id="cfgMaxLogLines" value="' + _ml + '" min="100" step="100" class="input" style="flex:1">' +
              '</div>' +
              '<div class="kv">' +
                '<div class="k">Duração das mensagens de aviso (ms)</div>' +
                '<div style="display:flex;gap:8px;align-items:center;flex:1">' +
                  '<input type="number" id="cfgToastDuracao" value="' + _td + '" min="500" max="30000" step="500" class="input" style="flex:1">' +
                  '<button class="btn" type="button" id="cfgToastReset" data-tip="Restaurar duração padrão (5 segundos)" style="white-space:nowrap"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.42"/></svg>Padrão (5s)</button>' +
                '</div>' +
              '</div>' +
              '<div class="kv" style="flex-direction:column;gap:8px">' +
                '<div class="k">Ícone (favicon)</div>' +
                '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
                  '<input type="text" id="cfgFaviconPath" value="' + _fv.replace(/"/g,"&quot;") + '" class="input" placeholder="Caminho do arquivo ou vazio para padrão" style="flex:1;min-width:0">' +
                  '<button class="btn" type="button" id="cfgFaviconPick" data-tip="Selecionar arquivo de imagem do computador"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>Procurar</button>' +
                  '<input type="file" id="cfgFaviconFile" accept=".png,.ico,.jpg,.jpeg" style="display:none">' +
                '</div>' +
                '<div id="cfgFaviconInfo" style="font-size:11px;color:var(--text-muted);padding-left:2px">' +
                  (_fv ? 'Atual: ' + _fv : 'Usando favicon.png padrão da pasta do sistema') +
                '</div>' +
              '</div>' +
              '<div class="kv" style="flex-direction:column;gap:8px">' +
                '<div class="k">Termos proibidos <span style="font-weight:400;text-transform:none;letter-spacing:0">(um por linha — oculta vendas com esses produtos)</span></div>' +
                '<textarea id="cfgProibidos" spellcheck="false" style="width:100%;min-height:130px;resize:vertical;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--bg-app);color:var(--text-main);padding:10px 12px;font-family:ui-monospace,Consolas,monospace;font-size:12px;outline:none;transition:border-color .15s"></textarea>' +
              '</div>' +
              '<div id="cfgStatus" style="display:none;text-align:center;padding:8px 0;font-size:13px;color:var(--text-muted)">Salvando...</div>' +
              '<button class="btn" id="cfgSalvar" type="button" style="width:100%;min-height:48px;height:auto;padding:12px 18px;font-size:15px;font-weight:700;white-space:normal;line-height:1.3;gap:10px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>Salvar configurações</button>' +
            '</div>' +
          '</div>';

        document.body.appendChild(_bg);

        // Popula textarea de proibidos
        document.getElementById("cfgProibidos").value = _prArr.join("\n");

        // Estilo focus na textarea
        var _ta = document.getElementById("cfgProibidos");
        _ta.addEventListener("focus", function(){ _ta.style.borderColor = "var(--accent)"; });
        _ta.addEventListener("blur",  function(){ _ta.style.borderColor = "var(--border)"; });

        // Botão restaurar padrão do toast
        document.getElementById("cfgToastReset").addEventListener("click", function() {
            document.getElementById("cfgToastDuracao").value = 5000;
        });

        // Botão fechar
        document.getElementById("cfgFechar").addEventListener("click", _fechar);
        _bg.addEventListener("click", function(e){ if (e.target === _bg) _fechar(); });
        document.addEventListener("keydown", function _escCfg(e){
            if (e.key === "Escape"){ document.removeEventListener("keydown", _escCfg); _fechar(); }
        });

        // File picker de favicon
        var _fileInp = document.getElementById("cfgFaviconFile");
        document.getElementById("cfgFaviconPick").addEventListener("click", function(){
            _fileInp.click();
        });
        _fileInp.addEventListener("change", function(){
            var f = _fileInp.files && _fileInp.files[0];
            if (!f) return;
            var _info = document.getElementById("cfgFaviconInfo");
            if (_info) _info.textContent = "Arquivo selecionado: " + f.name + " (" + Math.round(f.size/1024) + " KB) — será enviado ao salvar.";
            document.getElementById("cfgFaviconPath").value = "";
        });

        // Salvar
        document.getElementById("cfgSalvar").addEventListener("click", function() {
            var _btn = document.getElementById("cfgSalvar");
            var _st  = document.getElementById("cfgStatus");
            var an   = String(document.getElementById("cfgAppName").value     || "").trim();
            var pi   = parseInt(document.getElementById("cfgPollInterval").value, 10) || 800;
            var ml   = parseInt(document.getElementById("cfgMaxLogLines").value, 10)  || 1000;
            var td   = parseInt(document.getElementById("cfgToastDuracao").value, 10) || 5000;
            var fv   = String(document.getElementById("cfgFaviconPath").value || "").trim();
            var prRaw= String(document.getElementById("cfgProibidos").value   || "");
            var pr   = prRaw.split("\n").map(function(s){ return s.trim(); }).filter(function(s){ return s.length > 0; });
            var favFile = _fileInp.files && _fileInp.files[0];

            if (!an) { toast("Erro", "O nome do sistema não pode estar vazio."); return; }
            if (pi < 200) { toast("Erro", "Intervalo mínimo: 200 ms."); return; }
            if (ml < 100) { toast("Erro", "Mínimo de 100 linhas de log."); return; }
            if (td < 500) { toast("Erro", "Duração mínima de aviso: 500 ms."); return; }

            _btn.disabled = true; _btn.textContent = "Salvando...";
            if (_st) _st.style.display = "block";

            var _doSave = function() {
                fetch("/api/config", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({appName: an, pollInterval: pi, maxLogLines: ml, favicon: fv, toastDuration: td, proibidos: pr})
                })
                .then(function(r){ return r.json(); })
                .then(function(d){
                    if (_st) _st.style.display = "none";
                    _btn.disabled = false; _btn.textContent = "Salvar configurações";
                    if (d.ok) {
                        // Aplica duração imediatamente
                        window.__TOAST_MS = Math.max(500, td);
                        toast("Configurações salvas", "O relatório será atualizado em breve.");
                        _fechar();
                    } else {
                        toast("Erro ao salvar", d.erro || "Falha desconhecida.");
                    }
                })
                .catch(function(e){
                    if (_st) _st.style.display = "none";
                    _btn.disabled = false; _btn.textContent = "Salvar configurações";
                    toast("Erro de rede", e.message || "Falha na conexão com o servidor.");
                });
            };

            if (favFile) {
                var _reader = new FileReader();
                _reader.onload = function(ev) {
                    var ab = ev.target.result;
                    fetch("/api/upload-favicon", {
                        method: "POST",
                        headers: {"Content-Type": "application/octet-stream"},
                        body: ab
                    })
                    .then(function(r){ return r.json(); })
                    .then(function(d){
                        if (d.ok) {
                            fv = "";
                        } else {
                            toast("Aviso — ícone", d.erro || "Falha no upload, usando ícone anterior.");
                        }
                        _doSave();
                    })
                    .catch(function(){
                        toast("Aviso — ícone", "Falha no upload do ícone, salvando demais configurações.");
                        _doSave();
                    });
                };
                _reader.readAsArrayBuffer(favFile);
            } else {
                _doSave();
            }
        });
    });

    // Mostra spinner enquanto carrega
    _bg.innerHTML = '<div class="modal" role="dialog" aria-modal="true" style="max-width:480px;min-height:200px;align-items:center;justify-content:center;display:flex"><div class="msub" style="text-align:center;padding:40px">Carregando configurações...</div></div>';
    document.body.appendChild(_bg);
    _bg.addEventListener("click", function(e){ if (e.target === _bg) _fechar(); });
};

const fixHead=()=>{
    const tbl=qs("table"); if(!tbl)return;
    const thead=tbl.querySelector("thead"); if(!thead)return;
    const sync=()=>{const sbw=tbl.offsetWidth-tbl.clientWidth;tbl.style.setProperty("--sbw",(sbw>0?sbw:0)+"px");thead.style.transform="translateX("+(-tbl.scrollLeft)+"px)";};
    tbl.addEventListener("scroll",sync,{passive:true}); window.addEventListener("resize",sync); sync();
};
/**
 * Correção Sequencial Anti-Loop para #bDiaBrk
 * Gatilho: Mudança de clientWidth em div.top
 * Padrão: Formal | Pt-BR | Zero Flickering
 */
(() => {
    'use strict';
    const $ = (s) => document.querySelector(s);
    let lastTopWidth = 0;
    let cooldown = false;
    const estado = { bhora: false, vb1: false, vb2: false, vb3: false };

    const estaEscapando = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.right > window.innerWidth || r.left < 0
            || r.bottom > window.innerHeight || r.top < 0;
    };

    const ativarCooldown = () => {
        cooldown = true;
        setTimeout(() => { cooldown = false; }, 350);
    };

    const executarVerificacao = () => {
        if (cooldown) return;

        const alvo = $("#bDiaBrk");
        if (!alvo || !estaEscapando(alvo)) return;

        // Etapa 1 — oculta badge de hora
        const bh = $("div.badge.badgeHora:not(.badgeGeradoMobile)");
        if (bh && !estado.bhora) {
            bh.style.display = "none";
            estado.bhora = true;
            ativarCooldown();
        }

        // Etapas 2→3→4 encadeadas
        requestAnimationFrame(() => {
            if (!estaEscapando(alvo)) return;
            const vb = $(".vendBtn");
            if (vb && !estado.vb1) {
                vb.style.maxWidth = "110px";
                estado.vb1 = true;
                ativarCooldown();
            }

            requestAnimationFrame(() => {
                if (!estaEscapando(alvo)) return;
                const vb = $(".vendBtn");
                if (vb && !estado.vb2) {
                    vb.style.maxWidth = "85px";
                    estado.vb2 = true;
                    ativarCooldown();
                }

                requestAnimationFrame(() => {
                    if (!estaEscapando(alvo)) return;
                    const vb = $(".vendBtn");
                    if (vb && !estado.vb3) {
                        vb.style.maxWidth = "0";
                        const icon = $("span.vendIcon");
                        if (icon) icon.style.transform = "translateX(4px)";
                        estado.vb3 = true;
                        ativarCooldown();
                    }
                });
            });
        });
    };

    let timer;
    const aoMudarLarguraTop = () => {
        const topDiv = $("div.top");
        if (!topDiv) return;
        const larguraAtual = topDiv.clientWidth;
        if (larguraAtual !== lastTopWidth) {
            lastTopWidth = larguraAtual;
            clearTimeout(timer);
            timer = setTimeout(() =>
                requestAnimationFrame(executarVerificacao), 80);
        }
    };

    const observador = new ResizeObserver(aoMudarLarguraTop);
    const iniciar = () => {
        const topDiv = $("div.top");
        if (topDiv) {
            observador.disconnect();
            observador.observe(topDiv);
            lastTopWidth = topDiv.clientWidth;
            executarVerificacao();
        }
    };

    window.addEventListener("resize", () => {
        clearTimeout(timer);
        timer = setTimeout(() =>
            requestAnimationFrame(executarVerificacao), 80);
    }, { passive: true });

    // NÃO chama iniciar() aqui — renderTudo() ainda não rodou,
    // então div.top não existe no DOM e a chamada seria silenciosa.
    // Expõe a função para ser chamada logo abaixo, após o DOM estar pronto.
    window.__nc_iniciarResize = iniciar;
})();
renderTudo();
fixHead();
// div.top agora existe (criado por renderTudo).
// Chama iniciar() de forma síncrona: observador registrado +
// executarVerificacao() disparada imediatamente com layout já computado.
if (typeof window.__nc_iniciarResize === "function") {
    window.__nc_iniciarResize();
    delete window.__nc_iniciarResize;
}
</script>
</body></html>`;
fs.writeFileSync(saida, html, "utf8");
    tick("arquivo gravado");

    // Persiste cache de horas fixadas somente quando houve nova entrada,
    // evitando escrita desnecessária em disco a cada execução.
    if (_horaCacheDirty) {
        try {
            fs.writeFileSync(_horaCacheFile, JSON.stringify(_horaCache, null, 2), "utf8");
        } catch (e) {
            console.warn("Aviso: não foi possível salvar hora-fixada-cache.json —", e.message);
        }
    }

    clearTimeout(_globalTimeout);
    db.detach();
    console.log("OK: " + saida);
    });
    };
    rodar();
})();