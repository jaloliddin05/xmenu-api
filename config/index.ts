import * as dotenv from 'dotenv';

import { IConfig } from './config.interface';

dotenv.config();

export default (): IConfig => ({
  port: parseInt(process.env.PORT ?? '3000', 10),

  jwt: {
    accessTokenExpiration: process.env.JWT_ACCESS_TOKEN_EXPIRATION_TIME || '1h',
    accessTokenSecret: process.env.JWT_ACCESS_TOKEN_SECRET || 'defaultAccessTokenSecret',
    refreshTokenExpiration: process.env.JWT_REFRESH_TOKEN_EXPIRATION_TIME || '7d',
    refreshTokenSecret: process.env.JWT_REFRESH_TOKEN_SECRET || 'defaultRefreshTokenSecret',
  },

  newPasswordBytes: 4,
  codeBytes: 2,
});
