export declare enum PaymentMethod {
    RAZORPAY = "RAZORPAY",
    STRIPE = "STRIPE"
}
export declare class RechargeWalletDto {
    userId: string;
    amount: number;
    paymentMethod: PaymentMethod;
}
