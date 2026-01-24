export declare enum TransactionType {
    RECHARGE = "RECHARGE",
    SESSION_HOLD = "SESSION_HOLD",
    SESSION_CAPTURE = "SESSION_CAPTURE",
    SESSION_REFUND = "SESSION_REFUND",
    PAYOUT = "PAYOUT",
    COMMISSION = "COMMISSION",
    ADJUSTMENT = "ADJUSTMENT"
}
export declare enum TransactionStatus {
    PENDING = "PENDING",
    SUCCESS = "SUCCESS",
    FAILED = "FAILED"
}
export declare class Transaction {
    id: string;
    userId: string;
    expertId: string;
    amount: number;
    type: TransactionType;
    status: TransactionStatus;
    referenceId: string;
    metaData: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
}
