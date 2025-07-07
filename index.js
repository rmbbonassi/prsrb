const express = require('express');
const sql = require('mssql');
const dbConfigs = require('./dbconfigs.json');  // Agora carrega o dbconfigs.json corretamente

const app = express();
const port = process.env.PORT || 3000;

// Token secreto (continua nas variáveis de ambiente)
const API_SECRET = process.env.API_SECRET;

app.use(express.json());

// Middleware de autenticação
app.use((req, res, next) => {
  const token = req.headers['x-api-key'];
  if (token !== API_SECRET) {
    return res.status(401).send('Acesso não autorizado');
  }
  next();
});

// Rota para consultas SQL (multi-cliente)
app.post('/query', async (req, res) => {
  const { clientId, query } = req.body;

  const config = dbConfigs[clientId];

  if (!config) {
    return res.status(400).send('Cliente não encontrado ou não autorizado');
  }

  try {
    await sql.connect({
      user: config.user,
      password: config.password,
      server: config.server,
      database: config.database,
      options: {
        encrypt: true,
        trustServerCertificate: true
      }
    });

    const result = await sql.query(query);
    res.json({
      records: result.recordset,
      "database-prs": config["database-prs"]
    });
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
});

app.listen(port, () => {
  console.log(`API Multi-Cliente rodando na porta ${port}`);
});
