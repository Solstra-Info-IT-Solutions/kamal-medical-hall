import { captureError } from '../../monitoring';
import { createLogger } from './logger';

/** The app-wide logger: verbose in development, warnings and errors only (redacted) in production. */
export const logger = createLogger({ dev: __DEV__, onError: (error, context) => captureError(error, context) });
