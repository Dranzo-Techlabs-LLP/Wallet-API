import { IsNumber, IsString, IsNotEmpty, IsEnum, Min } from 'class-validator';

export enum PaymentMethod {
    RAZORPAY = 'RAZORPAY',
    STRIPE = 'STRIPE',
}

export class RechargeWalletDto {
    @IsString()
    @IsNotEmpty()
    userId: string;

    @IsNumber()
    @Min(1)
    amount: number;

    @IsEnum(PaymentMethod)
    paymentMethod: PaymentMethod;
}
