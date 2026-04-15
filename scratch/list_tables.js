const mysql = require('mysql2/promise');
require('dotenv').config();

async function listTables() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });
        const [rows] = await connection.execute('SHOW TABLES');
        console.log('Tables:', rows);
        await connection.end();
    } catch (err) {
        console.error('Failed to list tables:', err);
    }
}
listTables();
