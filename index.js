// index.js
const express = require('express');
const {
  sql,
  queryByClient,
  queryByClientForced,
  execProcByClient,          // lookup SEM @id_conta
  execProcByClientForced     // execução final COM @id_conta
} = require('./db');

let dbConfigs;
try {
  dbConfigs = JSON.parse(process.env.DBCONFIG_JSON);
} catch (err) {
  console.error('Erro ao carregar DBCONFIG_JSON:', err.message);
  process.exit(1);
}

const app = express();
const port = process.env.PORT || 3000;
const API_SECRET = process.env.API_SECRET;

app.use(express.json());

// ---------- AUTH ----------
app.use((req, res, next) => {
  const token = req.headers['x-api-key'];
  if (token !== API_SECRET) return res.status(401).send('Acesso não autorizado');
  next();
});

// ---------- UTIL ----------
function nonEmptyStr(s, max = 200) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (!t) return null;
  return t.slice(0, max);
}

// ---------- HEALTH ----------
app.get('/healthz', async (req, res) => {
  try {
    const first = Object.keys(dbConfigs)[0];
    if (!first) return res.json({ ok: true, note: 'sem clientes' });

    // valida caminho pelo database-prs (mesmo DB usado no RPC)
    const r = await queryByClientForced(
      dbConfigs,
      first,
      'SELECT @id_conta AS id_conta, 1 AS ok WHERE @id_conta IS NOT NULL',
      {},
      'database-prs'
    );

    res.json({ ok: true, db: r.recordset[0].ok === 1, id_conta: r.recordset[0].id_conta });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * RPC — endpoint único
 * Body: { clientId, method, params }
 * Fluxo:
 * 1) Lookup → spw_RPCMetodoGet (SEM @id_conta)  [database-prs]
 * 2) Execução final → TX_PROC (COM @id_conta)   [database-prs]
 */
app.post('/v1/rpc', async (req, res) => {
  try {
    const clientId   = nonEmptyStr(req.body?.clientId);
    const method     = nonEmptyStr(req.body?.method, 128);
    const bodyParams = req.body?.params || {};

    if (!clientId) return res.status(400).send('clientId é obrigatório');
    if (!method)   return res.status(400).send('method é obrigatório');

    // (1) LOOKUP — SEM @id_conta (spw_RPCMetodoGet busca por TX_METODO e retorna TX_PROC)
    const lookupParams = { dado: { type: sql.VarChar(100), value: method } };
    const lookup = await execProcByClient(
      dbConfigs,
      clientId,
      'spw_RPCMetodoGet',
      lookupParams,
      'database-prs'
    );

    let procName = null;
    if (lookup?.recordset?.length) {
      // Tabela: TX_METODO = endpoint, TX_PROC = SP real
      const row = lookup.recordset[0];
      procName = row.tx_proc ? String(row.tx_proc).trim() : null;
    }
    if (!procName) {
      return res.status(404).send('Procedure não configurada para este método.');
    }

    // (2) EXECUÇÃO — COM @id_conta injetado
    // bodyParams pode conter { k: valorSimples } ou { k: { type, value } }
    const execParams = {};
    for (const [k, v] of Object.entries(bodyParams)) {
      execParams[k] = (v && typeof v === 'object' && 'type' in v) ? v : { value: v };
    }

    const result = await execProcByClientForced(
      dbConfigs,
      clientId,
      procName,        // TX_PROC (nome da SP real no SQL, schema dbo)
      execParams,
      'database-prs'
    );

    res.json({
      method,                  // TX_METODO (endpoint)
      procedure: procName,     // TX_PROC (SP real)
      records: result.recordset ?? []
      // allRecordsets: result.recordsets  // habilite se quiser retornar todos os recordsets
    });

  } catch (e) {
    console.error('[rpc]', e);
    res.status(e.status || 500).send(e.message || 'Erro ao executar RPC');
  }
});

/** -------------------- OPCIONAL: /query livre (interno) -------------------- **/
app.post('/query', async (req, res) => {
  const { clientId, query, params, targetDbKey } = req.body || {};
  if (!clientId || !query) return res.status(400).send('clientId e query são obrigatórios');
  try {
    const result = await queryByClient(dbConfigs, clientId, query, params || {}, targetDbKey || 'database');
    res.json({ records: result.recordset });
  } catch (err) {
    console.error('[query]', err);
    res.status(err.status || 500).send(err.message || 'Erro interno');
  }
});

app.listen(port, () => console.log(`API rodando na porta ${port}`));
