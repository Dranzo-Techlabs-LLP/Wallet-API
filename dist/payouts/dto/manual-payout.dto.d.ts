import { PaymentMethod } from '../../wallet/dto/recharge-wallet.dto';
export declare class ManualPayoutDto {
    expertId: string;
    amount: number;
    bankAccount: string;
    paymentMethod: PaymentMethod;
}
