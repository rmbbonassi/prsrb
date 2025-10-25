// index.js
const express = require('express');
const { sql, queryByClientForced, execProcByClientForced } = require('./db');

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

// auth
app.use((req, res, next) => {
  const token = req.headers['x-api-key'];
  if (token !== API_SECRET) return res.status(401).send('Acesso não autorizado');
  next();
});

// helpers
function nonEmptyStr(s, max = 200) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (!t) return null;
  return t.slice(0, max);
}

// health (valida fluxo com @id_conta)
app.get('/healthz', async (req, res) => {
  try {
    const first = Object.keys(dbConfigs)[0];
    if (!first) return res.json({ ok: true, note: 'sem clientes' });
    const r = await queryByClientForced(
      dbConfigs,
      first,
      'SELECT @id_conta AS id_conta, 1 AS ok WHERE @id_conta IS NOT NULL',
      {},
      'database-prs' // usa o mesmo DB dos RPCs
    );
    res.json({ ok: true, db: r.recordset[0].ok === 1, id_conta: r.recordset[0].id_conta });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * RPC declarativo
 * Body: { clientId: string, method: string, params?: object }
 * Fluxo:
 *   1) lookup: EXEC spw_RPCMetodoGet @metodo      (em 'database-prs')
 *   2) executa: EXEC <TX_PROC> com @id_conta + params (em 'database-prs')
 */
app.post('/v1/rpc', async (req, res) => {
  try {
    const clientId = nonEmptyStr(req.body?.clientId);
    const method = nonEmptyStr(req.body?.method, 128);
    const bodyParams = req.body?.params || {};

    if (!clientId) return res.status(400).send('clientId é obrigatório');
    if (!method) return res.status(400).send('method é obrigatório');

    // (1) lookup via SP fixa
    const lookupParams = { metodo: { type: sql.VarChar(128), value: method } };
    const lookup = await execProcByClientForced(dbConfigs, clientId, 'spw_RPCMetodoGet', lookupParams, 'database-prs');

    let procName = null;
    // Tentativa 1: recordset[0].tx_proc
    if (lookup?.recordset?.length && lookup.recordset[0].tx_proc) {
      procName = `${lookup.recordset[0].tx_proc}`.trim();
    }
    // Se a SP retorna OUTRA forma (ex.: nested recordsets), adapte aqui.

    if (!procName) {
      return res.status(404).send('Procedure não configurada para este método.');
    }

    // (2) executa a procedure real com @id_conta + params do body
    // bodyParams pode conter { k: simpleValue } ou { k: { type, value } }
    const execParams = {};
    for (const [k, v] of Object.entries(bodyParams)) {
      if (v && typeof v === 'object' && 'type' in v) execParams[k] = v;
      else execParams[k] = { type: undefined, value: v }; // sem tipo explícito
    }

    const result = await execProcByClientForced(dbConfigs, clientId, procName, execParams, 'database-prs');

    // Convencionalmente, procedures retornam recordset principal em result.recordset
    res.json({
      method,
      procedure: procName,
      records: result.recordset ?? [],
      // Se houver múltiplos recordsets:
      // allRecordsets: result.recordsets
    });
  } catch (e) {
    console.error('[rpc]', e);
    res.status(e.status || 500).send(e.message || 'Erro ao executar RPC');
  }
});

app.listen(port, () => console.log(`API rodando na porta ${port}`));
