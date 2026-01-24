// Simple startup script for WeBuddy Wallet API
require('ts-node').register({
    transpileOnly: true,
    compilerOptions: {
        module: 'commonjs'
    }
});

require('./src/main.ts');
