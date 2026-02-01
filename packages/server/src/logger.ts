import pino from 'pino';

const isElectron = 'electron' in process.versions;

export const logger = pino({
  ...(!isElectron && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
    },
  }),
  level: process.env.LOG_LEVEL ?? 'info',
});
