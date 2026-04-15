const mysql = require('mysql2/promise');

async function createTable() {
    const connection = await mysql.createConnection({
        host: '167.86.105.17',
        user: 'root',
        password: 'Meninblack@777',
        database: 'webuddy_mvp'
    });

    try {
        const sql = `
            CREATE TABLE IF NOT EXISTS referrals (
                id INT AUTO_INCREMENT PRIMARY KEY,
                referrer_user_id VARCHAR(36) NOT NULL,
                referred_user_id VARCHAR(36) NOT NULL,
                status ENUM('PENDING', 'REWARDED') DEFAULT 'PENDING',
                first_recharge_txn_id INT NULL,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX (referred_user_id),
                INDEX (status)
            ) ENGINE=InnoDB;
        `;
        await connection.query(sql);
        console.log('Table "referrals" created successfully or already exists.');
    } catch (err) {
        console.error('Error creating referrals table:', err);
    } finally {
        await connection.end();
    }
}

createTable();
