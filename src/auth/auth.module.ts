import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { User } from '../users/user.entity';
import { MatrixModule } from '../matrix/matrix.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { GoogleTokenVerifier } from './google-token-verifier';

@Module({
    imports: [
        TypeOrmModule.forFeature([User]),
        MatrixModule,
        ConfigModule,
        JwtModule.registerAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => {
                const secret = configService.get<string>('JWT_SECRET');
                if (!secret) {
                    // Fail loudly at boot rather than silently signing tokens
                    // with an empty key that anyone could forge.
                    throw new Error('JWT_SECRET is not set - refusing to start the auth module');
                }
                return {
                    secret,
                    signOptions: {
                        expiresIn: configService.get<string>('JWT_EXPIRES_IN') || '30d',
                    },
                };
            },
        }),
    ],
    controllers: [AuthController],
    providers: [AuthService, JwtAuthGuard, GoogleTokenVerifier],
    exports: [AuthService, JwtAuthGuard],
})
export class AuthModule { }
