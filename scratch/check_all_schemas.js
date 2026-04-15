const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkAllSchemas() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });
        const tables = ['experts', 'pending_holds', 'sessions', 'transactions'];
        for (const table of tables) {
            const [rows] = await connection.execute(`DESCRIBE ${table}`);
            console.log(`--- ${table} ---`);
            console.log(rows);
        }
        await connection.end();
    } catch (err) {
        console.error('Failed to fetch schema:', err);
    }
}
checkAllSchemas();
