import {
    ExceptionFilter,
    Catch,
    ArgumentsHost,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
    private readonly logger = new Logger(AllExceptionsFilter.name);

    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();
        const request = ctx.getRequest();

        const status =
            exception instanceof HttpException
                ? exception.getStatus()
                : HttpStatus.INTERNAL_SERVER_ERROR;

        const message =
            exception instanceof HttpException
                ? exception.getResponse()
                : 'Internal server error';

        if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
            const errorMsg = exception instanceof Error ? exception.message : 'Unknown error';
            const errorStack = exception instanceof Error ? exception.stack : '';
            this.logger.error(`Exception: ${errorMsg} \n Stack: ${errorStack}`);

            // Write to physical file 'error_log.txt' in the project root
            try {
                const logFilePath = path.join(process.cwd(), 'error_log.txt');
                const logEntry = `[${new Date().toISOString()}] ERROR: ${errorMsg}\nStack: ${errorStack}\n\n`;
                fs.appendFileSync(logFilePath, logEntry);
            } catch (fsErr) {
                this.logger.error('Could not write to error_log.txt', fsErr);
            }
        }

        response.status(status).json({
            statusCode: status,
            timestamp: new Date().toISOString(),
            path: request.url,
            message:
                typeof message === 'object' && message !== null
                    ? (message as any).message || message
                    : message,
        });
    }
}
