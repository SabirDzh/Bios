import { of } from 'rxjs';
import type { ExecutionContext, CallHandler } from '@nestjs/common';
import {
  LoggingInterceptor,
  resetLoggingSampleForTests,
} from './logging.interceptor';

function ctx(): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', url: '/api/v1/health' }),
      getResponse: () => ({ statusCode: 200 }),
    }),
  } as unknown as ExecutionContext;
}

const handler: CallHandler = { handle: () => of({}) } as CallHandler;

describe('LoggingInterceptor sampling', () => {
  let log: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    resetLoggingSampleForTests();
  });

  afterEach(() => {
    log.mockRestore();
  });

  test('ordinary successes are sampled, not logged one by one', (done) => {
    const interceptor = new LoggingInterceptor({
      sampleEvery: 100,
      slowMs: 500,
    });
    let completed = 0;
    for (let i = 0; i < 10; i += 1) {
      interceptor.intercept(ctx(), handler).subscribe(() => {
        completed += 1;
        if (completed === 10) {
          expect(log).not.toHaveBeenCalled();
          done();
        }
      });
    }
  });

  test('slow request is always logged', (done) => {
    let now = 1000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    const interceptor = new LoggingInterceptor({
      sampleEvery: 100,
      slowMs: 500,
    });
    const obs = interceptor.intercept(ctx(), handler);
    now = 1600; // +600ms — выше SLOW_MS, tap отработает при subscribe
    obs.subscribe(() => {
      expect(log).toHaveBeenCalledTimes(1);
      const firstArg = (log.mock.calls[0] as unknown[])[0];
      expect(String(firstArg)).toContain('+600ms');
      nowSpy.mockRestore();
      done();
    });
  });

  test('every 100th success is logged (liveness pulse)', (done) => {
    const interceptor = new LoggingInterceptor({
      sampleEvery: 100,
      slowMs: 500,
    });
    let completed = 0;
    for (let i = 0; i < 100; i += 1) {
      interceptor.intercept(ctx(), handler).subscribe(() => {
        completed += 1;
        if (completed === 100) {
          expect(log).toHaveBeenCalledTimes(1);
          done();
        }
      });
    }
  });
});
