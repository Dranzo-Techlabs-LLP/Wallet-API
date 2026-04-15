const mysql = require('mysql2/promise');
require('dotenv').config();

async function test() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });
        console.log('Connected!');
        const [rows] = await connection.execute('SELECT 1 + 1 AS result');
        console.log('Query result:', rows);
        await connection.end();
    } catch (err) {
        console.error('Connection failed:', err);
    }
}
test();
