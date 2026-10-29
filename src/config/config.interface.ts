interface IJWT {
  accessTokenSecret: string;
  accessTokenExpiration: string;
}


export interface IConfig {
  port: number;
  jwt: IJWT;
  newPasswordBytes: number;
  codeBytes: number;
}
