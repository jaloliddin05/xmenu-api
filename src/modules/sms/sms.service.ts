import { BadRequestException, Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import validatePhoneNumber from 'src/infra/validators/phone-validation';

@Injectable()
export class SmsService {
    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
    ) { }

    async sendOtp(phoneNumber: string, otp: number): Promise<any> {
        const formData = {
            "to": phoneNumber,
            "signature":"Xmenu",
            "templateId": "otp_template",
            "templateData": {
                "otp": otp
            }
        }

        await this.sendSMS(formData);
    }

    async sendNewPassword(phoneNumber: string, newPassword: string): Promise<any> {
        const formData = {
            "to": phoneNumber,
            "signature":"Xmenu",
            "templateId": "succ_reg",
            "templateData": {
                "pswd": newPassword
            }
        }

        await this.sendSMS(formData);
    }


    async sendSMS(formData): Promise<any> {
        this.checkPhoneNumber(formData?.to);
        const url = 'https://api.unimtx.com/?action=sms.message.send&accessKeyId=' + this.configService.get('smsAccessKeyId')
        try {
            const response = await lastValueFrom(
                this.httpService.post(url, formData),
            );

            return response.data;
        } catch (error) {
            console.log('Error sending SMS:', error.response?.data || error.message);
        }
    }

    checkPhoneNumber(phoneNumber) {
        const isValid = validatePhoneNumber(phoneNumber);

        if (!isValid) {
            throw new BadRequestException('Invalid phone number');
        }
    }

}
