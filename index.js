// index.js
const express = require('express');
const { sql, queryByClient, queryByClientForced } = require('./db');

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

// ---------- HELPERS ----------
function parseBrDateToISO(dmy) {
  // 'dd-mm-yyyy' → 'yyyy-mm-dd'
  if (typeof dmy !== 'string') return null;
  const m = dmy.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  const [_, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}
function requireBodyKeys(obj, keys) {
  for (const k of keys) if (!obj || !Object.prototype.hasOwnProperty.call(obj, k)) return k;
  return null;
}
function nonEmptyStr(s, max = 200) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (!t) return null;
  return t.slice(0, max);
}

// ---------- HEALTH ----------
app.get('/healthz', async (req, res) => {
  try {
    const firstClientId = Object.keys(dbConfigs)[0];
    if (!firstClientId) return res.json({ ok: true, note: 'sem clientes configurados' });

    // Fazemos um SELECT simples que exige @id_conta (para validar o contrato end-to-end)
    const r = await queryByClientForced(
      dbConfigs,
      firstClientId,
      'SELECT @id_conta AS id_conta, 1 AS ok WHERE @id_conta IS NOT NULL',
      {},
      'database'
    );
    res.json({ ok: true, db: r.recordset[0].ok === 1, id_conta: r.recordset[0].id_conta });
  } catch (e) {
    console.error('[healthz]', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});


// /query — rota provisória, livre (sem id_conta forçado)
app.post('/query', async (req, res) => {
  const { clientId, query, params } = req.body || {};
  if (!clientId || !query) return res.status(400).send('clientId e query são obrigatórios');

  try {
    // IMPORTANTE: aqui é query livre — volta a usar o queryByClient ORIGINAL
    const result = await queryByClient(dbConfigs, clientId, query, params);
    res.json({ records: result.recordset });
  } catch (err) {
    console.error('[query]', err);
    res.status(err.status || 500).send(err.message || 'Erro interno');
  }
});

// ---------- ENDPOINT FIXO: /v1/get_agendamentos ----------
app.post('/v1/get_agendamentos', async (req, res) => {
  const missing = requireBodyKeys(req.body, ['clientId', 'dt_inicio', 'dt_termino']);
  if (missing) return res.status(400).send(`Campo obrigatório ausente: ${missing}`);

  const clientId   = nonEmptyStr(req.body.clientId);
  const startISO   = parseBrDateToISO(req.body.dt_inicio);
  const endISO     = parseBrDateToISO(req.body.dt_termino);
  const nmUnidade  = req.body.nm_unidade ? nonEmptyStr(req.body.nm_unidade, 120) : null;

  if (!clientId) return res.status(400).send('clientId inválido');
  if (!startISO || !endISO) return res.status(400).send('datas devem ser "dd-mm-yyyy"');

  let sqlText =
    `SELECT
       DT_DATA,
       TX_DT_HORA_INI,
       TX_DESCRICAO,
       TX_MOTIVO,
       TX_STATUS,
       TX_UNIDADE_ATENDIMENTO
     FROM dbo.VW_GR_AGENDA_ITEM
     WHERE ID_CONTA_REGISTRO = @id_conta
       AND DT_DATA >= @start
       AND DT_DATA < DATEADD(day, 1, @end)`;

  const params = {
    start: { type: sql.Date, value: startISO },
    end:   { type: sql.Date, value: endISO }
  };

  if (nmUnidade) {
    // LIKE opcional: você pode usar igualdade (=) se a coluna não for indexada para LIKE
    sqlText += ` AND TX_UNIDADE_ATENDIMENTO LIKE @nmUnidade`;
    params.nmUnidade = { type: sql.VarChar(120), value: nmUnidade };
  }

  sqlText += ` ORDER BY DT_DATA, TX_DT_HORA_INI`;

  try {
    // Este endpoint usa o DB "database" (troque para 'database-prs' se necessário)
    const result = await queryByClientForced(dbConfigs, clientId, sqlText, params, 'database');
    res.json({ records: result.recordset });
  } catch (e) {
    console.error('[get_agendamentos]', e);
    res.status(e.status || 500).send(e.message || 'Erro ao consultar agendamentos');
  }
});

// ---------- START ----------
app.listen(port, () => console.log(`API rodando na porta ${port}`));
