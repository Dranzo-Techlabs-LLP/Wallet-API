# WeBuddy Wallet API Endpoints

Base URL: `https://wallet.dranzo.com`

---

## 1. Users Module

### Create User
**URL**: `/v1/users`  
**Method**: `POST`  
**Body**:
```json
{
  "phoneNumber": "string",
  "name": "string", (optional)
  "max_credits": 100, (optional)
  "settings": { ... } (optional)
}
```

### Get User
**URL**: `/v1/users/:id`  
**Method**: `GET`  
**Params**: `id` (User ID)

### Update User (Partial)
**URL**: `/v1/users/:id`  
**Method**: `PATCH`  
**Params**: `id` (User ID)  
**Body**: (Only include fields you wish to update)
```json
{
  "phoneNumber": "string",
  "name": "string",
  "max_credits": 100,
  "settings": { ... }
}
```

---

## 2. Wallet Module

### Recharge Wallet
**URL**: `/v1/wallet/recharge`  
**Method**: `POST`  
**Body**:
```json
{
  "userId": "string",
  "amount": 500,
  "paymentMethod": "RAZORPAY" | "STRIPE"
}
```

### Transaction History
**URL**: `/v1/wallet/history`  
**Method**: `GET`  
**Query Params**:
- `userId`: string (Required)
- `page`: number (Default: 1)
- `pageSize`: number (Default: 10)

---

## 3. Sessions Module

### Start Session
**URL**: `/v1/sessions/start`  
**Method**: `POST`  
**Body**:
```json
{
  "userId": "string",
  "expertId": "string",
  "sessionFee": 100
}
```

### Adjust Session
**URL**: `/v1/sessions/adjust`  
**Method**: `POST`  
**Body**:
```json
{
  "sessionId": "string",
  "adjustedFee": 120,
  "deferFee": false
}
```

### End/Settle Session
**URL**: `/v1/sessions/end`  
**Method**: `POST`  
**Body**:
```json
{
  "sessionId": "string",
  "expertId": "string",
  "actualFee": 150
}
```

---

## 4. Payouts Module

### Manual Payout
**URL**: `/v1/payouts/manual`  
**Method**: `POST`  
**Body**:
```json
{
  "expertId": "string",
  "amount": 1000,
  "bankAccount": "string",
  "paymentMethod": "RAZORPAY" | "STRIPE"
}
```

### Monthly Payout
**URL**: `/v1/payouts/monthly`  
**Method**: `POST`  
**Body**:
```json
{
  "expertId": "string",
  "month": "YYYY-MM",
  "payoutThreshold": 5000
}
```

---

## 5. Experts Module (Bank Details)

### Add Bank Detail
**URL**: `/v1/experts/bank-details`  
**Method**: `POST`  
**Body**:
```json
{
  "expertId": "string",
  "bankName": "string",
  "accountNumber": "string",
  "ifscCode": "string",
  "accountHolderName": "string",
  "branchName": "string" (optional)
}
```

### List Bank Details
**URL**: `/v1/experts/:expertId/bank-details`  
**Method**: `GET`  
**Params**: `expertId` (Expert ID)
