const sql = require('mssql');

const pools = new Map();

async function getPool(key, cfg) {
  let pool = pools.get(key);
  if (!pool) {
    pool = new sql.ConnectionPool({
      user: cfg.user,
      password: cfg.password,
      server: cfg.server,          // prefira HOSTNAME (não IP)
      database: cfg.database,
      pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
      options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true }
    });

    pool.on('error', (err) => {
      console.error('[mssql pool error]', key, err);
      pools.delete(key);
    });

    pools.set(key, pool);
  }

  if (pool.connecting) await pool.connect();
  else if (!pool.connected) await pool.connect();

  return pool;
}

async function queryByClient(dbConfigs, clientId, sqlText, params = {}) {
  const cfg = dbConfigs[clientId];
  if (!cfg) {
    const e = new Error('Cliente não encontrado ou não autorizado');
    e.status = 400;
    throw e;
  }

  const pool = await getPool(clientId, cfg);
  const req = pool.request();

  for (const [k, v] of Object.entries(params)) {
    req.input(k, v);
  }

  return req.query(sqlText);
}

module.exports = { queryByClient };
