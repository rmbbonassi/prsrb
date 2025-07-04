const express = require('express');
const sql = require('mssql');
const app = express();
const port = process.env.PORT || 3000;

// Token secreto
const API_SECRET = process.env.API_SECRET;

app.use(express.json());

// Middleware para autenticação
app.use((req, res, next) => {
  const token = req.headers['x-api-key'];
  if (token !== API_SECRET) {
    return res.status(401).send('Acesso não autorizado');
  }
  next();
});

// Rota para consulta SQL
app.post('/query', async (req, res) => {
  const { query } = req.body;

  const config = {
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    server: process.env.SQL_SERVER,
    database: process.env.SQL_DATABASE,
    options: {
      encrypt: true,
      trustServerCertificate: true
    }
  };

  try {
    await sql.connect(config);
    const result = await sql.query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
});

app.listen(port, () => {
  console.log(`API rodando na porta ${port}`);
});
