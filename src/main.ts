import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
    try {
        // rawBody: true preserves the exact request bytes on req.rawBody so
        // we can validate the Razorpay webhook HMAC against the original payload.
        // (JSON.stringify(req.body) re-serializes and will not match Razorpay's signature.)
        const app = await NestFactory.create(AppModule, { rawBody: true });

        // Behind the cPanel/Apache reverse proxy every request arrives from 127.0.0.1,
        // so without this the ThrottlerGuard keys rate limits on the proxy's IP and
        // rate-limits EVERY user as one shared bucket (spurious 429s). Trusting the
        // first proxy hop makes req.ip reflect the real client via X-Forwarded-For.
        app.getHttpAdapter().getInstance().set('trust proxy', 1);

        app.useGlobalFilters(new AllExceptionsFilter());
        app.useGlobalPipes(new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }));

        const port = process.env.PORT || 3000;
        await app.listen(port);
        console.log(`Application is running on: http://localhost:${port}`);
    } catch (err) {
        console.error('Failed to start application:', err);
        process.exit(1);
    }
}
bootstrap();
