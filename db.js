// db.js
const sql = require('mssql');

// Cache de pools por (clientId:database)
const pools = new Map(); // chave: `${clientId}:${dbName}`

function makePoolConfig(cfg, dbName) {
  return {
    user: cfg.user,
    password: cfg.password,
    server: cfg.server,                 // prefira HOSTNAME (não IP)
    database: dbName,
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true }
  };
}

async function getPool(clientId, cfg, dbName) {
  const key = `${clientId}:${dbName}`;
  let pool = pools.get(key);
  if (!pool) {
    pool = new sql.ConnectionPool(makePoolConfig(cfg, dbName));
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

function resolveDbName(cfg, targetDbKey = 'database') {
  return cfg[targetDbKey] || cfg.database;
}

// -------------------- QUERIES --------------------
async function queryByClient(dbConfigs, clientId, sqlText, params = {}, targetDbKey = 'database') {
  const cfg = dbConfigs[clientId];
  if (!cfg) { const e = new Error('Cliente não encontrado'); e.status = 400; throw e; }
  const dbName = resolveDbName(cfg, targetDbKey);
  if (!dbName) { const e = new Error(`Database não configurada (${targetDbKey}) para clientId=${clientId}`); e.status = 500; throw e; }

  const pool = await getPool(clientId, cfg, dbName);
  const req = pool.request();

  for (const [k, def] of Object.entries(params)) {
    if (def && typeof def === 'object' && 'type' in def) req.input(k, def.type, def.value);
    else req.input(k, def);
  }
  return req.query(sqlText);
}

async function queryByClientForced(dbConfigs, clientId, sqlText, params = {}, targetDbKey = 'database') {
  const cfg = dbConfigs[clientId];
  if (!cfg) { const e = new Error('Cliente não encontrado'); e.status = 400; throw e; }
  const idConta = cfg.id_conta;
  if (!idConta) { const e = new Error(`id_conta não definido para clientId=${clientId}`); e.status = 500; throw e; }

  if (!/@id_conta\b/.test(sqlText)) { const e = new Error('Query bloqueada: nenhuma referência @id_conta encontrada.'); e.status = 400; throw e; }
  params.id_conta = { type: sql.Int, value: Number(idConta) };

  const dbName = resolveDbName(cfg, targetDbKey);
  if (!dbName) { const e = new Error(`Database não configurada (${targetDbKey}) para clientId=${clientId}`); e.status = 500; throw e; }

  const pool = await getPool(clientId, cfg, dbName);
  const req = pool.request();

  for (const [k, def] of Object.entries(params)) {
    if (def && typeof def === 'object' && 'type' in def) req.input(k, def.type, def.value);
    else req.input(k, def);
  }
  return req.query(sqlText);
}

// -------------------- PROCEDURES --------------------
async function execProcByClientForced(dbConfigs, clientId, procName, params = {}, targetDbKey = 'database') {
  const cfg = dbConfigs[clientId];
  if (!cfg) { const e = new Error('Cliente não encontrado'); e.status = 400; throw e; }
  const idConta = cfg.id_conta;
  if (!idConta) { const e = new Error(`id_conta não definido para clientId=${clientId}`); e.status = 500; throw e; }

  // injeta sempre @id_conta (se já vier, sobrescrevemos para garantir a origem)
  params.id_conta = { type: sql.Int, value: Number(idConta) };

  const dbName = resolveDbName(cfg, targetDbKey);
  if (!dbName) { const e = new Error(`Database não configurada (${targetDbKey}) para clientId=${clientId}`); e.status = 500; throw e; }

  const pool = await getPool(clientId, cfg, dbName);
  const req = pool.request();

  for (const [k, def] of Object.entries(params)) {
    if (def && typeof def === 'object' && 'type' in def) req.input(k, def.type, def.value);
    else req.input(k, def);
  }
  return req.execute(procName);
}

module.exports = { sql, queryByClient, queryByClientForced, execProcByClientForced };
