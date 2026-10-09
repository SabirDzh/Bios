import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function mockHost(): {
  host: ArgumentsHost;
  json: jest.Mock<void, [body: Record<string, unknown>]>;
  status: jest.Mock;
} {
  const json = jest.fn<void, [body: Record<string, unknown>]>();
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ method: 'GET', url: '/api/v1/test' }),
    }),
  } as unknown as ArgumentsHost;
  return { host, json, status };
}

describe('AllExceptionsFilter envelope', () => {
  test('HttpException keeps message + path', () => {
    const { host, json, status } = mockHost();
    new AllExceptionsFilter().catch(new BadRequestException('bad input'), host);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: 'bad input',
        path: '/api/v1/test',
      }),
    );
    expect(json.mock.calls[0][0].timestamp).toBeTruthy();
  });

  test('unknown error becomes generic 500 without internals', () => {
    const { host, json, status } = mockHost();
    new AllExceptionsFilter().catch(new Error('db password=secret'), host);
    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});
