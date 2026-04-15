import { IsString, IsNotEmpty, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class VerifyPaymentDto {
    @IsString()
    @IsNotEmpty()
    userId: string;

    @IsNumber()
    @IsNotEmpty()
    @Type(() => Number)
    transactionId: number;

    @IsString()
    @IsNotEmpty()
    razorpay_order_id: string;

    @IsString()
    @IsNotEmpty()
    razorpay_payment_id: string;

    @IsString()
    @IsNotEmpty()
    razorpay_signature: string;
}
