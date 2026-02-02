import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

export interface RegistryError {
  errors: Array<{
    code: string;
    message: string;
    detail?: any;
  }>;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = request.headers['x-request-id'] || 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let errorResponse: RegistryError;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object' && 'errors' in exceptionResponse) {
        errorResponse = exceptionResponse as RegistryError;
      } else {
        errorResponse = {
          errors: [
            {
              code: this.getErrorCode(status),
              message: exception.message,
            },
          ],
        };
      }
    } else {
      errorResponse = {
        errors: [
          {
            code: 'UNKNOWN',
            message: 'An unexpected error occurred',
          },
        ],
      };
    }

    this.logger.error(
      `[${requestId}] ${request.method} ${request.url} - ${status}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(status).json(errorResponse);
  }

  private getErrorCode(status: number): string {
    const codeMap: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'DENIED',
      404: 'NOT_FOUND',
      500: 'INTERNAL_ERROR',
    };
    return codeMap[status] || 'UNKNOWN';
  }
}
