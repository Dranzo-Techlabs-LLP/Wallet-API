export declare enum SessionStatus {
    ACTIVE = "ACTIVE",
    COMPLETED = "COMPLETED",
    SETTLED = "SETTLED",
    CANCELLED = "CANCELLED"
}
export declare class Session {
    id: string;
    userId: string;
    expertId: string;
    startTime: Date;
    endTime: Date;
    expectedFee: number;
    actualFee: number;
    status: SessionStatus;
    createdAt: Date;
    updatedAt: Date;
}
