const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/src/app.module.js');
const { ValidationPipe } = require('@nestjs/common');

async function bootstrap() {
    try {
        const app = await NestFactory.create(AppModule);
        app.useGlobalPipes(new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }));

        const port = process.env.PORT || 3000;
        await app.listen(port);
        console.log(`✅ Application is running on: http://localhost:${port}`);
        console.log('📚 API Documentation available in api_endpoints.md');
    } catch (error) {
        console.error('❌ Error starting application:', error);
        process.exit(1);
    }
}

bootstrap();
