import type { FastifyReply } from 'fastify';

export type ErrorType =
  | 'validation_error'
  | 'auth_error'
  | 'permission_error'
  | 'route_not_found'
  | 'no_available_channel'
  | 'upstream_error'
  | 'upstream_timeout'
  | 'internal_error';

export function sendError(reply: FastifyReply, statusCode: number, type: ErrorType, message: string, code?: string) {
  return reply.code(statusCode).send({
    error: {
      message,
      type,
      code: code || type
    }
  });
}
