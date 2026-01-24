# cPanel Deployment Guide for WeBuddy Wallet API

This guide explains how to host your NestJS application on cPanel using the "Setup Node.js App" feature.

## Prerequisites
1. **cPanel Account** with "Setup Node.js App" enabled.
2. **External MySQL Database** is already configured in the package (`167.86.105.17`).
   - Ensure your cPanel server can connect to this remote IP (allowlist IP if needed).

## Step 1: Upload the Package
1. Log in to cPanel -> **File Manager**.
2. Upload `webuddy-wallet-api.zip` to a folder (e.g., `/home/youruser/api`).
3. Right-click and **Extract** the zip file.
   - You should see the `webuddy-wallet-api` folder.
   - Inside, verify `.env` exists and contains the correct DB credentials.

## Step 2: Setup Node.js App
1. Go to cPanel main page -> **Setup Node.js App**.
2. Click **Create Application**.
3. **Node.js Version**: Select **18.x** or **20.x**.
4. **Application Mode**: **Production**.
5. **Application Root**: e.g., `api/webuddy-wallet-api`.
6. **Application URL**: e.g., `api.yourdomain.com`.
7. **Application Startup File**: `dist/main.js`.
8. Click **Create**.

## Step 3: Install & Build
1. After creating the app, the UI will show a command to enter the virtual environment (e.g., `source .../bin/activate`).
2. Copy that command.
3. Open **Terminal** in cPanel (or SSH).
4. Paste the command to enter the virtual environment.
5. Setup dependencies and build:
   ```bash
   # Install dependencies
   npm install

   # Build the application
   npm run build
   
   # (Optional) Run migrations if you haven't set synchronize: true
   # npm run typeorm migration:run
   ```
6. Go back to "Setup Node.js App" page and click **Restart**.

## Checklist if it fails
- **Database Connection**: Since you are connecting to a remote DB (`167.86.105.17`), ensure the remove server allows connections from your cPanel server's IP.
- **Log Files**: Check `stderr.log` in the application root for errors.
