import { IsString, IsNotEmpty, IsNumber, Min, IsEnum, IsOptional } from 'class-validator';
import { PaymentMethod } from '../../wallet/dto/recharge-wallet.dto'; // Reuse or redefine

export class ManualPayoutDto {
    @IsString()
    @IsOptional()
    expertId?: string;

    @IsNumber()
    @Min(1)
    amount: number;

    @IsString()
    @IsNotEmpty()
    bankAccount: string;

    @IsEnum(PaymentMethod)
    paymentMethod: PaymentMethod;
}
