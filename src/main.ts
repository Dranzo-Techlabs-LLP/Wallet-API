import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
    try {
        const app = await NestFactory.create(AppModule);
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
