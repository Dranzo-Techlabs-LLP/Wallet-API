const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkSchema() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });
        const [rows] = await connection.execute('DESCRIBE users');
        console.log('Users table schema:', rows);
        await connection.end();
    } catch (err) {
        console.error('Failed to fetch schema:', err);
    }
}
checkSchema();
