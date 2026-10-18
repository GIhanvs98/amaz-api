import axios from 'axios';

export class SMSService {
  private static API_URL = 'https://app.text.lk/api/v3/sms/send';
  private static CONTACTS_API_URL = 'https://app.text.lk/api/v3/contacts';
  private static GROUP_ID = process.env.TEXTLK_GROUP_ID || 'HOSPITAL_PATIENTS';

  private static getApiKey(): string | undefined {
    const raw = process.env.TEXTLK_API_TOKEN || process.env.TEXTLK_API_KEY || process.env.SENDLK_API_TOKEN;
    return raw ? raw.trim() : undefined;
  }

  private static getSenderId(): string {
    const raw = process.env.TEXTLK_SENDER_ID || process.env.SENDLK_SENDER_ID || 'Text.lk';
    return raw.trim();
  }

  /**
   * Cleans and formats phone numbers to Sri Lanka international standard (947XXXXXXXX)
   */
  public static formatPhoneNumber(phone: string): string {
    let cleaned = (phone || '').replace(/[^0-9]/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '94' + cleaned.slice(1);
    } else if (cleaned.startsWith('7') && cleaned.length === 9) {
      cleaned = '94' + cleaned;
    }
    return cleaned;
  }

  /**
   * Sends an SMS via Text.lk
   * @param to Phone number
   * @param message Message body
   */
  public static async sendSMS(to: string, message: string): Promise<boolean> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      console.warn('SMS skipped: TEXTLK_API_TOKEN is not defined in environment variables.');
      return false;
    }

    try {
      const formattedPhone = this.formatPhoneNumber(to);
      if (!formattedPhone || formattedPhone.length < 9) {
        console.warn(`SMS skipped: Invalid recipient phone number '${to}'.`);
        return false;
      }

      const senderId = this.getSenderId();

      const response = await axios.post(
        this.API_URL,
        {
          recipient: formattedPhone,
          sender_id: senderId,
          type: 'plain',
          message: message,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      if (response.data && response.data.status === 'error') {
        console.error('Text.lk SMS Gateway Error:', response.data.message || response.data);
        return false;
      }

      console.log(`[SMS Sent] To: ${formattedPhone} | Status: Success`);
      return true;
    } catch (error: any) {
      console.error('Error sending SMS via gateway:', error?.response?.data || error?.message || error);
      return false;
    }
  }

  /**
   * Sends the queue token SMS based on the provided template
   */
  public static async sendTokenSMS(
    phone: string,
    refNo: string,
    doctorName: string,
    queueNumber: string,
    hospitalName: string
  ): Promise<boolean> {
    const date = new Date().toLocaleDateString('en-GB'); // DD/MM/YYYY
    const time = new Date().toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).toLowerCase(); // 6:18 pm

    const message = `Ref No: ${refNo}
Prof. ${doctorName}
No: ${queueNumber}
Hospital: ${hospitalName}
Date: ${date}
Time: ${time}`;

    return this.sendSMS(phone, message);
  }

  /**
   * Syncs a patient as a Contact in Text.lk
   * @param phone Patient's phone number
   * @param fullName Patient's full name
   */
  public static async syncContact(phone: string, fullName: string): Promise<boolean> {
    const apiKey = this.getApiKey();
    if (!apiKey) return false;

    try {
      const formattedPhone = this.formatPhoneNumber(phone);
      if (!formattedPhone) return false;

      // Split full name into first and last
      const nameParts = fullName.trim().split(' ');
      const firstName = nameParts[0] || 'Unknown';
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

      const response = await axios.post(
        `${this.CONTACTS_API_URL}/${this.GROUP_ID}/store`,
        {
          phone: parseInt(formattedPhone, 10),
          first_name: firstName,
          last_name: lastName
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      if (response.data && response.data.status === 'error') {
        console.error('Text.lk Contact Sync Error:', response.data.message);
        return false;
      }

      console.log('Contact synced successfully:', response.data);
      return true;
    } catch (error) {
      console.error('Error syncing contact:', error);
      return false;
    }
  }
}
