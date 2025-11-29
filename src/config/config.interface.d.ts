interface IJWT {
    accessTokenSecret: string;
    accessTokenExpiration: string;
    refreshTokenSecret: string;
    refreshTokenExpiration: any;
}
export interface IConfig {
    port: number;
    jwt: IJWT;
    newPasswordBytes: number;
    codeBytes: number;
}
export {};
