import { IsString, IsNotEmpty } from 'class-validator';

export class InitiateHoldDto {
    @IsString()
    @IsNotEmpty()
    clientId: string; // webuddy_name of the client

    @IsString()
    @IsNotEmpty()
    consultantId: string; // webuddy_name of the consultant
}
