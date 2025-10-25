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

app.listen(port, () => console.log(`API rodando na porta ${port}`));
