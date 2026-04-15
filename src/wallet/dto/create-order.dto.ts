import { IsNumber, Min, Max, IsString, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateOrderDto {
    @IsString()
    @IsNotEmpty()
    userId: string;

    @IsNumber()
    @Min(1)
    @Max(100000)
    @Type(() => Number)
    amount: number;
}
