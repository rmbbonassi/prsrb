// db.js
const sql = require('mssql');

// Cache de pools por (clientId:database)
const pools = new Map(); // chave: `${clientId}:${dbName}`

// Monta config do pool a partir do cfg do client e do nome do DB selecionado
function makePoolConfig(cfg, dbName) {
  return {
    user: cfg.user,
    password: cfg.password,
    server: cfg.server,                 // Prefira HOSTNAME (não IP) p/ evitar warning de SNI/TLS
    database: dbName,
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    options: {
      encrypt: true,
      trustServerCertificate: true,     // true se não houver CA válida; ajuste conforme seu cenário
      enableArithAbort: true
    }
  };
}

// Retorna (ou cria) um pool conectado para (clientId, dbName)
async function getPool(clientId, cfg, dbName) {
  const key = `${clientId}:${dbName}`;
  let pool = pools.get(key);

  if (!pool) {
    pool = new sql.ConnectionPool(makePoolConfig(cfg, dbName));

    pool.on('error', (err) => {
      console.error('[mssql pool error]', key, err);
      // Se o pool der erro, removemos do cache para recriar numa próxima chamada
      pools.delete(key);
    });

    pools.set(key, pool);
  }

  if (pool.connecting) {
    await pool.connect();
  } else if (!pool.connected) {
    await pool.connect();
  }

  return pool;
}

/**
 * Escolhe a database a partir do cfg e da key:
 *   - 'database'      → cfg.database
 *   - 'database-prs'  → cfg['database-prs']
 */
function resolveDbName(cfg, targetDbKey = 'database') {
  return cfg[targetDbKey] || cfg.database;
}

/**
 * queryByClient (LIVRE) — NÃO obriga @id_conta.
 * Para uso no /query temporário. ATENÇÃO: use apenas em ambiente controlado.
 * params aceita:
 *   { nome: { type: sql.VarChar(120), value: 'x' }, ... }
 *   ou { nome: valorSimples }
 */
async function queryByClient(dbConfigs, clientId, sqlText, params = {}, targetDbKey = 'database') {
  const cfg = dbConfigs[clientId];
  if (!cfg) {
    const e = new Error('Cliente não encontrado');
    e.status = 400;
    throw e;
  }

  const dbName = resolveDbName(cfg, targetDbKey);
  if (!dbName) {
    const e = new Error(`Database não configurada (${targetDbKey}) para clientId=${clientId}`);
    e.status = 500;
    throw e;
  }

  const pool = await getPool(clientId, cfg, dbName);
  const req = pool.request();

  for (const [k, def] of Object.entries(params)) {
    if (def && typeof def === 'object' && 'type' in def) {
      req.input(k, def.type, def.value);
    } else {
      req.input(k, def);
    }
  }

  return req.query(sqlText);
}

/**
 * queryByClientForced (SEGURA) — OBRIGA @id_conta.
 * - O texto SQL DEVE conter o placeholder "@id_conta" (senão lança erro).
 * - O valor de id_conta é obtido do DBCONFIG_JSON pelo clientId.
 */
async function queryByClientForced(dbConfigs, clientId, sqlText, params = {}, targetDbKey = 'database') {
  const cfg = dbConfigs[clientId];
  if (!cfg) {
    const e = new Error('Cliente não encontrado');
    e.status = 400;
    throw e;
  }

  const idConta = cfg.id_conta;
  if (!idConta) {
    const e = new Error(`id_conta não definido para clientId=${clientId}`);
    e.status = 500;
    throw e;
  }

  // Defesa: exige que a SQL tenha o placeholder @id_conta
  if (!/@id_conta\b/.test(sqlText)) {
    const e = new Error('Query bloqueada: nenhuma referência @id_conta encontrada.');
    e.status = 400;
    throw e;
  }

  // Injeta @id_conta SEMPRE a partir do cfg (nunca do usuário)
  params.id_conta = { type: sql.Int, value: Number(idConta) };

  const dbName = resolveDbName(cfg, targetDbKey);
  if (!dbName) {
    const e = new Error(`Database não configurada (${targetDbKey}) para clientId=${clientId}`);
    e.status = 500;
    throw e;
  }

  const pool = await getPool(clientId, cfg, dbName);
  const req = pool.request();

  for (const [k, def] of Object.entries(params)) {
    if (def && typeof def === 'object' && 'type' in def) {
      req.input(k, def.type, def.value);
    } else {
      req.input(k, def);
    }
  }

  return req.query(sqlText);
}

module.exports = { sql, queryByClient, queryByClientForced };
