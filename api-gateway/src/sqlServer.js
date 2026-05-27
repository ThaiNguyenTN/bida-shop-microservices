const sql = require('mssql');

const config = {
  server: process.env.SQLSERVER_HOST || process.env.DB_SERVER || 'localhost',
  port: Number(process.env.SQLSERVER_PORT || process.env.DB_PORT || 1433),
  database: process.env.SQLSERVER_DATABASE || process.env.DB_NAME || 'BidaShopDB',
  user: process.env.SQLSERVER_USER || process.env.DB_USER || 'sa',
  password: process.env.SQLSERVER_PASSWORD || process.env.DB_PASSWORD || '1234',
  options: {
    encrypt: String(process.env.SQLSERVER_ENCRYPT || process.env.DB_ENCRYPT || 'false').toLowerCase() === 'true',
    trustServerCertificate: String(process.env.SQLSERVER_TRUST_SERVER_CERT || process.env.DB_TRUST_SERVER_CERT || 'true').toLowerCase() === 'true'
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

let poolPromise;

function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(config);
  }
  return poolPromise;
}

async function query(builder) {
  const pool = await getPool();
  const request = pool.request();
  const statement = builder(request);
  const result = await request.query(statement);
  return result.recordset;
}

async function exec(builder) {
  const pool = await getPool();
  const request = pool.request();
  const statement = builder(request);
  const result = await request.query(statement);
  return result;
}

module.exports = {
  sql,
  getPool,
  query,
  exec
};
