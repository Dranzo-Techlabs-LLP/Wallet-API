const mysql = require('mysql2/promise');

async function checkDb() {
    const connection = await mysql.createConnection({
        host: '167.86.105.17',
        user: 'root',
        password: 'Meninblack@777',
        database: 'webuddy_mvp'
    });

    try {
        console.log('--- TABLES ---');
        const [tables] = await connection.query('SHOW TABLES');
        console.log(tables);

        console.log('\n--- wallet_transactions Schema ---');
        const [walletSchema] = await connection.query('DESCRIBE wallet_transactions');
        console.log(walletSchema);

        console.log('\n--- users Schema ---');
        const [userSchema] = await connection.query('DESCRIBE users');
        console.log(userSchema);
        
    } catch (err) {
        console.error(err);
    } finally {
        await connection.end();
    }
}

checkDb();
