const express = require('express');
const { queryByClient } = require('./db');

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

// health
app.get('/healthz', async (req, res) => {
  try {
    const firstClientId = Object.keys(dbConfigs)[0];
    if (!firstClientId) return res.json({ ok: true, note: 'sem clientes configurados' });
    const r = await queryByClient(dbConfigs, firstClientId, 'SELECT 1 AS ok');
    res.json({ ok: true, db: r.recordset[0].ok === 1 });
  } catch (e) {
    console.error('[healthz]', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// query
app.post('/query', async (req, res) => {
  const { clientId, query, params } = req.body || {};
  try {
    const result = await queryByClient(dbConfigs, clientId, query, params);
    res.json({ records: result.recordset });
  } catch (err) {
    console.error('[query]', err);
    res.status(err.status || 500).send(err.message || 'Erro interno');
  }
});

// get_agendamentos
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
     DT_DATA,TX_DT_HORA_INI,TX_DESCRICAO,TX_MOTIVO,TX_STATUS,TX_UNIDADE_ATENDIMENTO
     FROM dbo.VW_GR_AGENDA_ITEM
     WHERE ID_CONTA_REGISTRO = @id_conta
     AND DT_DATA >= @start
     AND DT_DATA < DATEADD(day, 1, @end)`;

  const params = {
    start: { type: sql.Date, value: startISO },
    end:   { type: sql.Date, value: endISO }
  };

  if (nmUnidade) {
    sqlText += ` AND TX_UNIDADE_ATENDIMENTO LIKE @nmUnidade`;
    params.nmUnidade = { type: sql.VarChar(120), value: nmUnidade };
  }

  sqlText += ` ORDER BY DT_DATA,TX_DT_HORA_INI `;

  try {
    const result = await queryByClientForced(dbConfigs, clientId, sqlText, params, 'database');
    res.json({ records: result.recordset });
  } catch (e) {
    console.error('[get_agendamentos]', e);
    res.status(e.status || 500).send(e.message || 'Erro ao consultar agendamentos');
  }
});

app.listen(port, () => console.log(`API rodando na porta ${port}`));

