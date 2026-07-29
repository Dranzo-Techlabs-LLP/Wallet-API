import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MatrixService } from './matrix.service';

@Module({
    imports: [ConfigModule],
    providers: [MatrixService],
    exports: [MatrixService],
})
export class MatrixModule { }
