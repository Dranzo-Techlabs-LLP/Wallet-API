require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const [rows] = await c.execute(
    "SELECT id, name, Webuddy_name, isConsultant, createdAt FROM users WHERE name LIKE ? OR Webuddy_name LIKE ? ORDER BY createdAt DESC LIMIT 20",
    ['%saiyad%', '%saiyad%']
  );
  console.log(JSON.stringify(rows, null, 2));
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
