const mysql = require('mysql2/promise');

async function run() {
    const connection = await mysql.createConnection({
        host: '167.86.105.17',
        user: 'root',
        password: 'Meninblack@777',
        database: 'webuddy_mvp',
        port: 3306
    });

    try {
        console.log("Adding refund_status column to pending_holds table...");
        await connection.query(`
            ALTER TABLE pending_holds 
            ADD COLUMN refund_status ENUM('none','requested','approved','rejected') DEFAULT 'none'
        `);
        console.log("Column added successfully.");
    } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
            console.log("refund_status column already exists in pending_holds.");
        } else {
            console.error("Error adding column:", err);
            // Don't exit, might be other error but we can try to create the other table anyway
        }
    }

    try {
        console.log("Adding isRefundActive column to pending_holds table...");
        await connection.query(`
            ALTER TABLE pending_holds 
            ADD COLUMN isRefundActive TINYINT DEFAULT 1
        `);
        console.log("Column isRefundActive added successfully.");
    } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
            console.log("isRefundActive column already exists.");
        } else {
            console.error("Error adding isRefundActive column:", err);
        }
    }

    try {
        console.log("Creating refund_requests table...");
        await connection.query(`
            CREATE TABLE IF NOT EXISTS refund_requests (
                id INT AUTO_INCREMENT PRIMARY KEY,
                clientId VARCHAR(255) NOT NULL,
                consultantId VARCHAR(255) NOT NULL,
                pendingHoldId INT NOT NULL,
                amount DECIMAL(10,2),
                status ENUM('requested','approved','rejected') DEFAULT 'requested',
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        console.log("Table created successfully.");
    } catch (err) {
        console.error("Error creating table:", err);
    }

    await connection.end();
    console.log("Migration complete.");
}

run();
